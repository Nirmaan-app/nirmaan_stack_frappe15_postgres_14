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

Also the one writer of the stored "Next Due Date" outside a save: `refresh_next_due`, run
when a log is marked Done / reopened and by the daily cron, so the date never goes stale.
"""
import frappe
from frappe.utils import getdate, today

from nirmaan_stack.services import reminders as reminders_service


def done_due_dates(schedule_name):
    """Due dates (today or later) of the schedule's Done logs — the cycles already completed
    ahead of time, which `services.reminders.next_open_due_date` steps past."""
    if not schedule_name:
        return []
    return frappe.get_all(
        "Reminder Schedule Log",
        filters={
            "reminder_schedule": schedule_name,
            "status": "Done",
            "due_date": [">=", getdate(today())],
        },
        pluck="due_date",
    )


def refresh_next_due(schedule_name):
    """Recompute the schedule's stored next_due_date / reminds_on from source (its due-date
    config + its Done logs + today) and write them if they changed.

    Written with `frappe.db.set_value`, which fires no doc_events — on purpose: both fields are
    read-only display values derived here, and a full save would run `on_update` below, which
    reads a due-date change as an admin edit and re-dates a future Pending log. The next
    ordinary save recomputes the same values in `ReminderSchedule.validate`.
    """
    doc = frappe.get_doc("Reminder Schedule", schedule_name)
    next_due = reminders_service.next_open_due_date(
        doc.schedule_type, doc.due_day, doc.due_dates, done_due_dates(doc.name)
    )
    remind = reminders_service.reminds_on(next_due, doc.notify_before_days)
    old_due = getdate(doc.next_due_date) if doc.next_due_date else None
    old_remind = getdate(doc.reminds_on) if doc.reminds_on else None
    if (old_due, old_remind) == (next_due, remind):
        return
    frappe.db.set_value(
        "Reminder Schedule",
        doc.name,
        {"next_due_date": next_due, "reminds_on": remind},
        update_modified=False,
    )


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
