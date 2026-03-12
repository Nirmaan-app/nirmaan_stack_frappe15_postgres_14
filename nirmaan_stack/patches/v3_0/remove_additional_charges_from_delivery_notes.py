import frappe


def execute():
    """Remove Additional Charges items from historical Delivery Notes and recalculate affected POs."""
    # Find DN Item rows whose item_id matches an Additional Charges item
    additional_charges_dn_items = frappe.db.sql(
        """
        SELECT dni.name, dni.parent, dni.item_id
        FROM "tabDelivery Note Item" dni
        INNER JOIN "tabItems" i ON i.name = dni.item_id
        WHERE i.category = 'Additional Charges'
        """,
        as_dict=True,
    )

    if not additional_charges_dn_items:
        print("Patch: No Additional Charges items found in Delivery Notes — nothing to do")
        return

    # Collect affected DN names and PO names
    affected_dns = set()
    affected_pos = set()
    for row in additional_charges_dn_items:
        affected_dns.add(row.parent)

    # Get PO names for affected DNs
    for dn_name in affected_dns:
        po_name = frappe.db.get_value("Delivery Notes", dn_name, "procurement_order")
        if po_name:
            affected_pos.add(po_name)

    # Delete the Additional Charges child rows
    item_names = [row.name for row in additional_charges_dn_items]
    for chunk in _chunks(item_names, 100):
        placeholders = ", ".join(["%s"] * len(chunk))
        frappe.db.sql(
            f'DELETE FROM "tabDelivery Note Item" WHERE name IN ({placeholders})',
            tuple(chunk),
        )

    # Delete any parent DNs that now have zero items
    deleted_dns = []
    for dn_name in affected_dns:
        remaining = frappe.db.count("Delivery Note Item", {"parent": dn_name})
        if remaining == 0:
            frappe.delete_doc("Delivery Notes", dn_name, force=True, ignore_permissions=True)
            deleted_dns.append(dn_name)

    # Recalculate PO delivery fields for all affected POs
    from nirmaan_stack.integrations.controllers.delivery_notes import recalculate_po_delivery_fields

    for po_name in affected_pos:
        try:
            recalculate_po_delivery_fields(po_name)
        except Exception:
            frappe.log_error(f"Patch: Failed to recalculate PO {po_name}")

    msg = (
        f"Patch complete: removed {len(additional_charges_dn_items)} Additional Charges DN items, "
        f"deleted {len(deleted_dns)} empty DNs, recalculated {len(affected_pos)} POs"
    )
    print(msg)


def _chunks(lst, size):
    for i in range(0, len(lst), size):
        yield lst[i : i + size]
