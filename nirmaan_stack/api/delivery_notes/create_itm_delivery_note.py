import json
import frappe
from datetime import datetime


@frappe.whitelist()
def create_itm_delivery_note(itm_id, items, delivery_date=None, attachment=None):
    """Create a Delivery Note against an Internal Transfer Memo.

    Args:
        itm_id (str): Internal Transfer Memo ID
        items: JSON list of {item_id: str, delivered_quantity: float}
        delivery_date (str, optional): Delivery date (YYYY-MM-DD). Defaults to today.
        attachment (str, optional): URL of uploaded delivery challan/attachment.

    Returns:
        dict: {status: 200, dn_name: str, itm_status: str} on success
    """
    if isinstance(items, str):
        items = json.loads(items)

    if not items:
        frappe.throw("At least one item is required")

    itm = frappe.get_doc("Internal Transfer Memo", itm_id)

    if itm.status not in ("Dispatched", "Partially Delivered"):
        frappe.throw(
            f"Cannot create delivery note for ITM with status '{itm.status}'. "
            "ITM must be Dispatched or Partially Delivered."
        )

    # Build item lookup from ITM keyed by (item_id, make_or_None) so an ITM
    # with the same item in two makes (e.g., Tata + Jindal from warehouse) is
    # disambiguated when matching the request rows.
    def _norm_make(value):
        if isinstance(value, str):
            return value.strip() or None
        return value or None

    itm_items_map = {}
    for item in itm.items:
        itm_items_map[(item.item_id, _norm_make(item.make))] = item

    # Validate all request items exist in ITM (matched by (item_id, make))
    for req_item in items:
        key = (req_item["item_id"], _norm_make(req_item.get("make")))
        if key not in itm_items_map:
            label = req_item["item_id"] + (f" ({key[1]})" if key[1] else "")
            frappe.throw(
                f"Item '{label}' not found in ITM {itm_id}"
            )

    # Filter out items with delivered_quantity <= 0
    valid_items = [
        i for i in items
        if _safe_float(i.get("delivered_quantity")) > 0
    ]

    if not valid_items:
        frappe.throw("No items with positive delivered quantity")

    # Lock ITM row to prevent concurrent note_no races
    frappe.db.sql(
        'SELECT name FROM "tabInternal Transfer Memo" WHERE name = %s FOR UPDATE',
        itm_id,
    )

    # Calculate note_no
    result = frappe.db.sql(
        'SELECT COALESCE(MAX(note_no), 0) AS max_no '
        'FROM "tabDelivery Notes" '
        'WHERE parent_doctype = %s AND parent_docname = %s',
        ("Internal Transfer Memo", itm_id),
        as_dict=True,
    )
    note_no = result[0].max_no + 1

    if not delivery_date:
        delivery_date = datetime.now().strftime("%Y-%m-%d")

    # DN.project is mandatory. For warehouse-target ITMs, target_project is null —
    # fall back to source_project (the project the material is leaving).
    target_type = getattr(itm, "target_type", None) or "Project"
    dn_project = itm.target_project if target_type != "Warehouse" else itm.source_project

    # Create the Delivery Notes document
    dn = frappe.new_doc("Delivery Notes")
    dn.update({
        "parent_doctype": "Internal Transfer Memo",
        "parent_docname": itm_id,
        "procurement_order": None,
        "project": dn_project,
        "vendor": None,
        "note_no": note_no,
        "delivery_date": delivery_date,
        "updated_by_user": frappe.session.user,
        "is_stub": 0,
        "is_return": 0,
    })

    # Add child items — match by (item_id, make) so the right ITM row
    # contributes its metadata (and the DN line records the right make).
    for req_item in valid_items:
        itm_item = itm_items_map[(req_item["item_id"], _norm_make(req_item.get("make")))]
        dn.append("items", {
            "item_id": itm_item.item_id,
            "item_name": itm_item.item_name,
            "unit": itm_item.unit,
            "category": itm_item.category,
            "make": itm_item.make,
            "delivered_quantity": _safe_float(req_item["delivered_quantity"]),
        })

    dn.flags.ignore_permissions = True
    dn.insert()

    # Handle attachment
    if attachment:
        attachment_doc = frappe.new_doc("Nirmaan Attachments")
        attachment_doc.update({
            "project": dn_project,
            "attachment": attachment,
            "attachment_type": "itm delivery challan",
            "associated_doctype": "Delivery Notes",
            "associated_docname": dn.name,
        })
        attachment_doc.insert(ignore_permissions=True)

        dn.nirmaan_attachment = attachment_doc.name
        dn.save(ignore_permissions=True)

    # Recalculate ITM delivery fields
    from nirmaan_stack.integrations.controllers.delivery_notes import (
        recalculate_itm_delivery_fields,
    )
    itm_status = recalculate_itm_delivery_fields(itm_id)

    frappe.db.commit()

    return {
        "status": 200,
        "dn_name": dn.name,
        "itm_status": itm_status,
    }


def _safe_float(value, default=0.0):
    if value is None:
        return default
    try:
        return float(value)
    except (ValueError, TypeError):
        return default
