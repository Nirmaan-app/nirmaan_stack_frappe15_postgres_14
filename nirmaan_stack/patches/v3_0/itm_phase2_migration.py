import frappe


def execute():
    """
    Backfill new fields for ITM Phase 2:
    1. ITM Item status from parent ITM status
    2. DN parent_doctype + parent_docname from procurement_order
    """

    # 1. Backfill ITM Item status based on parent ITM status
    # Map: parent Approved → items Approved; parent Rejected → items Rejected;
    #       parent Pending Approval → items Pending;
    #       parent Dispatched/Partially Delivered/Delivered → items Approved (they were approved before dispatch)
    frappe.db.sql("""
        UPDATE "tabInternal Transfer Memo Item" itmi
        SET status = CASE
            WHEN itm.status = 'Approved' THEN 'Approved'
            WHEN itm.status = 'Rejected' THEN 'Rejected'
            WHEN itm.status = 'Pending Approval' THEN 'Pending'
            WHEN itm.status IN ('Dispatched', 'Partially Delivered', 'Delivered') THEN 'Approved'
            ELSE 'Pending'
        END
        FROM "tabInternal Transfer Memo" itm
        WHERE itmi.parent = itm.name
        AND (itmi.status IS NULL OR itmi.status = '' OR itmi.status = 'Pending')
    """)

    # 2. Backfill DN parent fields from procurement_order
    frappe.db.sql("""
        UPDATE "tabDelivery Notes"
        SET parent_doctype = 'Procurement Orders',
            parent_docname = procurement_order
        WHERE procurement_order IS NOT NULL
        AND procurement_order != ''
        AND (parent_doctype IS NULL OR parent_doctype = '')
    """)

    frappe.db.commit()
