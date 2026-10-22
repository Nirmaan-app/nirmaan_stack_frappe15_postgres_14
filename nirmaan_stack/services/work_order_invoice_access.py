# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Who may approve, reject and edit a Vendor Invoice on a Work Order (#1531, ADR-0014 Amendment A).

An approved Work Order invoice sets Total Amount Invoiced and GST Invoiced, which unlock payment
requests and the GST payment limit, so its figures are controlled:

* approving or rejecting it takes an invoice-approval role,
* editing its number, date or amounts takes an Accountant or Admin,
* once it is Approved, only an Admin may change them, or move it anywhere but Rejected: anyone else
  rejects it and uploads it again (a move back to Pending, an edit and a fresh approval would skip that;
  so a Rejected one is not brought back to Pending or Approved but by an Admin either),
* the Vendor Invoice a generated invoice's signed upload created (#1547) carries what the vendor signed:
  nobody changes its number, date or amounts, Admin included, and once Rejected (its generated invoice
  Voided) it stays Rejected.

Purchase Order invoices are untouched by every rule here. Uploading a new invoice is not narrowed.

Pure: the caller resolves who the user is (`services/role_profiles.can_*_wo_invoice`) and passes the
answers in. The Vendor Invoices `validate` hook applies it, so Desk and the API obey it.
"""

import frappe
from frappe.utils import cstr, flt, getdate

WORK_ORDER = "Service Requests"
PENDING = "Pending"
APPROVED = "Approved"
REJECTED = "Rejected"

#: What an invoice bills, and against which order. Changing any of these is an invoice edit.
BILLED_FIELDS = (
    "document_type",
    "document_name",
    "invoice_no",
    "invoice_date",
    "invoice_amount",
    "invoice_base_amount",
    "invoice_gst_amount",
    "is_credit_note",
)
_AMOUNT_FIELDS = {"invoice_amount", "invoice_base_amount", "invoice_gst_amount"}

DECIDE_REFUSAL = "Only Admin and Accountants can approve or reject a Work Order invoice."
EDIT_REFUSAL = "Only Admin and Accountants can edit a Work Order invoice."
APPROVED_MOVE_REFUSAL = (
    "An approved Work Order invoice is only rejected (with a reason), or corrected by an Admin."
)
REJECTED_MOVE_REFUSAL = (
    "A rejected Work Order invoice is uploaded again, not brought back; only an Admin can reopen it."
)
GENERATED_EDIT_REFUSAL = (
    "This invoice is the signed copy of a generated invoice: its number, date and amount are what the "
    "vendor signed and can't be changed. Reject it and generate a new one."
)
GENERATED_REJECTED_REFUSAL = (
    "This invoice was the signed copy of a generated invoice; rejecting it Voided that invoice, so it stays "
    "Rejected. Generate a new one."
)
APPROVED_REFUSAL = (
    "Only an Admin can change the amount, number or date of an approved Work Order invoice. "
    "To correct it, reject it and upload it again."
)


class WorkOrderInvoiceRefused(frappe.ValidationError):
    """The user may not make this change to a Work Order invoice."""

    http_status_code = 403


def is_work_order_invoice(invoice) -> bool:
    """True for a Vendor Invoice billed against a Work Order (a doc or a mapping)."""
    return bool(invoice) and invoice.get("document_type") == WORK_ORDER


def may_reject_approved(document_type: str, status: str, action: str) -> bool:
    """An Approved Work Order invoice may be rejected: the correction path for anyone who may not edit
    it. A Purchase Order invoice is decided only while Pending, as before."""
    return document_type == WORK_ORDER and status == APPROVED and action == REJECTED


def billed_fields_changed(before, after) -> bool:
    """True when any of `BILLED_FIELDS` differs, compared as values (a typed "1180" is 1180.0, a
    "2026-10-21" is that date), so a save that sends the same figures back changes nothing."""
    return any(_value(field, before.get(field)) != _value(field, after.get(field)) for field in BILLED_FIELDS)


def change_problem(
    before, after, *, may_decide: bool, may_edit: bool, may_override_decision: bool, generated: bool = False
) -> str | None:
    """Why this user may not save `after` over `before` (None for a new invoice), or None when they may.

    `may_decide` / `may_edit` / `may_override_decision` are the user's answers to the three role sets in
    `services/role_profiles` (WO_INVOICE_DECIDE_PROFILES, WO_INVOICE_EDIT_PROFILES,
    WO_APPROVED_INVOICE_EDIT_PROFILES); `may_override_decision` (Admin) changes an Approved invoice's
    figures, moves it anywhere but Rejected, and reopens a Rejected one. `generated`: a generated invoice's signed upload created this
    invoice. Reconciliation, autofill and attachment fields pass freely.
    """
    if not (is_work_order_invoice(after) or is_work_order_invoice(before)):
        return None

    if before is None:
        if cstr(after.get("status")) not in ("", PENDING) and not may_decide:
            return DECIDE_REFUSAL
        return None

    status_before, status_after = cstr(before.get("status")), cstr(after.get("status"))
    if generated and billed_fields_changed(before, after):
        return GENERATED_EDIT_REFUSAL
    # A Rejected invoice stays Rejected: a signed upload's for everyone (its generated invoice is Voided),
    # any other only an Admin may reopen (it is uploaded again).
    if status_before == REJECTED and status_after != REJECTED and (generated or not may_override_decision):
        return GENERATED_REJECTED_REFUSAL if generated else REJECTED_MOVE_REFUSAL

    if status_before != status_after and not may_decide:
        return DECIDE_REFUSAL
    if status_before == APPROVED and status_after not in (APPROVED, REJECTED) and not may_override_decision:
        return APPROVED_MOVE_REFUSAL

    if billed_fields_changed(before, after):
        if not may_edit:
            return EDIT_REFUSAL
        if before.get("status") == APPROVED and not may_override_decision:
            return APPROVED_REFUSAL
    return None


def _value(field, value):
    if field in _AMOUNT_FIELDS:
        return round(flt(value), 2)
    if field == "is_credit_note":
        return bool(flt(value))
    if field == "invoice_date":
        return getdate(value) if value else None
    return cstr(value).strip()
