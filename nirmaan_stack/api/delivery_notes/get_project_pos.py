import frappe
import json
from frappe.utils import create_batch


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
        fields=["name", "project", "vendor_name", "dispatch_date", "status", "creation"],
        order_by="creation desc",
        limit_page_length=0,
    )

    if not pos:
        return []

    # Batch-fetch child items (only fields needed for search). Chunk the parent IN
    # list so the generated query never exceeds the sqlparse 10k-token cap (prod:
    # Frappe validate_generated_query + sqlparse 0.5.5). po_names scales with the
    # number of POs in a project -- unbounded on a mature project.
    po_names = [p.name for p in pos]
    all_items = []
    for _chunk in create_batch(po_names, 500):
        all_items += frappe.get_all(
            "Purchase Order Item",
            filters={"parent": ["in", list(_chunk)]},
            fields=["parent", "item_name", "item_id", "is_dispatched"],
            limit_page_length=0,
        )

    items_by_po = {}
    for item in all_items:
        items_by_po.setdefault(item.parent, []).append(item)

    for po in pos:
        po["items"] = items_by_po.get(po.name, [])

    return pos
