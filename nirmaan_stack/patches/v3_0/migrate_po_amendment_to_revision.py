import frappe


def execute():
    """Set all POs with status='PO Amendment' to status='PO Approved'."""
    frappe.db.sql("""
        UPDATE "tabProcurement Orders"
        SET status = 'PO Approved'
        WHERE status = 'PO Amendment'
    """)
    frappe.db.commit()
