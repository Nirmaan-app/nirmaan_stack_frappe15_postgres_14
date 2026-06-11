"""Back-fill `report_type` on existing Commission Report child rows from the master.

Old `Commission Report Task Child Table` rows were created before the tracker
started snapshotting `report_type`, so they all sit on the field default ("Field")
even where the `Commission Report Tasks` master says "Vendor". The on_update hook
only cascades task_name/category renames — not report_type — so existing trackers
never received the master's report type. This patch aligns them once.

Idempotent — safe to re-run:
  1. Align child rows to their master's report_type (matched by task_name + category).
  2. Default any remaining blank report_type (no master match) to "Field".
"""

import frappe

CHILD = "Commission Report Task Child Table"
MASTER = "Commission Report Tasks"


def execute():
    # 1) Align to master where a matching master task exists.
    frappe.db.sql(
        '''UPDATE "tabCommission Report Task Child Table" AS child
           SET report_type = master.report_type
           FROM "tabCommission Report Tasks" AS master
           WHERE child.task_name = master.task_name
             AND child.commission_category = master.category_link
             AND COALESCE(master.report_type, '') <> ''
             AND COALESCE(child.report_type, '') <> COALESCE(master.report_type, '')'''
    )

    # 2) Anything still blank (no master match) gets the field default.
    frappe.db.sql(
        '''UPDATE "tabCommission Report Task Child Table"
           SET report_type = 'Field'
           WHERE COALESCE(report_type, '') = '' '''
    )

    frappe.db.commit()
