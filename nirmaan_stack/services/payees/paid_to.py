# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Who a payment row is paid to (spec #1420 ticket #1431, ADR-0033). Read-only.

The one place "who to pay" is resolved for a row the accountant pays: "Payment need to paid"'s
Paid to column, the ICICI / Cashfree file and Record Payment's "Pay ₹X to" box all read it here.

* A **PO / WO payment** (`Project Payments`) is paid into its vendor's Payee as it is NOW: the
  payment stores none (ADR-0033 "Not in v1"). No Payee: `VENDOR_HAS_NO_PAYEE`.
* A **Project / Non-Project Expense** is paid into its own `payee`. None: `EXPENSE_HAS_NO_PAYEE`,
  with the type's *Who gets paid* rule, so the screen can say whether the type needs one.

`expense_pay_to` is the "Pay ₹X to" box: the expense's Payee, whether Change payee is closed to it,
and who named the Payee: the accountant who last changed it (`change_expense_payee` leaves a
Version row), else the raiser of the request it came from, else the vendor it is paid through.
"""

from __future__ import annotations

import frappe
from frappe import _

from nirmaan_stack.services.payees.expense_payee import PAID
from nirmaan_stack.services.payees.expense_rules import NOT_ASKED
from nirmaan_stack.services.payees.links import payee_summary
from nirmaan_stack.services.payees.vendor_account import VENDOR_ACCOUNT_FIELDS, vendor_accounts

PAYMENT_DOCTYPE = "Project Payments"
EXPENSE_DOCTYPES = ("Project Expenses", "Non Project Expenses")
#: The row kinds the accountant pays.
PAID_TO_DOCTYPES = (PAYMENT_DOCTYPE, *EXPENSE_DOCTYPES)

#: Why a row has no account to pay into.
VENDOR_HAS_NO_PAYEE = "vendor_has_no_payee"
EXPENSE_HAS_NO_PAYEE = "expense_has_no_payee"

#: How the Payee on an expense was named (`expense_pay_to`'s `named_by.how`).
NAMED_ON_REQUEST = "request"
NAMED_BY_CHANGE = "changed"
NAMED_BY_VENDOR = "vendor"


def assert_paid_to_doctype(doctype: str, allowed=PAID_TO_DOCTYPES) -> None:
    """Refuse a doctype that is not a payment row the accountant pays."""
    if doctype not in allowed:
        frappe.throw(_("{0} is not a payment or an expense.").format(doctype))


def paid_to_rows(rows: list[dict]) -> list[dict]:
    """Who each row is paid to, in order. A row carries `doctype`, `vendor`, `payee` (an expense's
    own) and `expense_type`. Each answer is `{account, missing, payee_rule}`: `account` is
    `{payee, account_name, account_number, ifsc, bank_name, bank_branch, status}` or None;
    `missing` is None, `VENDOR_HAS_NO_PAYEE` or `EXPENSE_HAS_NO_PAYEE`; `payee_rule` is the expense
    type's rule on an expense with no Payee, else None. Three queries, whatever the row count."""
    is_payment = [row.get("doctype") == PAYMENT_DOCTYPE for row in rows]
    by_vendor = vendor_accounts(list({row.get("vendor") for row, p in zip(rows, is_payment) if p} - {None, ""}))
    by_payee = _payee_accounts({row.get("payee") for row, p in zip(rows, is_payment) if not p})
    rules = _payee_rules({row.get("expense_type") for row, p in zip(rows, is_payment)
                          if not p and not by_payee.get(row.get("payee"))})

    answers = []
    for row, payment in zip(rows, is_payment):
        if payment:
            account = by_vendor.get(row.get("vendor"))
            answers.append({"account": account, "missing": None if account else VENDOR_HAS_NO_PAYEE,
                            "payee_rule": None})
            continue
        account = by_payee.get(row.get("payee"))
        answers.append({
            "account": account,
            "missing": None if account else EXPENSE_HAS_NO_PAYEE,
            "payee_rule": None if account else rules.get(row.get("expense_type")) or NOT_ASKED,
        })
    return answers


