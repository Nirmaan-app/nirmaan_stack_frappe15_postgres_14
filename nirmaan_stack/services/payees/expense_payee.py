# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Who an expense pays (spec #1420 tickets #1429, #1436, #1438, ADR-0033): the Expense payee.

* `change_expense_account` -- Record Payment's Change account: copies a Payee's account onto the
  expense's own pay-to account and saves. The pay-to account is payment information, so the change
  asks `expense_decision.assert_may_edit` first (spec #1494 story 50): before Paid, an Accountant or
  the Accountant Lead; once Paid, nobody.

Approval copies the request's pay-to account onto the Expense as it is (`api/expense_requests/convert`,
`pay_to.copy_pay_to`).
"""

from __future__ import annotations

import frappe

from nirmaan_stack.services.expense_decision import assert_may_edit
from nirmaan_stack.services.payees.pay_to import PAY_TO_FIELDS, copy_payee_account


def change_expense_account(doctype: str, name: str, payee: str | None):
    """Overwrite a Project Expense's or Non-Project Expense's pay-to account with Payee `payee`'s
    account (None clears it), as the session user. The row is locked first, and refused unless that
    user may edit its `pay_to_*` fields (`expense_decision.assert_may_edit`): the save ignores
    permissions, so the hand-save guard does not ask. The save leaves the Version row that records
    who changed it and when (`paid_to.pay_to_box`'s `named_by`): `ignore_version=False`, as Frappe
    skips it under tests otherwise. Never commits."""
    doc = frappe.get_doc(doctype, name, for_update=True)
    assert_may_edit(doc, doc.status, frappe.session.user, PAY_TO_FIELDS)
    copy_payee_account(doc, payee or None)
    doc.save(ignore_permissions=True, ignore_version=False)
    return doc
