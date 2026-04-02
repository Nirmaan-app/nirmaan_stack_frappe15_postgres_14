import frappe
from nirmaan_stack.api.delivery_notes.update_delivery_note import (
    safe_float,
    calculate_delivered_amount,
    calculate_order_status,
)
from nirmaan_stack.api.vendor_credit import recalculate_vendor_credit


def _has_undispatched_items(po):
    """Check if the PO has any non-Additional-Charges items that are not dispatched."""
    for item in po.get("items"):
        if item.category != "Additional Charges" and not item.is_dispatched:
            return True
    return False


def on_update(doc, method):
    """Recalculate PO delivery fields when a DN is updated."""
    if doc.flags.get("skip_po_recalculate"):
        return
    if doc.procurement_order:
        recalculate_po_delivery_fields(doc.procurement_order)
        # Vendor credit recalculation after delivery changes
        po = frappe.get_cached_doc("Procurement Orders", doc.procurement_order)
        if po.vendor:
            entry_type = "Return Note" if getattr(doc, "is_return", 0) else "DN Created"
            recalculate_vendor_credit(po.vendor, entry_type, po_id=doc.procurement_order, project=po.project)


def on_trash(doc, method):
    """Recalculate PO delivery fields when a DN is deleted."""
    if doc.procurement_order:
        recalculate_po_delivery_fields(doc.procurement_order)
        # Vendor credit recalculation after DN deletion
        po = frappe.get_cached_doc("Procurement Orders", doc.procurement_order)
        if po.vendor:
            recalculate_vendor_credit(po.vendor, "DN Deleted", po_id=doc.procurement_order, project=po.project)


def recalculate_po_delivery_fields(po_name):
    """Recompute received_quantity, po_amount_delivered, status from all remaining DN records."""
    po = frappe.get_doc("Procurement Orders", po_name)

    # Reset all received_quantity to 0
    for item in po.get("items"):
        if item.category == "Additional Charges":
            continue
        item.received_quantity = 0

    # Get all remaining DN records for this PO
    remaining_dns = frappe.get_all(
        "Delivery Notes",
        filters={"procurement_order": po_name},
        fields=["name"],
    )

    if remaining_dns:
        dn_names = [d.name for d in remaining_dns]
        all_dn_items = frappe.get_all(
            "Delivery Note Item",
            filters={"parent": ["in", dn_names]},
            fields=["item_id", "delivered_quantity"],
            limit_page_length=0,
        )

        # Sum delivered quantities per item_id
        delivered_by_item = {}
        for di in all_dn_items:
            delivered_by_item[di.item_id] = delivered_by_item.get(di.item_id, 0) + safe_float(di.delivered_quantity)

        # Update PO items
        for item in po.get("items"):
            if item.category == "Additional Charges":
                continue
            if item.item_id in delivered_by_item:
                item.received_quantity = delivered_by_item[item.item_id]

    # Recalculate PO fields
    po.po_amount_delivered = calculate_delivered_amount(po.get("items"))

    # Partially Dispatched is sticky: if undispatched items remain, preserve the status
    # regardless of delivery progress. Normal status calc only resumes once all items are dispatched.
    if _has_undispatched_items(po):
        po.status = "Partially Dispatched"
    else:
        po.status = calculate_order_status(po.get("items"))

    # Update latest_delivery_date from remaining DNs
    if remaining_dns:
        latest = frappe.db.sql(
            """SELECT MAX(delivery_date) as max_date FROM "tabDelivery Notes" WHERE procurement_order = %s""",
            po_name,
            as_dict=True,
        )
        po.latest_delivery_date = latest[0].max_date if latest and latest[0].max_date else None
    else:
        po.latest_delivery_date = None

    po.save(ignore_permissions=True)
