# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Commission Report Tasks master.

Keeps existing project trackers in sync with the master. Child rows
(`Commission Report Task Child Table`) store task_name / category as plain
strings (not a Link), so without this:
  - a master rename never reaches existing trackers, and
  - a new master task never appears on old trackers.

These methods are auto-invoked by Frappe (no hooks.py registration needed):
  - on_update    -> cascade a rename (task_name / category_link) to all child rows.
  - after_insert -> back-fill the new task into every ACTIVE tracker (project not
                    Completed), one row per zone, as `Not Applicable`.
"""

import frappe
from frappe.utils import now
from frappe.model.document import Document

CHILD_DOCTYPE = "Commission Report Task Child Table"
PARENT_DOCTYPE = "Project Commission Report"

# Project statuses whose trackers should NOT receive new-task back-fills.
SKIP_PROJECT_STATUSES = {"Completed"}


class CommissionReportTasks(Document):
    def validate(self):
        """Normalize the task name so trailing/leading spaces never get saved."""
        if self.task_name:
            self.task_name = self.task_name.strip()

    def on_update(self):
        """Cascade a master task rename (task_name and/or category_link) to child rows."""
        before = self.get_doc_before_save()
        if not before:
            return

        old_name = (before.task_name or "").strip()
        new_name = (self.task_name or "").strip()
        old_cat = before.category_link
        new_cat = self.category_link

        if old_name == new_name and old_cat == new_cat:
            return  # nothing relevant changed

        affected = frappe.db.sql(
            '''SELECT DISTINCT parent FROM "tabCommission Report Task Child Table"
               WHERE task_name = %s AND commission_category = %s''',
            (old_name, old_cat), as_dict=True,
        )
        if not affected:
            return

        frappe.db.sql(
            '''UPDATE "tabCommission Report Task Child Table"
               SET task_name = %s, commission_category = %s
               WHERE task_name = %s AND commission_category = %s''',
            (new_name, new_cat, old_name, old_cat),
        )
        for r in affected:
            frappe.db.set_value(PARENT_DOCTYPE, r["parent"], {"modified": now()}, update_modified=False)
        frappe.db.commit()

    def after_insert(self):
        """Back-fill the new master task into every active tracker, one row per zone, as N/A."""
        _backfill_task(self.category_link, (self.task_name or "").strip(), self.report_type or "Field")


def _backfill_task(category: str, task_name: str, report_type: str) -> int:
    """Append (category, task_name) as Not Applicable to active trackers.

    Only added to zones that ALREADY contain that category — if a tracker/zone
    doesn't have the category at all, it's skipped, because the task will be
    included automatically when the user adds that category later.
    Returns the number of rows added.
    """
    if not task_name or not category:
        return 0

    trackers = frappe.get_all(PARENT_DOCTYPE, fields=["name", "project"])
    added_total = 0

    for t in trackers:
        proj_status = frappe.db.get_value("Projects", t.project, "status") if t.project else None
        if proj_status in SKIP_PROJECT_STATUSES:
            continue

        parent_doc = frappe.get_doc(PARENT_DOCTYPE, t.name)
        rows = parent_doc.commission_report_task

        # Zones that already contain this category (via some OTHER task).
        zones_with_category = {
            c.task_zone for c in rows
            if c.commission_category == category and c.task_name != task_name
        }
        if not zones_with_category:
            continue  # tracker doesn't have this category — skip (added on Add Category)

        existing = {(c.commission_category, c.task_name, c.task_zone) for c in rows}

        added = False
        for zone in zones_with_category:
            if (category, task_name, zone) in existing:
                continue
            parent_doc.append("commission_report_task", {
                "commission_category": category,
                "task_name": task_name,
                "task_status": "Not Applicable",
                "report_type": report_type,
                "task_phase": "Handover",
                "task_zone": zone,
            })
            added = True
            added_total += 1

        if added:
            parent_doc.save(ignore_permissions=True)

    if added_total:
        frappe.db.commit()
    return added_total
