# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Who may approve or reject a Vendor Invoice on a Purchase Order (#1638).

An approved PO invoice counts toward the PO's Total Amount Invoiced and invoiced quantities, so moving its
status takes an invoice-approval role (`role_profiles.INVOICE_APPROVAL_PROFILES`: the Pending queue's roles).
Only the decision is narrowed: uploading and editing a PO invoice keep ADR-0014's rules.

**The system decides too.** Auto-approval (at upload, on the daily re-check and the Re-check button) moves a
PO invoice to Approved while the session user is whoever uploaded it or pressed the button. Such a save
carries `SYSTEM_DECISION_FLAG` in `doc.flags`, which only server code can set (`flags` is a reserved key a
REST or Desk payload cannot write), and passes.

Pure: the caller resolves the user's role and the flag and passes the answers in. The Vendor Invoices
`validate` hook applies it, so the approve endpoint, Desk and the REST API obey it.
"""

import frappe
from frappe.utils import cstr

PURCHASE_ORDER = "Procurement Orders"
PENDING = "Pending"

#: Set on `doc.flags` by the system's own decision (`_auto_approve.apply_auto_approval`).
SYSTEM_DECISION_FLAG = "system_invoice_decision"

DECIDE_REFUSAL = "Only Admin and Accountants can approve or reject a Purchase Order invoice."


class PurchaseOrderInvoiceRefused(frappe.ValidationError):
    """The user may not decide this Purchase Order invoice."""

    http_status_code = 403


def is_purchase_order_invoice(invoice) -> bool:
    """True for a Vendor Invoice billed against a Purchase Order (a doc or a mapping)."""
    return bool(invoice) and invoice.get("document_type") == PURCHASE_ORDER


def decision_problem(before, after, *, may_decide: bool, by_system: bool) -> str | None:
    """Why this save of a PO invoice is refused, or None. `before` is None for a new invoice.

    A decision is any status change, or a new invoice born past Pending.
    """
    if not (is_purchase_order_invoice(after) or is_purchase_order_invoice(before)):
        return None
    if may_decide or by_system:
        return None
    status_after = cstr(after.get("status"))
    if before is None:
        return DECIDE_REFUSAL if status_after not in ("", PENDING) else None
    return DECIDE_REFUSAL if cstr(before.get("status")) != status_after else None
