# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Paying an expense: who to pay, and changing it before paying (spec #1420 ticket #1431, ADR-0033).

Thin: check who is asking, call the Payee module (`services/payees/paid_to`, `expense_payee`),
commit.

* `get_paid_to` -- who each ticked row is paid to, read now: Export for Payment's ICICI / Cashfree file.
* `get_expense_payee` -- Record Payment's "Pay ₹X to" box.
* `search_payees` -- Change payee's picker: Payees by holder name or account number.
* `change_expense_payee` -- Change payee. Ticket 9's rules are the module's (`change_expense_payee`).

Who: reading follows the ledger (whoever may read the payment or expense sees who it pays, as the
queue shows it). Searching and changing are Accounts only (`PAYEE_MANAGE_PROFILES`); new bank
details in Change payee go through the Payees page's `add_payee` / `check_payee`, Accounts only too.
"""

import json

import frappe

from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES
from nirmaan_stack.services.payees import expense_payee
from nirmaan_stack.services.payees.paid_to import assert_paid_to_doctype, expense_pay_to, paid_to_for
from nirmaan_stack.services.payees.search import find_payees
from nirmaan_stack.services.role_profiles import assert_payee_manager


@frappe.whitelist()
def get_paid_to(rows: str | list[dict]) -> list[dict]:
    """Who each row is paid to, in the order sent. `rows` is `[{doctype, name}]` (`Project Payments`,
    `Project Expenses`, `Non Project Expenses`). Each answer is `{account, missing, payee_rule}`
    (`services/payees/paid_to.paid_to_rows`)."""
    if isinstance(rows, str):
        rows = json.loads(rows)
    rows = list(rows or [])
    for doctype in {row.get("doctype") for row in rows}:
        assert_paid_to_doctype(doctype)
        frappe.has_permission(doctype, "read", throw=True)
    return paid_to_for(rows)


@frappe.whitelist()
def get_expense_payee(doctype: str, name: str) -> dict:
    """The "Pay ₹X to" box for expense `name`: `{name, amount, payee, payee_rule, vendor,
    vendor_name, vendor_fixed, paid, named_by}` (`services/payees/paid_to.expense_pay_to`)."""
    assert_paid_to_doctype(doctype, EXPENSE_DOCTYPES)
    frappe.has_permission(doctype, "read", doc=name, throw=True)
    return expense_pay_to(doctype, name)


@frappe.whitelist()
def search_payees(text: str | None = None, limit: int = 8) -> list[dict]:
    """Payees matching `text`, by holder name (`services/payees/search.find_payees`)."""
    assert_payee_manager(frappe.session.user)
    return find_payees(text, limit=limit)


@frappe.whitelist(methods=["POST"])
def change_expense_payee(doctype: str, name: str, payee: str | None = None) -> dict:
    """Point expense `name` at Payee `payee` (or none), until it is paid. Returns the new box."""
    assert_payee_manager(frappe.session.user)
    assert_paid_to_doctype(doctype, EXPENSE_DOCTYPES)
    expense_payee.change_expense_payee(doctype, name, payee or None)
    frappe.db.commit()
    return expense_pay_to(doctype, name)
