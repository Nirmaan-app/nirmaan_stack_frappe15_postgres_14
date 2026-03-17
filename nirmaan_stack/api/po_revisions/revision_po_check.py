import frappe
from frappe import _


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

    # Check 2: Is there a Pending PO Adjustment? (locks payments only)
    pending_adjustment = frappe.db.get_value(
        "PO Adjustments",
        {"po_id": po_id, "status": "Pending"},
        "name"
    )
    if pending_adjustment:
        result["is_payment_locked"] = True
        result["payment_lock_source"] = "PO Adjustment"
        result["payment_lock_id"] = pending_adjustment
        return result

    return result


@frappe.whitelist()
def get_all_locked_po_names():
    """
    Returns a unique list of all PO names currently involved in a Pending
    PO Revision (as Original only) or a Pending PO Adjustment.
    Useful for bulk filtering (e.g. merge candidates).
    """
    # Get all Original POs in pending revisions
    original_pos = frappe.get_all(
        "PO Revisions",
        filters={"status": "Pending"},
        pluck="revised_po"
    )
    locked_set = set(original_pos)

    # Get all POs with pending adjustments
    adjustment_pos = frappe.get_all(
        "PO Adjustments",
        filters={"status": "Pending"},
        pluck="po_id"
    )
    locked_set.update(adjustment_pos)

    return list(locked_set)
