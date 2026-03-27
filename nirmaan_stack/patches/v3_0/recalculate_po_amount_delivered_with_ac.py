import frappe


def execute():
    """Recalculate po_amount_delivered for Delivered POs where Additional Charges were not included."""
    from nirmaan_stack.api.delivery_notes.update_delivery_note import (
        calculate_delivered_amount,
    )

    def safe_float(val):
        try:
            return float(val or 0)
        except (ValueError, TypeError):
            return 0.0

    # Get all Delivered POs that have Additional Charges items
    pos_with_ac = frappe.db.sql(
        """
        SELECT DISTINCT po.name, po.po_amount_delivered
        FROM "tabProcurement Orders" po
        INNER JOIN "tabPurchase Order Item" poi ON poi.parent = po.name
        WHERE po.status = 'Delivered'
        AND poi.category = 'Additional Charges'
        """,
        as_dict=True,
    )

    if not pos_with_ac:
        print("Patch: No Delivered POs with Additional Charges items — nothing to do")
        return

    updated = 0
    for po_row in pos_with_ac:
        po_name = po_row["name"]
        stored = safe_float(po_row["po_amount_delivered"])

        items = frappe.get_all(
            "Purchase Order Item",
            filters={"parent": po_name},
            fields=["category", "quote", "quantity", "received_quantity", "tax"],
            limit_page_length=0,
        )

        correct_amount = calculate_delivered_amount(items)

        if abs(stored - correct_amount) > 0.01:
            frappe.db.set_value(
                "Procurement Orders",
                po_name,
                "po_amount_delivered",
                correct_amount,
                update_modified=False,
            )
            updated += 1

    if updated:
        frappe.db.commit()

    print(
        f"Patch complete: checked {len(pos_with_ac)} Delivered POs, "
        f"updated po_amount_delivered on {updated}"
    )
