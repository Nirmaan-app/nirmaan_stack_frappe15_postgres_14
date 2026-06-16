"""One-time sync of existing Project Commission Report trackers with master changes.

The `Commission Report Tasks` master gained new tasks and had a few renames, but
tracker child rows store task_name/category as plain strings (snapshots), so those
changes never reached existing trackers. The on_update/after_insert hooks only act
on FUTURE edits, so this patch back-fills the existing data once.

Idempotent — safe to re-run:
  1. Trim trailing-space master typos (and matching child rows).
  2. Cascade renames to existing child rows.
  3. Back-fill genuinely-new tasks as Not Applicable into zones that already have
     the category (reuses the doctype controller's _backfill_task).
"""

import frappe
from nirmaan_stack.nirmaan_stack.doctype.commission_report_tasks.commission_report_tasks import _backfill_task

CHILD = "Commission Report Task Child Table"
MASTER = "Commission Report Tasks"

# (category, padded_name, trimmed_name)
TRIM = [
    ("Data & Networking", "Network Continuity Test Report ", "Network Continuity Test Report"),
    ("HVAC Ducting", "Duct Pressure Testing Report ", "Duct Pressure Testing Report"),
]

# (category, old_task_name, new_task_name)
RENAMES = [
    ("HVAC Ducting", "Smoke Test Report", "Duct Smoke Test Report"),
    ("HVAC VRF/DX", "VRF/DX Commissioning Report", "VRF Commissioning Report"),
]

# Genuinely-new master tasks to back-fill (no old-name equivalent on trackers).
NEW_TASKS = [
    "DX Commissioning Report",
    "Duct Light Test Report",
    "Gas Supression System Commissioning Report",
]


def execute():
    # 1) Trim trailing-space typos on master + any child rows referencing the padded name.
    for cat, padded, trimmed in TRIM:
        frappe.db.sql(
            '''UPDATE "tabCommission Report Tasks" SET task_name=%s
               WHERE task_name=%s AND category_link=%s''', (trimmed, padded, cat))
        frappe.db.sql(
            '''UPDATE "tabCommission Report Task Child Table" SET task_name=%s
               WHERE task_name=%s AND commission_category=%s''', (trimmed, padded, cat))

    # 2) Cascade renames to existing child rows.
    for cat, old, new in RENAMES:
        frappe.db.sql(
            '''UPDATE "tabCommission Report Task Child Table" SET task_name=%s
               WHERE task_name=%s AND commission_category=%s''', (new, old, cat))

    frappe.db.commit()

    # 3) Back-fill genuinely-new tasks as Not Applicable (category-present zones only).
    for tn in NEW_TASKS:
        m = frappe.db.get_value(MASTER, {"task_name": tn}, ["category_link", "report_type"], as_dict=True)
        if not m:
            continue
        _backfill_task(m.category_link, tn, m.report_type or "Field")

    frappe.db.commit()
