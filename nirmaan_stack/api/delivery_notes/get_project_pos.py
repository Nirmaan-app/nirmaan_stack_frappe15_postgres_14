import frappe
import json


@frappe.whitelist()
def get_project_pos_with_items(project_id, statuses=None):
    """Get POs for a project with child item names for search."""
    if not project_id:
        frappe.throw("project_id is required")

    if isinstance(statuses, str):
        statuses = json.loads(statuses)

    filters = {"project": project_id}
    if statuses:
        filters["status"] = ["in", statuses]

    pos = frappe.get_all(
        "Procurement Orders",
        filters=filters,
        fields=["name", "project", "vendor_name", "dispatch_date", "status"],
        order_by="creation desc",
        limit_page_length=0,
    )

    if not pos:
        return []

    # Batch-fetch child items (only fields needed for search)
    po_names = [p.name for p in pos]
    all_items = frappe.get_all(
        "Purchase Order Item",
        filters={"parent": ["in", po_names]},
        fields=["parent", "item_name", "item_id", "is_dispatched"],
        limit_page_length=0,
    )

    items_by_po = {}
    for item in all_items:
        items_by_po.setdefault(item.parent, []).append(item)

    for po in pos:
        po["items"] = items_by_po.get(po.name, [])

    return pos