def paid_to_for(keys: list[dict]) -> list[dict]:
    """`paid_to_rows` for rows named by `{doctype, name}` only, read from the stored records now
    (the bank file pays into the account as it is at export). An unknown row has no account."""
    for key in keys:
        assert_paid_to_doctype(key.get("doctype"))
    facts = {}
    for doctype in PAID_TO_DOCTYPES:
        names = [k["name"] for k in keys if k["doctype"] == doctype]
        if not names:
            continue
        fields = ["name", "vendor"] if doctype == PAYMENT_DOCTYPE else ["name", "payee", "type"]
        if doctype == "Project Expenses":
            fields.append("vendor")
        for row in frappe.get_all(doctype, filters={"name": ["in", names]}, fields=fields):
            facts[(doctype, row.name)] = {"doctype": doctype, "vendor": row.get("vendor"),
                                          "payee": row.get("payee"), "expense_type": row.get("type")}
    return paid_to_rows([facts.get((k["doctype"], k["name"]), {"doctype": k["doctype"]}) for k in keys])


def expense_pay_to(doctype: str, name: str) -> dict:
    """The "Pay ₹X to" box for an expense: `{name, amount, payee: <payee_summary> | None,
    payee_rule, vendor, vendor_name, vendor_fixed, paid, named_by}`. `vendor_fixed`: a Project
    Expense with a vendor is paid into that vendor's Payee, so Change payee can't pick another.
    `named_by` is `{how, user, full_name, on}` (`on` an ISO date) or None when nothing records it."""
    assert_paid_to_doctype(doctype, EXPENSE_DOCTYPES)
    fields = ["name", "amount", "payee", "type", "status", "request_id"]
    if doctype == "Project Expenses":
        fields.append("vendor")
    doc = frappe.db.get_value(doctype, name, fields, as_dict=True)
    if not doc:
        frappe.throw(_("{0} {1} not found.").format(doctype, name), frappe.DoesNotExistError)
    vendor = doc.get("vendor") or None
    return {
        "name": doc.name,
        "amount": float(doc.amount or 0),
        "payee": payee_summary(doc.payee) if doc.payee else None,
        "payee_rule": _payee_rules({doc.type}).get(doc.type) or NOT_ASKED,
        "vendor": vendor,
        "vendor_name": frappe.db.get_value("Vendors", vendor, "vendor_name") if vendor else None,
        "vendor_fixed": bool(vendor),
        "paid": doc.status == PAID,
        "named_by": _named_by(doctype, doc, vendor) if doc.payee else None,
    }


def _named_by(doctype, doc, vendor) -> dict | None:
    changed = frappe.db.sql(
        """SELECT owner, creation FROM "tabVersion"
           WHERE ref_doctype = %(doctype)s AND docname = %(name)s AND data LIKE '%%["payee",%%'
           ORDER BY creation DESC LIMIT 1""",
        {"doctype": doctype, "name": doc.name},
        as_dict=True,
    )
    if changed:
        return _named(NAMED_BY_CHANGE, changed[0].owner, changed[0].creation)
    if doc.request_id:
        request = frappe.db.get_value("Expense Request", doc.request_id, ["owner", "creation", "payee"],
                                      as_dict=True)
        if request and request.payee == doc.payee:
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


def _payee_accounts(names) -> dict[str, dict]:
    names = [n for n in names if n]
    if not names:
        return {}
    fields = ["name as payee", *(f for f in VENDOR_ACCOUNT_FIELDS if f != "payee")]
    rows = frappe.get_all("Payee", filters={"name": ["in", names]}, fields=fields)
    return {row.payee: {field: row.get(field) for field in VENDOR_ACCOUNT_FIELDS} for row in rows}


def _payee_rules(types) -> dict[str, str]:
    types = [t for t in types if t]
    if not types:
        return {}
    rows = frappe.get_all("Expense Type", filters={"name": ["in", types]}, fields=["name", "payee_rule"])
    return {row.name: row.payee_rule for row in rows}
