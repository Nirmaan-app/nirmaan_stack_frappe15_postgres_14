# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Expense bill approval: Vendor Invoice Recon -> Pending Approval -> Cashbook / Credit Card (#1644, spec #1637,
GLOSSARY *Expense bill approval*, ADR-0045).

URLs: /api/method/nirmaan_stack.api.expenses.expense_bill_approval.<approve_expense_bill | reject_expense_bill>

Gate: the Vendor Invoice approvers (`role_profiles.INVOICE_APPROVAL_PROFILES`: Admin, Accountant, Accountant Lead),
checked here on the server, not only by the screen.
"""

import frappe

from nirmaan_stack.services.expense_bills.approval import approve_bill, reject_bill
from nirmaan_stack.services.expense_invoices import require_profile
from nirmaan_stack.services.role_profiles import INVOICE_APPROVAL_PROFILES


def _require_approver() -> str:
    return require_profile(INVOICE_APPROVAL_PROFILES, "Only an Admin or an Accountant can approve or reject an expense bill.")


@frappe.whitelist(methods=["POST"])
def approve_expense_bill(bill: str, invoice_no: str | None = None, invoice_date: str | None = None) -> dict:
    """Approve waiting Expense bill `bill` (Pending, latest, read). `invoice_no` and `invoice_date` (ISO, not in the
    future) are optional corrections; left out, the bill's own, else the ones typed on the Expense, are kept. Both
    are mirrored onto the Expense; `approved_by` and `approved_on` record who and when.

    Example: `{"bill": "EB-2026-00042", "invoice_no": "INV-9A", "invoice_date": "2026-09-08"}` ->
    `{"name": "EB-2026-00042"}`.
    """
    user = _require_approver()
    approve_bill(bill, invoice_no, invoice_date, user)
    frappe.db.commit()
    return {"name": bill}


@frappe.whitelist(methods=["POST"])
def reject_expense_bill(bill: str, reason: str) -> dict:
    """Reject waiting Expense bill `bill` for the typed `reason` (required). The Expense's invoice attachment, ref
    and date are cleared, so it waits again in its Pending Invoices Upload tab, showing the reason.

    Example: `{"bill": "EB-2026-00042", "reason": "Bill of another shop"}` -> `{"name": "EB-2026-00042"}`.
    """
    user = _require_approver()
    reject_bill(bill, reason, user)
    frappe.db.commit()
    return {"name": bill}
