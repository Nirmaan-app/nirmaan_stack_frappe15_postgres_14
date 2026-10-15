# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""`validate` for `Vendors`, `Expense Request` and `Project Expenses` (#1423, #1436, spec #1420,
ADR-0033).

The rules live in the Payee module (`services/payees/guard.check_payee_links`): a request or Project
Expense naming a vendor copies the vendor's Payee into its pay-to account, and only the vendor screens'
roles set a vendor's Payee.
"""

import frappe

from nirmaan_stack.services.payees.guard import check_payee_links


def validate(doc, method=None):
    """Apply the Payee module's save rules to `doc` as the session user (may fill in its pay-to
    account)."""
    check_payee_links(doc, frappe.session.user)
