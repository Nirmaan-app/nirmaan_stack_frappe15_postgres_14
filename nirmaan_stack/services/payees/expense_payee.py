# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Who an expense pays (spec #1420 tickets #1429, #1436, #1438, ADR-0033): the Expense payee.

* `change_expense_account` -- Record Payment's Change account: copies a Payee's account onto the
  expense's own pay-to account and saves. The calling endpoint checks write permission; the server
  refuses nothing else (#1436): who sees Change account and which expenses may still change are
  screen rules.

Approval copies the request's pay-to account onto the Expense as it is (`api/expense_requests/convert`,
`pay_to.copy_pay_to`).
"""

from __future__ import annotations

import frappe

from nirmaan_stack.services.payees.pay_to import copy_payee_account


def change_expense_account(doctype: str, name: str, payee: str | None):
    """Overwrite a Project Expense's or Non-Project Expense's pay-to account with Payee `payee`'s
    account (None clears it). The row is locked first. The save leaves the Version row that records
    who changed it and when (`paid_to.pay_to_box`'s `named_by`): `ignore_version=False`, as Frappe
    skips it under tests otherwise. Never commits."""
    doc = frappe.get_doc(doctype, name, for_update=True)
    copy_payee_account(doc, payee or None)
    doc.save(ignore_permissions=True, ignore_version=False)
    return doc
