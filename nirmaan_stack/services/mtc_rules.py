"""Material Test Certificate (MTC) rules -- the ONE home for "which PO lines can an MTC cover".

Pure: no ``frappe.db``, no request context (ADR-0010 B1). Used by the MTC controller
(``integrations/controllers/material_test_certificate.py``) and mirrored client-side by
``frontend/src/utils/mtc.ts`` -- keep the two in step.

Rules (owner, 2026-10-07):
* An MTC can be uploaded, edited or deleted on a Billable PO in ANY status except Merged,
  Cancelled and Inactive (owner ruling Q39, which replaced "Partially Delivered / Delivered only").
* An MTC covers Billable PO lines only. A line is identified by item + make.
* A line can be on at most one MTC of its PO.
"""

MTC_BLOCKED_STATUSES = ("Merged", "Cancelled", "Inactive")


def line_key(item_id, make) -> tuple:
    """Identity of a PO line for MTC purposes: (item_id, make), blanks normalised."""
    return ((item_id or "").strip(), (make or "").strip())


def po_block_reason(billing_status, status) -> str | None:
    """Why MTCs on this PO cannot be changed right now, or None when they can."""
    if billing_status != "Billable":
        return "Material Test Certificates can only be added to a Billable PO."
    if not status or status in MTC_BLOCKED_STATUSES:
        return (
            "Material Test Certificates can't be uploaded, edited or deleted on a "
            f"{status or 'status-less'} PO."
        )
    return None


def certificate_date_problem(certificate_date, today) -> str | None:
    """Why this Certificate Date is not acceptable, or None. Required, and never after `today`.

    Both arguments are `datetime.date` (or None); the caller converts with `getdate`.
    """
    if not certificate_date:
        return "Enter the Certificate Date printed on the certificate."
    if certificate_date > today:
        return "The Certificate Date can't be in the future."
    return None


def billable_lines(po_items) -> dict:
    """Billable PO lines keyed by ``line_key``. The first row wins when a PO repeats a line."""
    lines = {}
    for row in po_items or []:
        if (row.get("billing_status") or "") != "Billable":
            continue
        key = line_key(row.get("item_id"), row.get("make"))
        if key[0] and key not in lines:
            lines[key] = row
    return lines
