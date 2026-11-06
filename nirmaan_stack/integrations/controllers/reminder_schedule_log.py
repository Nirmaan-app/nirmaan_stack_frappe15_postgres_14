# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""
Reminder Schedule Log lifecycle — keep the parent schedule's "Next Due Date" current.

Marking a cycle Done (or reopening it) changes which cycle is next, so the schedule's stored
next_due_date / reminds_on are recomputed here. In a hook rather than in
`api.reminders.write`, so a status change made from Desk is covered too.
"""
from frappe.utils import getdate

from nirmaan_stack.integrations.controllers.reminder_schedule import refresh_next_due


def on_update(doc, method=None):
    """Re-derive the schedule's next due date when this cycle's status changes."""
    before = doc.get_doc_before_save()
    if (
        before
        and before.status == doc.status
        and getdate(before.due_date) == getdate(doc.due_date)
    ):
        return
    refresh_next_due(doc.reminder_schedule)
