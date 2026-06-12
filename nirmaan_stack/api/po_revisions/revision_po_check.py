import frappe
from frappe import _
from frappe.utils import flt

# A PO Adjustment is "open" (payment-locked / surfaced) if it is Pending, OR if it
# is 'Done' but still carries usable overpaid credit (remaining_impact at/below this).
# This keeps a small Done credit reusable & visible (e.g. for a manual transfer).
PO_ADJUSTMENT_OPEN_CREDIT_THRESHOLD = -1.0


@frappe.whitelist()
def check_po_in_pending_revisions(po_id):
    """
    Checks if a given PO is locked by any Pending PO Revision (as original PO only)
    or by a Pending PO Adjustment.
    Returns dict with is_locked, is_item_locked, is_payment_locked, and lock source details.
    """
    if not po_id:
        return {"is_locked": False, "is_item_locked": False, "is_payment_locked": False}

    result = {
        "is_locked": False,
        "is_item_locked": False,
        "is_payment_locked": False,
        "item_lock_revision_id": None,
        "payment_lock_source": None,
        "payment_lock_id": None,
        # Soft advisory: a 'Done' adjustment still holding small overpaid credit.
        # Informational only — does NOT hard-lock payment terms.
        "has_credit_notice": False,
        "credit_notice_id": None,
        "remaining_credit": 0.0,
    }

    # Check 1: Is this PO the Original PO being revised? (locks both items and payments)
    pending_revision = frappe.db.get_value(
        "PO Revisions",
        {"revised_po": po_id, "status": "Pending"},
        "name"
    )
    if pending_revision:
        result["is_locked"] = True
        result["is_item_locked"] = True
        result["is_payment_locked"] = True
        result["item_lock_revision_id"] = pending_revision
        result["payment_lock_source"] = "PO Revision"
        result["payment_lock_id"] = pending_revision
        return result

    # Check 2: Is there a PO Adjustment on this PO?
    #   - status 'Pending' (material balance >= ₹100) -> HARD payment lock.
    #   - status 'Done' but still carrying small overpaid credit (remaining_impact
    #     <= -1) -> SOFT advisory only: payment terms stay usable; the credit is
    #     auto-applied to the next revision increase and can still be transferred/refunded.
    adjustment = frappe.db.get_value(
        "PO Adjustments",
        {"po_id": po_id},
        ["name", "status", "remaining_impact"],
        as_dict=True,
    )
    if adjustment:
        if adjustment.status == "Pending":
            result["is_payment_locked"] = True
            result["payment_lock_source"] = "PO Adjustment"
            result["payment_lock_id"] = adjustment.name
            return result
        if flt(adjustment.remaining_impact) <= PO_ADJUSTMENT_OPEN_CREDIT_THRESHOLD:
            result["has_credit_notice"] = True
            result["credit_notice_id"] = adjustment.name
            result["remaining_credit"] = abs(flt(adjustment.remaining_impact))

    return result


@frappe.whitelist()
def get_all_locked_po_names():
    """
    Returns a unique list of all PO names currently involved in a Pending
    PO Revision (as Original only) or an OPEN PO Adjustment.
    Open adjustment = Pending, OR 'Done' but still carrying usable overpaid
    credit (remaining_impact <= -1). Useful for bulk filtering (e.g. merge candidates).
    """
    # Get all Original POs in pending revisions
    original_pos = frappe.get_all(
        "PO Revisions",
        filters={"status": "Pending"},
        pluck="revised_po"
    )
    locked_set = set(original_pos)

    # POs with a Pending adjustment
    locked_set.update(frappe.get_all(
        "PO Adjustments",
        filters={"status": "Pending"},
        pluck="po_id"
    ))

    # POs with a 'Done' adjustment that still holds usable overpaid credit
    locked_set.update(frappe.get_all(
        "PO Adjustments",
        filters={"remaining_impact": ["<=", PO_ADJUSTMENT_OPEN_CREDIT_THRESHOLD]},
        pluck="po_id"
    ))

    return list(locked_set)
