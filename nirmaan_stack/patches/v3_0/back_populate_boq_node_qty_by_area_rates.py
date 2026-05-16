import frappe


def execute():
    """Back-populate per-area rate + amount fields on existing BOQ Node Qty By Area
    rows from parent BOQ Nodes universal rates. Idempotent — safe to re-run.
    """
    child_rows = frappe.get_all(
        "BOQ Node Qty By Area",
        fields=["name", "parent", "area_name", "qty", "supply_rate", "install_rate", "combined_rate"],
    )
    updated_count = 0
    for child in child_rows:
        # Skip rows that already have rates populated (idempotent)
        if child.supply_rate is not None or child.install_rate is not None or child.combined_rate is not None:
            continue
        parent_doc = frappe.get_doc("BOQ Nodes", child.parent)
        updates = {}
        if parent_doc.supply_rate is not None:
            updates["supply_rate"] = parent_doc.supply_rate
        if parent_doc.install_rate is not None:
            updates["install_rate"] = parent_doc.install_rate
        if parent_doc.combined_rate is not None:
            updates["combined_rate"] = parent_doc.combined_rate
        if updates:
            frappe.db.set_value("BOQ Node Qty By Area", child.name, updates)
            updated_count += 1
    frappe.db.commit()
    print(f"back_populate_boq_node_qty_by_area_rates: updated {updated_count} child rows")
