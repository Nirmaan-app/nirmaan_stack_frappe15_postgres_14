import frappe


def execute():
    frappe.db.sql(
        """
        UPDATE "tabPurchase Order Item"
        SET item_id = name
        WHERE item_id IS NULL OR item_id = ''
        """
    )
    frappe.db.sql(
        """
        UPDATE "tabProcurement Request Item Detail"
        SET item_id = name
        WHERE item_id IS NULL OR item_id = ''
        """
    )
    frappe.db.commit()
