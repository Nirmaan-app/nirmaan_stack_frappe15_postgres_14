import json
import frappe

from nirmaan_stack.api.delivery_notes._permission_utils import (
    check_dn_edit_permission,
)


def _norm_make(value):
    if isinstance(value, str):
        return value.strip() or None
    return value or None


def _safe_float(value, default=0.0):
    if value is None:
        return default
    try:
        return float(value)
    except (ValueError, TypeError):
        return default


@frappe.whitelist()
def edit_itm_delivery_note(dn_name: str, modified_items):
    """
    Edit quantities of an existing ITM-backed Delivery Note.

    Aggregation on ITM DNs is keyed by (item_id, make), so modified_items
    must be a list of `{item_id, make, delivered_quantity}` rather than a
    flat dict (a dict keyed by item_id alone would collide for ITMs holding
    the same item in two makes).

    Items with `delivered_quantity <= 0` are removed. If no items remain,
    the DN is deleted entirely. ITM delivery fields (received quantities,
    status, warehouse stock) are recalculated via on_update / after_delete
    hooks on the `Delivery Notes` doctype.

    Args:
        dn_name: Name of the Delivery Note (e.g. "DN/ITM/<itm-id>/<n>")
        modified_items: List of {item_id, make, delivered_quantity}, or a
            JSON-encoded string of the same.
    """
    try:
        frappe.db.begin()

        if isinstance(modified_items, str):
            modified_items = json.loads(modified_items)

        if not isinstance(modified_items, list):
            frappe.throw(
                "modified_items must be a list of {item_id, make, delivered_quantity}",
                frappe.ValidationError,
            )

        dn = frappe.get_doc("Delivery Notes", dn_name)

        check_dn_edit_permission(dn)

        if dn.is_return:
            frappe.throw(
                "Return notes cannot be edited. Create a new delivery note instead.",
                frappe.ValidationError,
            )

        if dn.parent_doctype != "Internal Transfer Memo":
            frappe.throw(
                "This delivery note is not linked to an Internal Transfer Memo "
                "and cannot be edited here.",
                frappe.ValidationError,
            )

        # Build the requested-quantity map keyed by (item_id, make)
        requested = {}
        for req in modified_items:
            key = (req["item_id"], _norm_make(req.get("make")))
            requested[key] = _safe_float(req.get("delivered_quantity"))

        # Lookup parent ITM items by (item_id, make) for any newly-added rows
        itm = frappe.get_doc("Internal Transfer Memo", dn.parent_docname)
        itm_items_by_key = {
            (it.item_id, _norm_make(it.make)): it for it in itm.items
        }

        processed_keys = set()

        # Update existing DN rows in place
        for item in dn.items:
            key = (item.item_id, _norm_make(item.make))
            if key in requested:
                item.delivered_quantity = requested[key]
                processed_keys.add(key)

        # Append any requested rows that weren't already present on the DN
        for key, qty in requested.items():
            if key in processed_keys:
                continue
            if qty <= 0:
                continue
            itm_item = itm_items_by_key.get(key)
            if not itm_item:
                # Unknown (item, make) for this ITM — skip rather than error
                # so a partial edit can still go through.
                continue
            dn.append("items", {
                "item_id": itm_item.item_id,
                "item_name": itm_item.item_name,
                "make": itm_item.make,
                "unit": itm_item.unit,
                "category": itm_item.category,
                "delivered_quantity": qty,
            })

        # Drop rows where qty <= 0
        dn.items = [item for item in dn.items if item.delivered_quantity > 0]

        if not dn.items:
            # No items left — delete the DN. The after_delete hook recalculates
            # ITM delivery fields (received qty, status, warehouse stock).
            frappe.delete_doc(
                "Delivery Notes", dn_name, ignore_permissions=True
            )
            frappe.db.commit()
            return {
                "status": 200,
                "message": f"Delivery note {dn_name} deleted (all items removed)",
            }

        # Save updated rows. The on_update hook recalculates ITM delivery
        # fields, including warehouse stock deltas for warehouse-target ITMs.
        dn.save(ignore_permissions=True)
        frappe.db.commit()

        return {
            "status": 200,
            "message": "Delivery note updated successfully",
        }

    except Exception as e:
        frappe.db.rollback()
        frappe.log_error("ITM Delivery Note Edit Error", str(e))
        return {
            "status": 400,
            "error": str(e),
        }
