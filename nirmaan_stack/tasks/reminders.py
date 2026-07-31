# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""
Reminders scheduler — raises a per-cycle task instance when a reminder comes due.

It does NOT push bell notifications. The reminder surface is the role-profile-scoped
**Action Center** panel on the dashboard (api.reminders.read.get_my_reminders); this job
only creates the `Reminder Schedule Log` row so the Action Center has a concrete Pending
task to show and a user can mark Done.

Runs daily. For each enabled schedule it recomputes the next due date LIVE (via
services.reminders) and ensures a Pending `Reminder Schedule Log` row exists for that cycle
(one per schedule+due_date) — ALWAYS, with no notify-window gate: the reminder is visible as
Upcoming from now and turns Due / Overdue on its own (state is derived at read time).
`notify_before_days` is display emphasis only. `_ensure_log` guarantees one row per cycle, so
this is idempotent AND self-healing (a missed run just creates it on the next run);
`last_notified_on` records when it was raised.

NOTE: fires while the site scheduler is ENABLED (bench enable-scheduler), or when invoked
directly (bench execute nirmaan_stack.tasks.reminders.send_due_reminders).
"""

import frappe
from frappe.utils import getdate, now_datetime, today

from nirmaan_stack.services import reminders as reminders_service


MONTHS_ORDER = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

def send_due_reminders():
	"""Daily entry point (wired in hooks.scheduler_events)."""
	base = getdate(today())
	schedule_names = frappe.get_all("Reminder Schedule", filters={"enabled": 1}, pluck="name")

	for name in schedule_names:
		try:
			doc = frappe.get_doc("Reminder Schedule", name)

			next_due = reminders_service.next_due_date(
				doc.schedule_type, doc.due_day, doc.due_dates, base
			)
			if not next_due:
				continue

			notify_days = doc.notify_before_days or 0
			days_until_due = frappe.utils.date_diff(next_due, base)

			# Gate log creation based on notify_before_days
			if days_until_due > notify_days:
				continue
				
			# Determine from_month and to_month for non-Monthly schedules
			from_month, to_month = None, None
			if doc.schedule_type != "Monthly":
				for row in doc.due_dates:
					# Match row's due_month and due_day to next_due
					try:
						row_month_idx = MONTHS_ORDER.index(row.due_month) + 1
						if row_month_idx == next_due.month and int(row.due_day) == next_due.day:
							from_month = row.from_month
							to_month = row.to_month
							break
					except ValueError:
						pass

			created = _ensure_log(doc, getdate(next_due), from_month, to_month)
			if created:
				doc.db_set("last_notified_on", base, update_modified=False)
				frappe.db.commit()
				frappe.logger().info(f"[reminders] {name}: raised Pending task for due {next_due}")
		except Exception:
			frappe.db.rollback()
			frappe.log_error(f"send_due_reminders failed for {name}", "Reminders scheduler")


def _ensure_log(doc, due_date, from_month=None, to_month=None):
	"""Create the Pending Reminder Schedule Log row for this cycle (idempotent).

	One row per (reminder_schedule, due_date). Born Pending at the notify-before moment;
	the mark-done flow (from the Action Center) later flips it to Done. Returns True if a
	row was created, False if one already existed.
	"""
	if frappe.db.exists(
		"Reminder Schedule Log", {"reminder_schedule": doc.name, "due_date": due_date}
	):
		return False
	log = frappe.new_doc("Reminder Schedule Log")
	log.reminder_schedule = doc.name
	log.due_date = due_date
	log.from_month = from_month
	log.to_month = to_month
	log.status = "Pending"
	log.notified_at = now_datetime()
	log.insert(ignore_permissions=True)
	return True
