# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""`validate` for every record that links a Payee: `Vendors`, `Expense Request`, `Project Expenses`
and `Non Project Expenses` (#1423, spec #1420, ADR-0033).

The Payee rules no screen or API can skip live in the Payee module
(`services/payees/guard.check_payee_links`): a vendor's Payee, an expense type's *Who gets paid*,
an expense's Payee fixed once paid and changed only by Accounts, and who may set a vendor's Payee.
"""

import frappe

from nirmaan_stack.services.payees.guard import check_payee_links


def validate(doc, method=None):
    """Apply the Payee module's save rules to `doc` as the session user (may fill in `doc.payee`)."""
    check_payee_links(doc, frappe.session.user)
