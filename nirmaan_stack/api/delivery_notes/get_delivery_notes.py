import frappe


@frappe.whitelist()
def get_delivery_notes(procurement_order):
    """Get all Delivery Notes for a PO, enriched with child items."""
    if not procurement_order:
        frappe.throw("procurement_order is required")

    notes = frappe.get_all(
        "Delivery Notes",
        filters={"procurement_order": procurement_order},
        fields=[
            "name", "procurement_order", "project", "vendor",
            "note_no", "delivery_date", "updated_by_user",
            "nirmaan_attachment", "notes", "is_stub",
            "creation", "modified"
        ],
        order_by="note_no asc",
    )

    if not notes:
        return []

    # Batch-fetch all child items to avoid N+1
    note_names = [n.name for n in notes]
    all_items = frappe.get_all(
        "Delivery Note Item",
        filters={"parent": ["in", note_names]},
        fields=[
            "name", "parent", "item_id", "item_name", "make", "unit",
            "category", "procurement_package", "delivered_quantity"
        ],
        order_by="idx asc",
        limit_page_length=0,
    )

    # Group items by parent
    items_by_parent = {}
    for item in all_items:
        items_by_parent.setdefault(item.parent, []).append(item)

    # Enrich notes with items
    for note in notes:
        note["items"] = items_by_parent.get(note.name, [])

    return notes


@frappe.whitelist()
def get_project_delivery_notes(project_id):
    """Get all Delivery Notes for a project across all POs."""
    if not project_id:
        frappe.throw("project_id is required")

    notes = frappe.get_all(
        "Delivery Notes",
        filters={"project": project_id},
        fields=[
            "name", "procurement_order", "project", "vendor",
            "note_no", "delivery_date", "updated_by_user",
            "nirmaan_attachment", "notes", "is_stub",
            "creation", "modified"
        ],
        order_by="creation desc",
    )

    if not notes:
        return []

    note_names = [n.name for n in notes]
    all_items = frappe.get_all(
        "Delivery Note Item",
        filters={"parent": ["in", note_names]},
        fields=[
            "name", "parent", "item_id", "item_name", "make", "unit",
            "category", "procurement_package", "delivered_quantity"
        ],
        order_by="idx asc",
        limit_page_length=0,
    )

    items_by_parent = {}
    for item in all_items:
        items_by_parent.setdefault(item.parent, []).append(item)

    for note in notes:
        note["items"] = items_by_parent.get(note.name, [])

    return notes
