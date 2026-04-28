import frappe


def execute():
    """Backfill header_weightage to 1 for existing Work Headers where it is NULL or 0."""
    frappe.db.sql(
        """
        UPDATE "tabWork Headers"
        SET header_weightage = 1
        WHERE header_weightage IS NULL OR header_weightage = 0
        """
    )
    frappe.db.commit()
