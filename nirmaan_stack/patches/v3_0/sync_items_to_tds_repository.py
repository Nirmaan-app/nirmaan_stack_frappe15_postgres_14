"""
One-time patch to sync item_name and category from Items to TDS Repository.

For every TDS Repository record that has a tds_item_id linking back to an Items
record, copy the current item_name → tds_item_name and category → category.
"""

import frappe


def execute():
    # Fetch all TDS Repository records that have a linked item (include current values for comparison)
    tds_records = frappe.get_all(
        "TDS Repository",
        filters={"tds_item_id": ["is", "set"]},
        fields=["name", "tds_item_id", "tds_item_name", "category"],
    )

    if not tds_records:
        print("[sync_items_to_tds] No TDS Repository records with tds_item_id found.")
        return

    # Build a set of unique item IDs to fetch in bulk
    item_ids = list({r.tds_item_id for r in tds_records})

    # Fetch all referenced Items in one query
    items = frappe.get_all(
        "Items",
        filters={"name": ["in", item_ids]},
        fields=["name", "item_name", "category"],
    )
    item_map = {i.name: i for i in items}

    updated = 0
    updated_ids = []
    skipped = 0

    for rec in tds_records:
        item = item_map.get(rec.tds_item_id)
        if not item:
            continue

        updates = {}
        # Only update if the value actually differs
        if item.item_name and (rec.tds_item_name or "") != (item.item_name or ""):
            updates["tds_item_name"] = item.item_name
        if item.category and (rec.category or "") != (item.category or ""):
            updates["category"] = item.category

        if updates:
            frappe.db.set_value("TDS Repository", rec.name, updates, update_modified=False)
            updated += 1
            updated_ids.append(rec.tds_item_id)
        else:
            skipped += 1

    if updated:
        frappe.db.commit()

    print(f"[sync_items_to_tds] Updated: {updated}, Skipped (no change): {skipped}, Total: {len(tds_records)}")
    if updated_ids:
        print(f"[sync_items_to_tds] Updated Item IDs: {updated_ids}")