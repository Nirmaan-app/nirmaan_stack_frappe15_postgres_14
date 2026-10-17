# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Who an expense pays (spec #1420 tickets #1429, #1436, #1438, ADR-0033): the Expense payee.

* `change_expense_account` -- Record Payment's Change account: copies a Payee's account onto the
  expense's own pay-to account and saves. The calling endpoint checks write permission; the server
  refuses nothing else (#1436): who sees Change account and which expenses may still change are
  screen rules.

* `create_direct_expense` -- a Direct Expense (Add Expense's Project Expense / Non-Project Expense,
  #1471): inserted with the Payee picked copied into its pay-to account, in one save.

Approval copies the request's pay-to account onto the Expense as it is (`api/expense_requests/convert`,
`pay_to.copy_pay_to`).
"""

from __future__ import annotations

import frappe

from nirmaan_stack.services.payees.pay_to import apply_picked_payee, copy_payee_account

#: What the Add Expense dialogs may set on a Direct Expense. A CLOSED list: status, the approval
#: stamps and the pay-to account are the doctype's and the Payee module's to write, never the caller's.
DIRECT_EXPENSE_FIELDS = frozenset({
    "projects", "vendor", "type", "description", "comment", "amount",
    "payment_date", "payment_ref", "payment_attachment",
    "invoice_date", "invoice_ref", "invoice_attachment",
})


def create_direct_expense(doctype: str, fields: dict, payee: str | None):
    """Insert a `doctype` expense from `fields` (`DIRECT_EXPENSE_FIELDS` the doctype has) with Payee
    `payee`'s account in its pay-to account (`pay_to.apply_picked_payee`: with a vendor named the
    Payee is ignored and the save copies the vendor's). The copy is made before the insert, so the
    expense is never saved without it; an unknown Payee is refused before anything is written.

    Sets no status: the doctype's `validate` decides it (auto-approval, the Raiser's own step).
    Refuses nothing about who gets paid (a *Required* type with no account is a screen rule,
    ADR-0033 decision 9). The insert checks Frappe's create permission. Never commits."""
    doc = frappe.new_doc(doctype)
    unknown = sorted(f for f in fields if f not in DIRECT_EXPENSE_FIELDS or not doc.meta.has_field(f))
    if unknown:
        frappe.throw(f"A {doctype} cannot be recorded with: {', '.join(unknown)}.")
    doc.update(fields)
    apply_picked_payee(doc, payee or None)
    doc.insert()
    return doc


def change_expense_account(doctype: str, name: str, payee: str | None):
    """Overwrite a Project Expense's or Non-Project Expense's pay-to account with Payee `payee`'s
    account (None clears it). The row is locked first. The save leaves the Version row that records
    who changed it and when (`paid_to.pay_to_box`'s `named_by`): `ignore_version=False`, as Frappe
    skips it under tests otherwise. Never commits."""
    doc = frappe.get_doc(doctype, name, for_update=True)
    copy_payee_account(doc, payee or None)
    doc.save(ignore_permissions=True, ignore_version=False)
    return doc
