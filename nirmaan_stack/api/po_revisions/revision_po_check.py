import frappe
from frappe import _
import json

@frappe.whitelist()
def check_po_in_pending_revisions(po_id):
    """
    Checks if a given PO is locked by any Pending PO Revision,
    either as the Original PO or as an incoming Target PO.
    Returns dict with 'is_locked', 'role', 'revision_id', status code.
    """
    if not po_id:
        return {"is_locked": False}
        
    # Check 1: Is this PO the Original PO being revised?
    is_original_locked = _check_pending_as_original(po_id)
    if is_original_locked:
        return {
            "is_locked": True,
            "role": "Original PO",
            "revision_id": is_original_locked,
            "message": _(f"PO {po_id} is locked by Pending Revision: {is_original_locked}")
        }
        
    # Check 2: Is this PO a Target PO receiving credit from another revision?
    is_target_locked = _check_pending_as_target(po_id)
    if is_target_locked:
        return {
            "is_locked": True,
            "role": "Target PO",
            "revision_id": is_target_locked,
            "message": _(f"PO {po_id} is locked receiving credit from Pending Revision: {is_target_locked}")
        }
        
    # Free
    return {"is_locked": False, "message": _(f"PO {po_id} is not involved in any pending revisions.")}


def _check_pending_as_original(po_id):
    """
    Checks if the given PO ID is the 'revised_po' (Original PO)
    in any Pending PO Revisions.
    Returns the Revision ID if true, else False.
    """
    pending_revision = frappe.db.get_value(
        "PO Revisions",
        {"revised_po": po_id, "status": "Pending"},
        "name"
    )
    return pending_revision or False

def _check_pending_as_target(po_id):
    """
    Iterates through all Pending PO Revisions and checks their
    JSON structure to see if this PO ID is a Target PO in an 'Against-po' transfer.
    Returns the Revision ID if true, else False.
    """
    # Fetch all Pending Revisions that have some JSON details
    pending_revisions = frappe.get_all(
        "PO Revisions",
        filters={"status": "Pending"},
        fields=["name", "payment_return_details"]
    )
    
    for rev in pending_revisions:
        data = rev.get("payment_return_details")
        if not data:
            continue
            
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except Exception:
                continue
                
        if not isinstance(data, dict):
            continue
            
        block = data.get("list")
        if not isinstance(block, dict) or block.get("type") != "Refund Adjustment":
            continue
            
        entries = block.get("Details", [])
        if not isinstance(entries, list):
            entries = [entries] if entries else []
            
        # Inspect each entry in the JSON
        for entry in entries:
            if isinstance(entry, dict) and entry.get("return_type") == "Against-po":
                targets = entry.get("target_pos", [])
                if not isinstance(targets, list):
                    continue
                    
                for target in targets:
                    if isinstance(target, dict) and target.get("po_number") == po_id:
                        return rev.name # Found it! This PO is locked as a target.

    return False
