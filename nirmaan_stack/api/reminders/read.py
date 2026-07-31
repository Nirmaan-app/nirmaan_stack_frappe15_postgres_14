# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""
Reminders — READ endpoint for the dashboard Action Center (right panel).

`get_my_reminders()` is the cadence/"scheduled action item" counterpart to
`action_items.read.get_my_action_items`. Where action items are derived from live
document state (a PO with no DC), reminders are derived from a *schedule* — the
`Reminder Schedule` doctype — plus today's date.

Scope model (deliberately simpler than action items): reminders are
**Role-Profile-scoped, not project-scoped**. A compliance deadline (GSTR-3B, TDS,
PF...) applies to *everyone with a given Role Profile*, not to a subset of projects.
So the gate is: return the enabled schedules whose `role_profiles` include the
caller's own `role_profile_name`. No project permission model is involved.

This endpoint WRITES NOTHING. Each schedule's next due date is recomputed LIVE against
today (via `ReminderSchedule.calc_next_due_date`) rather than trusting the value frozen
at last save — so the panel is always correct even if the doc hasn't been re-saved.
"""

import frappe
from frappe.utils import cint, date_diff, getdate, today

from nirmaan_stack.services import reminders as reminders_service
from nirmaan_stack.services.reminders import MONTHS_ORDER


@frappe.whitelist()
def get_my_reminders():
	"""Reminders that apply to the CURRENT user, for the dashboard panel.

	Resolves the caller's Role Profile, finds the enabled `Reminder Schedule`s that
	target it, and returns one row per schedule with the next due date computed live.
	Rows are sorted soonest-first. Returns ``{"reminders": [...]}``; empty (never an
	error) when the user has no profile or no schedules target them.
	"""
	user = frappe.session.user
	profile = frappe.db.get_value("User", user, "role_profile_name")
	if not profile:
		return {"reminders": []}

	# Schedules whose role_profiles child table references the caller's profile.
	schedule_names = frappe.get_all(
		"Reminder Role Profile",
		filters={"role_profile": profile, "parenttype": "Reminder Schedule"},
		pluck="parent",
	)
	schedule_names = list(dict.fromkeys(schedule_names))  # de-dupe, preserve order
	if not schedule_names:
		return {"reminders": []}

	base = getdate(today())
	reminders = []

	for name in schedule_names:
		doc = frappe.get_doc("Reminder Schedule", name)
		if not doc.enabled:
			continue

		next_due = reminders_service.next_due_date(
			doc.schedule_type, doc.due_day, doc.due_dates, base
		)
		if not next_due:
			continue

		reminds_at = reminders_service.reminds_on(next_due, doc.notify_before_days)
		days_until = date_diff(next_due, base)  # next_due - today (>= 0)

		reminders.append(
			{
				"name": doc.name,
				"title": doc.title,
				"schedule_type": doc.schedule_type,
				"message": doc.message,
				"notify_before_days": doc.notify_before_days,
				"next_due_date": str(next_due),
				"reminds_on": str(reminds_at) if reminds_at else None,
				"days_until": days_until,
				# The reminder window is open right now (time to act).
				"is_active": days_until <= int(doc.notify_before_days or 0),
				"bucket": reminders_service.bucket(days_until, doc.notify_before_days),
			}
		)

	reminders.sort(key=lambda r: r["days_until"])
	return {"reminders": reminders}


@frappe.whitelist()
def get_role_profiles():
	"""Role Profile names for the reminder-schedule target picker.

	`Role Profile` is a System-Manager-only standard doctype, so a create-capable non-admin
	(PMO / Accountant Lead) cannot list it directly from the client. This login-required
	endpoint returns just the names (non-sensitive labels) via ignore_permissions, so the
	picker works without widening any DocPerm. Read-only.
	"""
	names = frappe.get_all(
		"Role Profile", pluck="name", order_by="name asc", ignore_permissions=True
	)
	return {"role_profiles": names}


@frappe.whitelist()
def get_reminder_schedule_role_profiles():
	"""Map of ``{reminder_schedule: [role_profile, ...]}`` for the Reminders list page.

	`Reminder Role Profile` is a CHILD table, and Frappe's REST get_list REJECTS a direct
	child-table query (`check_parent_permission`). Read it server-side (ignore_permissions;
	the values are non-sensitive role-profile names) and return the grouped map so the list
	page can show each schedule's target roles. Read-only.
	"""
	rows = frappe.get_all(
		"Reminder Role Profile",
		filters={"parenttype": "Reminder Schedule"},
		fields=["parent", "role_profile"],
		ignore_permissions=True,
	)
	by_schedule = {}
	for r in rows:
		by_schedule.setdefault(r["parent"], []).append(r["role_profile"])
	return {"by_schedule": by_schedule}


@frappe.whitelist()
def get_my_reminder_logs(include_done=0):
	"""Reminder Schedule Log rows for the CURRENT user's role profile.

	Feeds the collapsible Reminders list in the Action Center — the raised task
	instances (default Pending only; pass include_done=1 to also return Done rows).
	Scoped exactly like get_my_reminders: only logs of schedules that target the
	caller's `role_profile_name`. Read-only. Returns ``{"logs": [...]}``.
	"""
	user = frappe.session.user
	profile = frappe.db.get_value("User", user, "role_profile_name")
	if not profile:
		return {"logs": []}

	schedule_names = frappe.get_all(
		"Reminder Role Profile",
		filters={"role_profile": profile, "parenttype": "Reminder Schedule"},
		pluck="parent",
	)
	schedule_names = list(dict.fromkeys(schedule_names))
	if not schedule_names:
		return {"logs": []}

	filters = {"reminder_schedule": ["in", schedule_names], "status": "Pending"}
	if cint(include_done):
		del filters["status"]  # include Done rows too

	logs = frappe.get_all(
		"Reminder Schedule Log",
		filters=filters,
		fields=[
			"name",
			"reminder_schedule",
			"due_date",
			"status",
			"notified_at",
			"completed_by",
			"completed_at",
			"remarks",
		],
		order_by="due_date asc",
	)
	_enrich_logs(logs, schedule_names)
	return {"logs": logs}


def _my_schedule_names(user=None):
	"""Schedule names that target the caller's role profile — the scoping gate, reused by
	the read AND write endpoints so an accountant only ever sees / acts on their own."""
	user = user or frappe.session.user
	profile = frappe.db.get_value("User", user, "role_profile_name")
	if not profile:
		return []
	names = frappe.get_all(
		"Reminder Role Profile",
		filters={"role_profile": profile, "parenttype": "Reminder Schedule"},
		pluck="parent",
	)
	return list(dict.fromkeys(names))


def _ordinal(n):
	n = cint(n)
	if 10 <= (n % 100) <= 20:
		suffix = "th"
	else:
		suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
	return f"{n}{suffix}"


def _enrich_logs(logs, schedule_names):
	"""Add DERIVED per-log fields (no stored columns): lifecycle `state` + `days`, and a
	month-end clamp `due_note`.

	`state` = completed / overdue / due_today / upcoming, from (status, due_date) vs today.
	`due_note` is set ONLY when the schedule's configured day does not exist in that month
	(e.g. the 31st in February) — the date was clamped to month-end, so the accountant is
	told the real deadline instead of a day that never comes.
	"""
	if not logs:
		return
	sched = {
		s["name"]: s
		for s in frappe.get_all(
			"Reminder Schedule",
			filters={"name": ["in", schedule_names]},
			fields=["name", "schedule_type", "due_day", "message"],
		)
	}
	dd_by_parent = {}
	for row in frappe.get_all(
		"Reminder Due Date",
		filters={"parent": ["in", schedule_names]},
		fields=["parent", "due_month", "due_day"],
	):
		dd_by_parent.setdefault(row["parent"], []).append(row)

	base = getdate(today())
	for log in logs:
		due = getdate(log["due_date"])
		# lifecycle state
		if log.get("status") == "Done":
			log["state"], log["days"] = "completed", 0
		else:
			delta = date_diff(due, base)  # due - today
			if delta < 0:
				log["state"], log["days"] = "overdue", -delta
			elif delta == 0:
				log["state"], log["days"] = "due_today", 0
			else:
				log["state"], log["days"] = "upcoming", delta

		# month-end clamp note: configured day the month doesn't have
		log["clamped"] = False
		log["due_note"] = None
		s = sched.get(log["reminder_schedule"]) or {}
		log["message"] = s.get("message") or None
		intended = None
		if s.get("schedule_type") == "Monthly":
			intended = cint(s.get("due_day"))
		else:
			mname = MONTHS_ORDER[due.month - 1]
			for r in dd_by_parent.get(log["reminder_schedule"], []):
				if r.get("due_month") == mname:
					intended = cint(r.get("due_day"))
					break
		if intended and intended > due.day:
			log["clamped"] = True
			log["due_note"] = (
				f"{due.strftime('%B')} has no {_ordinal(intended)} — "
				f"complete by the last day, {due.strftime('%d %b %Y')}."
			)
