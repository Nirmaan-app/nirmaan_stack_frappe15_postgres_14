import frappe


def execute():
    """
    Backfill parent_doctype + parent_docname on PO Delivery Documents.

    Existing rows were PO-only — set parent_doctype='Procurement Orders' and
    parent_docname=procurement_order so polymorphic queries work without
    breaking historical data.

    v2 — broaden the WHERE clause: catch any row that has procurement_order set
    but parent_docname empty, regardless of whether parent_doctype is already
    set. The original v1 only updated rows where parent_doctype was empty,
    which silently skipped any row that had parent_doctype populated but
    parent_docname missing (e.g., rows produced by an intermediate API version
    that wrote parent_doctype before parent_docname was added).
    """
    frappe.db.sql("""
        UPDATE "tabPO Delivery Documents"
        SET parent_doctype = 'Procurement Orders',
            parent_docname = procurement_order
        WHERE procurement_order IS NOT NULL
          AND procurement_order != ''
          AND (parent_docname IS NULL OR parent_docname = '')
    """)

    frappe.db.commit()
