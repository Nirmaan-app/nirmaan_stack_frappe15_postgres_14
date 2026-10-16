# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Record a Direct Expense (spec #1470 ticket #1471, ADR-0033 decision 5).

URL: /api/method/nirmaan_stack.api.expenses.direct_expense.create_direct_expense

A Direct Expense is one the Add Expense dialogs record straight away, with no Expense Request behind
it. It names who gets paid the way a request does: the Payee picked is copied into its pay-to account
in the same save (`services/payees/expense_payee.create_direct_expense`).

Thin: check the doctype and Frappe's create permission on it, call the Payee module, commit once.
"""

import json

import frappe

from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES
from nirmaan_stack.services.payees import expense_payee


@frappe.whitelist(methods=["POST"])
def create_direct_expense(doctype: str, expense: str | dict, payee: str | None = None) -> dict:
    """Record a `Project Expenses` or `Non Project Expenses` row from `expense` and copy Payee
    `payee`'s account into its pay-to account. Returns `{name, status}`: the status the doctype gave it.

    `expense` is the dialog's fields (`expense_payee.DIRECT_EXPENSE_FIELDS`: projects, vendor, type,
    description, comment, amount, the payment and invoice details), as an object or a JSON string;
    any other field is refused. With a vendor named (Project Expense) the Payee sent is ignored: the
    save copies the vendor's Payee, as on an Expense Request. An unknown Payee is refused and nothing is
    saved. No status is set here and nothing about who gets paid is refused.

    Example: `{"doctype": "Non Project Expenses", "expense": {"type": "Rent", "amount": 9000,
    "description": "October rent"}, "payee": "PYE-0012"}` -> `{"name": "...", "status": "Approved"}`.
    """
    if doctype not in EXPENSE_DOCTYPES:
        frappe.throw(f"{doctype} is not an expense.")
    frappe.has_permission(doctype, "create", throw=True)
    if isinstance(expense, str):
        expense = json.loads(expense)
    doc = expense_payee.create_direct_expense(doctype, dict(expense or {}), payee or None)
    frappe.db.commit()
    return {"name": doc.name, "status": doc.status}
