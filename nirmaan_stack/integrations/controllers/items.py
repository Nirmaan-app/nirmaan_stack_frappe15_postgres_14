import frappe

def after_insert(doc, method):
    """
    Create an event after item create
    """
    print("HELLO FROM AFTER CREATE")
    event = frappe.publish_realtime("items:created", {'message': 'item'+doc.name+'created'}, user=frappe.session.user)
    print(event)


def on_update(doc, method):
    """
    Sync display fields onto TDS group member rows when an Items SKU is renamed
    or recategorized.

    The TDS grouping model stores member items in the `TDS Items Child Table`
    child rows (parented to `TDS Items`) with `item_name`/`category` populated
    via `fetch_from`. `fetch_from` only refreshes when the parent (`TDS Items`)
    is saved, so an Items rename/recategorize leaves member rows stale until
    someone re-saves each group. This hook keeps those member display fields in
    sync directly.

    (Replaces the Phase-1-deleted hook that wrote the now-removed TDS Repository
    columns `tds_item_id`/`tds_item_name`/`category` — this one targets the
    member child rows instead.)
    """
    before = doc.get_doc_before_save()
    if not before:
        # First save / no prior state to diff against — nothing to sync.
        return

    name_changed = (doc.item_name or "") != (before.item_name or "")
    category_changed = (doc.category or "") != (before.category or "")
    if not (name_changed or category_changed):
        return

    # istable child has no DocPerm — frappe.get_all ignores perms (no perm trap).
    member_rows = frappe.get_all(
        "TDS Items Child Table",
        filters={"item": doc.name, "parenttype": "TDS Items"},
        fields=["name", "item_name", "category"],
    )

    for row in member_rows:
        updates = {}
        if name_changed and (row.item_name or "") != (doc.item_name or ""):
            updates["item_name"] = doc.item_name
        if category_changed and (row.category or "") != (doc.category or ""):
            updates["category"] = doc.category
        if updates:
            frappe.db.set_value("TDS Items Child Table", row.name, updates)

    frappe.db.commit()
