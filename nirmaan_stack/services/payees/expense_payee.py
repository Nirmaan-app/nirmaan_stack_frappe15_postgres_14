# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Who an expense pays (spec #1420 tickets #1429, #1436, ADR-0033): the Expense payee.

* `payee_rule` -- an expense type's *Who gets paid* (a screen rule since #1436).
* `change_expense_payee` -- Record Payment's Change payee: copies a Payee's account onto the expense
  and saves. The calling endpoint checks the role; the server refuses nothing else (#1436).

Approval copies the request's pay-to account onto the Expense as it is (`api/expense_requests/convert`,
`pay_to.copy_pay_to`).
"""

from __future__ import annotations

import frappe

from nirmaan_stack.services.payees.expense_rules import NOT_ASKED
from nirmaan_stack.services.payees.pay_to import copy_payee_account


def payee_rule(expense_type: str) -> str:
    """The type's *Who gets paid* rule; a blank one is *Not asked*."""
    return frappe.db.get_value("Expense Type", expense_type, "payee_rule") or NOT_ASKED


def change_expense_payee(doctype: str, name: str, payee: str | None):
    """Copy Payee `payee`'s account (or none) onto a Project Expense or Non-Project Expense: Record
    Payment's Change payee. Which records may still change, and by whom, are screen rules (#1436). The
    row is locked first. The save leaves the Version row Record Payment's "Named by" reads
    (`paid_to.expense_pay_to`): `ignore_version=False`, as Frappe skips it under tests otherwise.
    Never commits."""
    doc = frappe.get_doc(doctype, name, for_update=True)
    # The Payee's account is copied onto the expense (#1436); #1438 makes this Change account.
    copy_payee_account(doc, payee or None)
    doc.save(ignore_permissions=True, ignore_version=False)
    return doc
