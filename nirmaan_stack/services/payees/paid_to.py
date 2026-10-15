# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Who a payment row is paid to (spec #1420 tickets #1431, #1438, ADR-0033). Read-only.

The one place "who to pay" is resolved for a row the accountant pays: "Payment need to paid"'s
Paid to column, the approval queue, the ICICI / Cashfree file and Record Payment's "Pay ₹X to" box
all read it here.

Every row is paid into its OWN pay-to account (`pay_to.PAY_TO_FIELDS`), copied when it was raised:
a PO / WO payment (`Project Payments`) from its vendor's Payee, an expense from the Payee its raiser
picked or its vendor's. Never the vendor's Payee as it reads now, never a linked Payee. A row with no
copy says why: `PAYMENT_HAS_NO_ACCOUNT`, or `EXPENSE_HAS_NO_ACCOUNT` with the expense type's *Who gets
paid* rule, so the screen can say whether the type needs one.

* `paid_to_rows` -- the answer for rows already read (the approval queue).
* `paid_to_for` -- the same for `{doctype, name}` keys, read now (the bank file).
* `pay_to_box` -- the "Pay ₹X to" box: the row's answer plus the amount, its vendor, whether it is
  paid, and who set the account.

An answer is a dict so later rules add keys to it (one place: `_answer`); every reader passes it on
whole.
"""

from __future__ import annotations

import frappe
from frappe import _

from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES
from nirmaan_stack.services.payees.expense_rules import NOT_ASKED
from nirmaan_stack.services.payees.pay_to import PAY_TO_FIELDS, has_pay_to, pay_to_account
from nirmaan_stack.services.payees.rules import PAID_STATUSES
from nirmaan_stack.services.payees.versions import last_field_change

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

#: The copy's fields whose change is "the account changed" (`named_by`).
_ACCOUNT_CHANGE_FIELDS = ("pay_to_account_name", "pay_to_account_number", "pay_to_ifsc")


def assert_paid_to_doctype(doctype: str, allowed=PAID_TO_DOCTYPES) -> None:
    """Refuse a doctype that is not a payment row the accountant pays."""
    if doctype not in allowed:
        frappe.throw(_("{0} is not a payment or an expense.").format(doctype))


def paid_to_rows(rows: list[dict]) -> list[dict]:
    """Who each row is paid to, in order. A row carries `doctype`, `vendor`, `expense_type` and its
    pay-to fields. Each answer is `{account, missing, payee_rule}`: `account` is the row's own copy
    (`pay_to.pay_to_account`) or None; `missing` is None, `PAYMENT_HAS_NO_ACCOUNT` or
    `EXPENSE_HAS_NO_ACCOUNT`; `payee_rule` is the expense type's rule on an expense with no account,
    else None. At most one query, whatever the row count."""
    rules = _payee_rules({row.get("expense_type") for row in rows
                          if row.get("doctype") != PAYMENT_DOCTYPE and not has_pay_to(row)})
    return [_answer(row, rules) for row in rows]


def _answer(row: dict, rules: dict[str, str]) -> dict:
    account = pay_to_account(row)
    if account:
        return {"account": account, "missing": None, "payee_rule": None}
    if row.get("doctype") == PAYMENT_DOCTYPE:
        return {"account": None, "missing": PAYMENT_HAS_NO_ACCOUNT, "payee_rule": None}
    return {"account": None, "missing": EXPENSE_HAS_NO_ACCOUNT,
            "payee_rule": rules.get(row.get("expense_type")) or NOT_ASKED}


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
                facts[(doctype, row.name)] = _row_facts(doctype, row)
    return paid_to_rows([facts.get((k["doctype"], k["name"]), {"doctype": k["doctype"]}) for k in keys])


def pay_to_box(doctype: str, name: str) -> dict:
    """The "Pay ₹X to" box for a payment or an expense: its `paid_to_rows` answer plus `{name,
    amount, vendor, vendor_name, vendor_fixed, paid, named_by}`. `vendor_fixed`: an expense with a
    vendor is paid into the vendor's account, so the screen offers no other. `paid`: money has left
    Approved (`rules.PAID_STATUSES`). `named_by` is `{how, user, full_name, on}` (`on` an ISO date) or
    None when nothing records it."""
    assert_paid_to_doctype(doctype)
    doc = frappe.db.get_value(doctype, name, _row_fields(doctype, "amount", "status"),
                              as_dict=True)
    if not doc:
        frappe.throw(_("{0} {1} not found.").format(doctype, name), frappe.DoesNotExistError)
    vendor = doc.get("vendor") or None
    answer = paid_to_rows([_row_facts(doctype, doc)])[0]
    return {
        **answer,
        "name": doc.name,
        "amount": float(doc.amount or 0),
        "vendor": vendor,
        "vendor_name": frappe.db.get_value("Vendors", vendor, "vendor_name") if vendor else None,
        "vendor_fixed": bool(vendor),
        "paid": doc.status in PAID_STATUSES,
        "named_by": _named_by(doctype, doc, vendor) if answer["account"] else None,
    }


def _row_fields(doctype: str, *extra: str) -> list[str]:
    """What a row's answer is read from: its copy, its vendor where it has one (only `Non Project
    Expenses` has none), an expense's type and the request it came from."""
    fields = ["name", *PAY_TO_FIELDS, *extra]
    if doctype != PAYMENT_DOCTYPE:
        fields += ["type", "request_id"]
    if frappe.get_meta(doctype).has_field("vendor"):
        fields.append("vendor")
    return fields


def _row_facts(doctype: str, row) -> dict:
    return {"doctype": doctype, "vendor": row.get("vendor"), "expense_type": row.get("type"),
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
