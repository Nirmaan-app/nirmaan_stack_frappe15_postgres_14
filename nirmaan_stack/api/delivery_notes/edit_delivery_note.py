import frappe
from datetime import date


ALWAYS_EDIT_ROLES = [
    "Nirmaan Admin Profile",
    "Nirmaan PMO Executive Profile",
    "Nirmaan Project Lead Profile",
    "Nirmaan Procurement Executive Profile",
]


def _check_edit_permission(dn):
    """
    Validate that the current user has permission to edit this Delivery Note.

    Rules:
        - Admin, PMO, Procurement Exec, Project Lead: always allowed
        - Project Manager: only if they created the DN AND it was created today
        - All others: denied
    """
    current_user = frappe.session.user

    # Administrator is always allowed
    if current_user == "Administrator":
        return

    role_profile = frappe.db.get_value(
        "Nirmaan Users", current_user, "role_profile"
    )

    if role_profile in ALWAYS_EDIT_ROLES:
        return

    if role_profile == "Nirmaan Project Manager Profile":
        is_creator = dn.updated_by_user == current_user
        is_created_today = dn.creation.date() == date.today()

        if is_creator and is_created_today:
            return

        frappe.throw(
            "Project Managers can only edit delivery notes they created on the same day",
            frappe.PermissionError,
        )

    frappe.throw(
        "Insufficient permissions to edit this delivery note",
        frappe.PermissionError,
    )


@frappe.whitelist()
def edit_delivery_note(dn_name: str, modified_items: dict):
    """
    Edit quantities of an existing Delivery Note.

    Updates delivered_quantity on individual DN items. Items with quantity <= 0
    are removed. If no items remain, the DN is deleted entirely. PO delivery
    fields are recalculated automatically via on_update / on_trash hooks.

    Args:
        dn_name: Name of the Delivery Note (e.g. "DN-.2026.-.00001")
        modified_items: Dict of {item_id: new_delivered_quantity}
    """
    try:
        frappe.db.begin()

        dn = frappe.get_doc("Delivery Notes", dn_name)

        _check_edit_permission(dn)

        if dn.is_return:
            frappe.throw(
                "Return notes cannot be edited. Create a new delivery note instead.",
                frappe.ValidationError,
            )

        # ITM-backed DNs cannot be edited via this PO-specific endpoint
        if not dn.procurement_order:
            frappe.throw(
                "This delivery note is not linked to a Procurement Order and cannot be edited here.",
                frappe.ValidationError,
            )

        processed_item_ids = set()

        # Update existing DN items
        for item in dn.items:
            if item.item_id in modified_items:
                item.delivered_quantity = float(modified_items[item.item_id])
                processed_item_ids.add(item.item_id)

        # Add new items not already in the DN
        po = frappe.get_doc("Procurement Orders", dn.procurement_order)
        po_items_by_id = {
            i.item_id: i for i in po.get("items")
            if i.category != "Additional Charges"
        }

        for item_id, qty in modified_items.items():
            if item_id in processed_item_ids:
                continue
            new_qty = float(qty)
            if new_qty <= 0:
                continue
            po_item = po_items_by_id.get(item_id)
            if not po_item:
                continue
            dn.append("items", {
                "item_id": po_item.item_id,
                "item_name": po_item.item_name,
                "make": getattr(po_item, "make", None),
                "unit": po_item.unit,
                "category": po_item.category,
                "procurement_package": getattr(po_item, "procurement_package", None),
                "delivered_quantity": new_qty,
            })

        # Remove items where delivered_quantity <= 0
        dn.items = [
            item for item in dn.items
            if item.delivered_quantity > 0
        ]

        if not dn.items:
            # No items remain — delete the DN entirely.
            # on_trash hook recalculates PO delivery fields.
            frappe.delete_doc(
                "Delivery Notes", dn_name, ignore_permissions=True
            )
            frappe.db.commit()

            return {
                "status": 200,
                "message": f"Delivery note {dn_name} deleted (all items removed)",
            }

        # Save with updated items.
        # on_update hook recalculates PO delivery fields.
        dn.save(ignore_permissions=True)
        frappe.db.commit()

        return {
            "status": 200,
            "message": "Delivery note updated successfully",
        }

    except Exception as e:
        frappe.db.rollback()
        frappe.log_error("Delivery Note Edit Error", str(e))
        return {
            "status": 400,
            "error": str(e),
        }
