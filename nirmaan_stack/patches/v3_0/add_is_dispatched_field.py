import frappe


def execute():
    """Backfill is_dispatched=1 for all items in POs that are already dispatched/delivered."""
    frappe.db.sql("""
        UPDATE "tabPurchase Order Item" poi
        SET is_dispatched = 1
        FROM "tabProcurement Orders" po
        WHERE poi.parent = po.name
        AND po.status IN ('Dispatched', 'Partially Delivered', 'Delivered')
    """)
    frappe.db.commit()
