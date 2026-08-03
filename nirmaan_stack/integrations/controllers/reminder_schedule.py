# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""
Reminder Schedule lifecycle — keep the future Pending occurrence aligned to the schedule.

When an admin edits a schedule's due date (due_day / due_dates), the cron would otherwise
leave the OLD cycle's Pending `Reminder Schedule Log` AND raise a NEW one for the new date —
a duplicate (Option A fix). Instead, on update we MOVE the schedule's single not-done,
future-dated Pending log onto the new due date.

Guarantees (owner rules):
  * UPDATE only — NEVER deletes a log (the log is the permanent compliance audit trail).
  * Done logs and past / overdue Pending logs are NEVER touched — only a not-yet-due,
    not-yet-done occurrence (which represents nothing that has happened) is re-dated.
  * Idempotent: if a Pending log already sits on the new date, or nothing is raised yet,
    it does nothing (the 8 AM cron then creates the right one).
"""
import frappe
from frappe.utils import getdate, today


def on_update(doc, method=None):
    """Re-date the current future Pending occurrence when the schedule's due date changes."""
    before = doc.get_doc_before_save()
    old_due = getdate(before.next_due_date) if before and before.next_due_date else None
    new_due = getdate(doc.next_due_date) if doc.next_due_date else None
    # No change (or nothing computable) → nothing to reconcile.
    if not new_due or old_due == new_due:
        return
    _move_future_pending(doc.name, new_due)


def _move_future_pending(schedule_name, new_due):
    new_due = getdate(new_due)
    base = getdate(today())

    # A Pending log already on the new date → nothing to move (avoid a collision / dup).
    if frappe.db.exists(
        "Reminder Schedule Log",
        {"reminder_schedule": schedule_name, "due_date": new_due, "status": "Pending"},
    ):
        return

    # The schedule's not-yet-due, not-yet-done occurrences (excluding the target date).
    future_pending = frappe.get_all(
        "Reminder Schedule Log",
        filters={
            "reminder_schedule": schedule_name,
            "status": "Pending",
            "due_date": [">=", base],
        },
        fields=["name", "due_date"],
        order_by="due_date asc",
    )
    future_pending = [r for r in future_pending if getdate(r["due_date"]) != new_due]
    if not future_pending:
        return  # none raised yet → the cron will create the correct one

    # Move the current cycle's occurrence onto the new due date. UPDATE (not delete); use
    # set_value so the log's completion-stamping validate is not re-run for a date-only change.
    frappe.db.set_value(
        "Reminder Schedule Log",
        future_pending[0]["name"],
        "due_date",
        new_due,
        update_modified=False,
    )
