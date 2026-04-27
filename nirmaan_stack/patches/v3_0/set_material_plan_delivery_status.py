import frappe


def execute():
    """Backfill delivery_status on existing Material Delivery Plan rows.

    Flip rows whose delivery_date has already passed to 'Delivered'.
    Leave rows that were manually marked 'Delivered' alone (no-op).
    Future-dated and date-less rows stay at 'Not Delivered' (the column default).
    """
    frappe.db.sql("""
        UPDATE "tabMaterial Delivery Plan"
        SET delivery_status = 'Delivered'
        WHERE delivery_date IS NOT NULL
          AND delivery_date < CURRENT_DATE
          AND (delivery_status IS NULL OR delivery_status != 'Delivered')
    """)
    frappe.db.commit()
