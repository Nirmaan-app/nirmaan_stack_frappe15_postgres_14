# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Who a payment row is paid to (spec #1420 tickets #1431, #1438, #1463, ADR-0033). Read-only.

The one place "who to pay" is resolved for a row the accountant pays: "Payment need to paid"'s
Paid to column, the approval queue, the ICICI / Cashfree file, Record Payment's "Pay ₹X to" box and
the write that pays a PO / WO payment into its vendor's account (`take_vendor_account`) all read it
here.

Every row holds its OWN pay-to account (`pay_to.PAY_TO_FIELDS`), copied when it was raised: a PO /
WO payment (`Project Payments`) from its vendor's Payee, an expense from the Payee its raiser picked
or its vendor's. An expense is paid into it. An Approved PO / WO payment whose vendor's Payee now
holds another account, or that holds none while its vendor has one, is paid into the vendor's
account instead (`switch_to`, #1463, ADR-0033 decision 9 revised 2026-10-16): exporting it or
marking it paid first writes that account onto the payment. Only an Approved payment switches: one
not yet approved, or rejected, is not being paid, and a paid one says where its money went. A row
paid by cheque (`by_cheque`, #1464, ADR-0033 decision 10) -- a PO / WO payment requested as a cheque,
or any payment or expense on a Cheque that is not Cancelled -- never switches: a cheque pays no
account, so its copy is not where the money went and no account is taken for it; the screens keep it
out of the bank file, since paying it there as well would pay twice. A row with no account to pay
into says why: `PAYMENT_HAS_NO_ACCOUNT` or `EXPENSE_HAS_NO_ACCOUNT`. Every expense carries its type's
*Who gets paid* rule, so the screen can say whether the type needs an account (and Change account
whether it may be removed).

* `paid_to_rows` -- the answer for rows already read (the approval queue).
* `paid_to_for` -- the same for `{doctype, name}` keys, read now (the bank file).
* `pay_to_box` -- the "Pay ₹X to" box: the row's answer plus the amount, its vendor, whether it is
  paid, and who set the account.
* `vendor_account_to_take` -- the rule: which vendor account, if any, a PO / WO payment is paid
  into in place of its copy.
* `account_key` -- what makes two accounts the same one: the rule's comparison.

An answer is a dict so later rules add keys to it (one place: `_answer`); every reader passes it on
whole.
"""

from __future__ import annotations

from typing import NamedTuple

import frappe
from frappe import _

from nirmaan_stack.services.cheque_payments import is_cheque
from nirmaan_stack.services.cheques.lines import live_cheques_of
from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES
from nirmaan_stack.services.outflow_import.normalize import normalize_account, normalize_ifsc
from nirmaan_stack.services.payees.expense_rules import NOT_ASKED
from nirmaan_stack.services.payees.pay_to import PAY_TO_FIELDS, pay_to_account, pay_to_field
from nirmaan_stack.services.payees.rules import ACCOUNT_FIELDS, ENTERED_FIELDS, PAID_STATUSES
from nirmaan_stack.services.payees.vendor_account import vendor_accounts
from nirmaan_stack.services.payees.versions import last_field_change
from nirmaan_stack.services.settlement import STATUS_APPROVED

PAYMENT_DOCTYPE = "Project Payments"
#: The row kinds the accountant pays.
PAID_TO_DOCTYPES = (PAYMENT_DOCTYPE, *EXPENSE_DOCTYPES)

#: Why a row has no account to pay into.
PAYMENT_HAS_NO_ACCOUNT = "payment_has_no_account"
EXPENSE_HAS_NO_ACCOUNT = "expense_has_no_account"

#: How the account on a row was set (`pay_to_box`'s `named_by.how`).
NAMED_ON_REQUEST = "request"
NAMED_BY_CHANGE = "changed"
NAMED_BY_VENDOR = "vendor"

#: The copy's fields whose change is "the account changed" (`named_by`): the ones a person enters.
_ACCOUNT_CHANGE_FIELDS = tuple(pay_to_field(field) for field in ENTERED_FIELDS)


def assert_paid_to_doctype(doctype: str, allowed=PAID_TO_DOCTYPES) -> None:
    """Refuse a doctype that is not a payment row the accountant pays."""
    if doctype not in allowed:
        frappe.throw(_("{0} is not a payment or an expense.").format(doctype))


class _RowFacts(NamedTuple):
    """What `paid_to_rows` decides about a row before reading the expense types and vendors."""

    row: dict
    expense: bool
    by_cheque: bool
    may_switch: bool


def paid_to_rows(rows: list[dict]) -> list[dict]:
    """Who each row is paid to, in order. A row carries `doctype`, `name`, `status`, `vendor`,
    `expense_type`, `mode_of_payment` and its pay-to fields. Each answer is `{account, missing,
    payee_rule, switch_to, by_cheque, vendor_has_no_account}`:

    * `account` -- the row's own copy (`pay_to.pay_to_account`), or None.
    * `missing` -- None, `PAYMENT_HAS_NO_ACCOUNT` (a PO / WO payment with no copy and nothing to
      switch to) or `EXPENSE_HAS_NO_ACCOUNT`.
    * `payee_rule` -- an expense's type's rule (Not asked when unset), with or without an account;
      None on a PO / WO payment.
    * `switch_to` -- on an Approved PO / WO payment, its vendor's account now when the payment is
      paid into it instead of `account` (`vendor_account_to_take`, #1463); None on every other row.
    * `by_cheque` -- a row paid by cheque (#1464): a PO / WO payment requested as one, or any row on a
      Cheque that is not Cancelled. It never switches, and the screens keep it out of the bank file.
    * `vendor_has_no_account` -- an Approved PO / WO payment that holds its own account while its
      vendor has none now: it is paid into the account it was raised with, and the screens say so.

    At most five queries, whatever the row count: the live cheques of each paid doctype, the expense
    types' rules, the vendors' accounts."""
    on_cheque = _on_live_cheques(rows)
    facts = []
    for row in rows:
        expense = _is_expense(row.get("doctype"))
        by_cheque = (row.get("doctype"), row.get("name")) in on_cheque or (not expense and is_cheque(row))
        facts.append(_RowFacts(row, expense, by_cheque, _may_switch(row, expense, by_cheque)))
    rules = _payee_rules({fact.row.get("expense_type") for fact in facts if fact.expense})
    accounts_now = vendor_accounts([fact.row.get("vendor") for fact in facts if fact.may_switch])
    return [_answer(fact, rules, accounts_now) for fact in facts]


def _answer(fact: _RowFacts, rules: dict[str, str], accounts_now: dict[str, dict]) -> dict:
    row = fact.row
    account = pay_to_account(row)
    answer = {"account": account, "missing": None, "payee_rule": None, "switch_to": None,
              "by_cheque": fact.by_cheque, "vendor_has_no_account": False}
    if fact.expense:
        answer["payee_rule"] = rules.get(row.get("expense_type")) or NOT_ASKED
        if not account:
            answer["missing"] = EXPENSE_HAS_NO_ACCOUNT
        return answer
    if fact.may_switch:
        vendor_account_now = accounts_now.get(row["vendor"])
        answer["switch_to"] = vendor_account_to_take(account, vendor_account_now)
        answer["vendor_has_no_account"] = bool(account) and not vendor_account_now
    if not account and not answer["switch_to"]:
        answer["missing"] = PAYMENT_HAS_NO_ACCOUNT
    return answer


def _is_expense(doctype: str | None) -> bool:
    """True for an expense row (`Project Expenses`, `Non Project Expenses`): every paid row that is not a
    PO / WO payment."""
    return doctype != PAYMENT_DOCTYPE


def _on_live_cheques(rows: list[dict]) -> set[tuple[str, str]]:
    """`(doctype, name)` of each row on a Cheque that is not Cancelled: one query per paid doctype."""
    on_cheque = set()
    for doctype in PAID_TO_DOCTYPES:
        names = [row.get("name") for row in rows if row.get("doctype") == doctype]
        on_cheque.update((doctype, name) for name in live_cheques_of(doctype, names))
    return on_cheque


def _may_switch(row: dict, expense: bool, by_cheque: bool) -> bool:
    """A row that may be paid into its vendor's account: an Approved PO / WO payment with a vendor, not
    paid by cheque. Only an Approved one is being paid: a paid one keeps saying where its money went,
    and a cheque pays no account (#1464)."""
    return not expense and bool(row.get("vendor")) and row.get("status") == STATUS_APPROVED and not by_cheque


def vendor_account_to_take(copy: dict | None, vendor_account_now: dict | None) -> dict | None:
    """The vendor's account a PO / WO payment is paid into in place of its `copy` (ADR-0033 decision 9,
    revised 2026-10-16), in a Payee's field names, or None when it is paid into its copy.

    It takes the vendor's account when it holds no copy, or when the vendor's account is another
    (normalised account number, IFSC). The holder name, bank and branch don't count: a renamed holder
    is still the same account. A vendor with no Payee gives nothing to take: the payment keeps its
    copy, or has no account at all."""
    if not vendor_account_now:
        return None
    if copy and account_key(copy) == account_key(vendor_account_now):
        return None
    return {field: vendor_account_now[field] for field in ACCOUNT_FIELDS}


def account_key(account: dict | None) -> tuple[str, str] | None:
    """What makes two accounts the same one: the normalised account number and IFSC, in a Payee's
    field names; None for no account. `vendor_account_to_take` switches when the keys differ, and
    `take_vendor_account` compares the switch the payer was shown with its own by this."""
    if not account:
        return None
    return normalize_account(account.get("account_number")), normalize_ifsc(account.get("ifsc"))


def paid_to_for(keys: list[dict]) -> list[dict]:
    """`paid_to_rows` for rows named by `{doctype, name}` only, read from the stored records now. An
    unknown row has no account."""
    for key in keys:
        assert_paid_to_doctype(key.get("doctype"))
    facts = {}
    for doctype in PAID_TO_DOCTYPES:
        names = [k["name"] for k in keys if k["doctype"] == doctype]
        if names:
            for row in frappe.get_all(doctype, filters={"name": ["in", names]}, fields=_row_fields(doctype)):
                facts[(doctype, row.name)] = row_facts(doctype, row)
    return paid_to_rows([facts.get((k["doctype"], k["name"]), {"doctype": k["doctype"]}) for k in keys])


def pay_to_box(doctype: str, name: str) -> dict:
    """The "Pay ₹X to" box for a payment or an expense: its `paid_to_rows` answer plus `{name,
    description, amount, vendor, vendor_name, vendor_fixed, paid, named_by}`. `description`: an
    expense's, so Change account names it by what it is, not its ID; None on a PO / WO payment. `vendor_fixed`: an expense with a
    vendor is paid into the vendor's account, so the screen offers no other. `paid`: money has left
    Approved (`rules.PAID_STATUSES`). `named_by` is `{how, user, full_name, on}` (`on` an ISO date) or
    None when nothing records it."""
    assert_paid_to_doctype(doctype)
    extra = ("amount", "description") if _is_expense(doctype) else ("amount",)
    doc = frappe.db.get_value(doctype, name, _row_fields(doctype, *extra), as_dict=True)
    if not doc:
        frappe.throw(_("{0} {1} not found.").format(doctype, name), frappe.DoesNotExistError)
    vendor = doc.get("vendor") or None
    answer = paid_to_rows([row_facts(doctype, doc)])[0]
    return {
        **answer,
        "name": doc.name,
        "description": doc.get("description") or None,
        "amount": float(doc.amount or 0),
        "vendor": vendor,
        "vendor_name": frappe.db.get_value("Vendors", vendor, "vendor_name") if vendor else None,
        "vendor_fixed": bool(vendor),
        "paid": doc.status in PAID_STATUSES,
        "named_by": _named_by(doctype, doc, vendor) if answer["account"] else None,
    }


def _row_fields(doctype: str, *extra: str) -> list[str]:
    """What a row's answer is read from: its copy, its status, its vendor where it has one (only `Non
    Project Expenses` has none), an expense's type and the request it came from, a PO / WO payment's
    Mode of Payment."""
    fields = ["name", "status", *PAY_TO_FIELDS, *extra]
    if _is_expense(doctype):
        fields += ["type", "request_id"]
    else:
        fields.append("mode_of_payment")
    if frappe.get_meta(doctype).has_field("vendor"):
        fields.append("vendor")
    return fields


def row_facts(doctype: str, row) -> dict:
    """The facts `paid_to_rows` reads, from a stored row (a dict or a Document)."""
    return {"doctype": doctype, "name": row.get("name"), "status": row.get("status"), "vendor": row.get("vendor"),
            "expense_type": row.get("type"), "mode_of_payment": row.get("mode_of_payment"),
            **{field: row.get(field) for field in PAY_TO_FIELDS}}


def _named_by(doctype, doc, vendor) -> dict | None:
    """Who set the account: the latest change to the copy (its Version history), else the raiser of
    the request it came from (when the request holds the same account), else its vendor."""
    changes = [c for c in (last_field_change(doctype, doc.name, f) for f in _ACCOUNT_CHANGE_FIELDS) if c]
    if changes:
        latest = max(changes, key=lambda c: c.creation)
        return _named(NAMED_BY_CHANGE, latest.owner, latest.creation)
    if doc.get("request_id"):
        request = frappe.db.get_value("Expense Request", doc.request_id,
                                      ["owner", "creation", "pay_to_account_number"], as_dict=True)
        if request and request.pay_to_account_number == doc.pay_to_account_number:
            return _named(NAMED_ON_REQUEST, request.owner, request.creation)
    if vendor:
        return {"how": NAMED_BY_VENDOR, "user": None, "full_name": None, "on": None}
    return None


def _named(how, user, when) -> dict:
    return {
        "how": how,
        "user": user,
        "full_name": frappe.utils.get_fullname(user),
        "on": str(when.date()) if hasattr(when, "date") else str(when)[:10],
    }


def _payee_rules(types) -> dict[str, str]:
    types = [t for t in types if t]
    if not types:
        return {}
    rows = frappe.get_all("Expense Type", filters={"name": ["in", types]}, fields=["name", "payee_rule"])
    return {row.name: row.payee_rule for row in rows}
