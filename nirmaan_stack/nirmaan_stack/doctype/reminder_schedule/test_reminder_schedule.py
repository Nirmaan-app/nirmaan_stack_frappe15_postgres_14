# Copyright (c) 2026, Nirmaan and contributors
# See license.txt

"""The stored "Next Due Date" follows Done / reopen, and a stale value is repaired.

These run against the live site database, so every test builds its own disabled schedule
(a unique title) and `_purge` removes exactly that schedule and its logs. `frappe.enqueue`
is patched out: `ReminderSchedule.on_update` enqueues the daily sweep, which would otherwise
touch the real schedules.

Run:  bench --site localhost run-tests --module nirmaan_stack.nirmaan_stack.doctype.reminder_schedule.test_reminder_schedule
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, getdate, today

from nirmaan_stack.integrations.controllers.reminder_schedule import refresh_next_due
from nirmaan_stack.services.reminders import MONTHS_ORDER

NOTIFY_DAYS = 3


def _purge(name):
    """Remove one test schedule and everything it created. Roll back first (a failed test
    may have poisoned the transaction), then delete each scope in its own try, and report."""
    frappe.db.rollback()
    failures = []
    scopes = [
        ("Reminder Schedule Log", {"reminder_schedule": name}),
        ("Reminder Due Date", {"parent": name, "parenttype": "Reminder Schedule"}),
        ("Reminder Role Profile", {"parent": name, "parenttype": "Reminder Schedule"}),
        ("Version", {"ref_doctype": "Reminder Schedule", "docname": name}),
        ("Reminder Schedule", {"name": name}),
    ]
    for doctype, filters in scopes:
        try:
            frappe.db.delete(doctype, filters)
            frappe.db.commit()
        except Exception as exc:  # report, never swallow
            frappe.db.rollback()
            failures.append(f"{doctype}: {exc}")
    if failures:
        raise AssertionError(f"_purge({name}) left rows behind: {failures}")


class TestNextDueDateFollowsDone(FrappeTestCase):
    def setUp(self):
        enqueue = patch("frappe.enqueue")
        enqueue.start()
        self.addCleanup(enqueue.stop)

        base = getdate(today())
        # Two cycles ahead, 30 days apart, so they never share a month.
        self.d1 = getdate(add_days(base, 10))
        self.d2 = getdate(add_days(base, 40))
        self.name = f"ZZ Test Next Due {frappe.generate_hash(length=8)}"
        self.addCleanup(_purge, self.name)

        profile = frappe.get_all("Role Profile", pluck="name", limit=1)[0]
        doc = frappe.get_doc(
            {
                "doctype": "Reminder Schedule",
                "title": self.name,
                "enabled": 0,
                "schedule_type": "Custom Dates",
                "notify_before_days": NOTIFY_DAYS,
                "role_profiles": [{"role_profile": profile}],
                "due_dates": [
                    {"due_month": MONTHS_ORDER[d.month - 1], "due_day": d.day}
                    for d in (self.d1, self.d2)
                ],
            }
        )
        doc.insert(ignore_permissions=True)

    def _stored(self):
        row = frappe.db.get_value(
            "Reminder Schedule", self.name, ["next_due_date", "reminds_on"], as_dict=True
        )
        return getdate(row.next_due_date), getdate(row.reminds_on)

    def _log(self, due_date, status="Pending"):
        log = frappe.new_doc("Reminder Schedule Log")
        log.reminder_schedule = self.name
        log.due_date = due_date
        log.status = status
        log.insert(ignore_permissions=True)
        return log

    def test_saved_schedule_starts_on_the_first_cycle(self):
        self.assertEqual(self._stored(), (self.d1, add_days(self.d1, -NOTIFY_DAYS)))

    def test_raising_a_pending_log_does_not_move_the_date(self):
        self._log(self.d1)
        self.assertEqual(self._stored()[0], self.d1)

    def test_mark_done_moves_to_next_cycle_and_reopen_moves_back(self):
        log = self._log(self.d1)

        log.status = "Done"
        log.save(ignore_permissions=True)
        self.assertEqual(self._stored(), (self.d2, getdate(add_days(self.d2, -NOTIFY_DAYS))))

        log.reload()
        log.status = "Pending"
        log.save(ignore_permissions=True)
        self.assertEqual(self._stored()[0], self.d1)

    def test_remarks_only_edit_on_a_done_log_keeps_the_date(self):
        log = self._log(self.d1, status="Done")
        self.assertEqual(self._stored()[0], self.d2)
        log.remarks = "filed"
        log.save(ignore_permissions=True)
        self.assertEqual(self._stored()[0], self.d2)

    def test_refresh_repairs_a_stale_date_without_touching_modified(self):
        frappe.db.set_value(
            "Reminder Schedule", self.name, "next_due_date", "2026-08-20", update_modified=False
        )
        modified = frappe.db.get_value("Reminder Schedule", self.name, "modified")

        refresh_next_due(self.name)

        self.assertEqual(self._stored()[0], self.d1)
        self.assertEqual(frappe.db.get_value("Reminder Schedule", self.name, "modified"), modified)

    def test_switching_back_on_recomputes_a_stale_date(self):
        """The daily job skips disabled schedules, so a disabled one keeps a past date. The
        Edit dialog's save (updateDoc -> doc.save) that switches it back on must correct it."""
        frappe.db.set_value(
            "Reminder Schedule", self.name, "next_due_date", "2026-08-20", update_modified=False
        )
        self._log(self.d1, status="Done")

        doc = frappe.get_doc("Reminder Schedule", self.name)
        doc.enabled = 1
        doc.save(ignore_permissions=True)

        self.assertEqual(self._stored(), (self.d2, getdate(add_days(self.d2, -NOTIFY_DAYS))))

    def test_saving_the_schedule_after_done_keeps_both_logs_where_they_are(self):
        """A plain save must agree with refresh_next_due, or the schedule's on_update reads it
        as a due-date edit and re-dates the next cycle's Pending log onto the Done date."""
        self._log(self.d1, status="Done")
        pending = self._log(self.d2)

        doc = frappe.get_doc("Reminder Schedule", self.name)
        doc.message = "edited"
        doc.save(ignore_permissions=True)

        self.assertEqual(self._stored()[0], self.d2)
        self.assertEqual(
            getdate(frappe.db.get_value("Reminder Schedule Log", pending.name, "due_date")),
            self.d2,
        )
        self.assertEqual(
            frappe.db.count(
                "Reminder Schedule Log",
                {"reminder_schedule": self.name, "due_date": self.d1, "status": "Done"},
            ),
            1,
        )
