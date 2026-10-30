# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""
Reminders — pure schedule math (the ONE owner of "when is this reminder due").

Per the residence rules (a business calculation gets a single pure home in
`services/`, no `frappe.db`, no request context), every date derivation for the
`Reminder Schedule` doctype lives here. It is consumed by BOTH:

  * `Reminder Schedule.validate` + `integrations.controllers.reminder_schedule.refresh_next_due`
    (keep the stored next_due_date / reminds_on current — see `next_open_due_date`), and
  * `tasks.reminders.send_due_reminders` + `api.reminders.read.get_my_reminders`
    (the calendar cycle, recomputed LIVE against today).

`due_dates` is the schedule's child-table (rows with `.from_month` / `.to_month` /
`.due_month` / `.due_day`); the functions read those attributes and never touch the
database, so the same code serves a saved doc and a freshly loaded one.
"""

from frappe.utils import add_days, add_months, cint, get_last_day, getdate, today

MONTHS_ORDER = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTHS = {name: i + 1 for i, name in enumerate(MONTHS_ORDER)}

# Months each span-based schedule covers — used to derive the end month from the start.
SPAN = {"Quarterly": 3, "Half-Yearly": 6}

# How many Done cycles in a row `next_open_due_date` will step past. Only a raised cycle can
# be Done and the cron raises at most the current one, so one or two is the real ceiling;
# the cap just guarantees the loop ends on bad data.
MAX_DONE_CYCLES_SKIPPED = 24


def fill_end_months(schedule_type, due_dates):
	"""Derive `to_month` from `from_month` for Quarterly (+3) / Half-Yearly (+6).

	Only the due date is entered by hand; the covered-period end is computed. Custom
	Dates / Monthly leave the rows untouched. Mutates the child rows in place.
	"""
	span = SPAN.get(schedule_type)
	if not span:
		return
	for row in due_dates or []:
		if row.from_month and MONTHS.get(row.from_month):
			end_idx = (MONTHS[row.from_month] - 1 + span - 1) % 12
			row.to_month = MONTHS_ORDER[end_idx]


def next_due_date(schedule_type, due_day, due_dates, base=None):
	"""The next upcoming due date (today or later). `base` defaults to today."""
	base = getdate(base or today())
	if schedule_type == "Monthly":
		return _next_monthly(due_day, base)
	return _next_fixed(due_dates, base)


def next_open_due_date(schedule_type, due_day, due_dates, done_dates=(), base=None):
	"""The schedule's "Next Due Date": the next due date (today or later) not already Done.

	`done_dates` are the due dates of this schedule's Done `Reminder Schedule Log` rows. A
	cycle completed ahead of its due date is stepped past, so marking it Done moves the
	date on to the following cycle at once, and reopening it moves the date back. A missed,
	still-Pending cycle is in the past and never holds the date back: it stays visible as
	Overdue in the Action Center instead.
	"""
	base = getdate(base or today())
	done = {getdate(d) for d in done_dates or ()}
	for _ in range(MAX_DONE_CYCLES_SKIPPED):
		due = next_due_date(schedule_type, due_day, due_dates, base)
		if not due or due not in done:
			return due
		base = add_days(due, 1)
	return None


def reminds_on(next_due, notify_before_days):
	"""The date the reminder fires (= next_due - notify_before_days)."""
	if not next_due:
		return None
	return add_days(getdate(next_due), -cint(notify_before_days))


def bucket(days_until, notify_before_days):
	"""Classify a reminder by proximity to its due date.

	- ``due_soon``   : inside the notify window OR within 7 days (effectively active).
	- ``this_month`` : due within ~31 days.
	- ``later``      : further out.
	"""
	window = max(cint(notify_before_days), 7)
	if days_until <= window:
		return "due_soon"
	if days_until <= 31:
		return "this_month"
	return "later"


# --------------------------------------------------------------------------- #
# internals
# --------------------------------------------------------------------------- #
def _next_monthly(due_day, base):
	day = cint(due_day) or 1
	candidate = _clamp(base.year, base.month, day)
	if candidate < base:
		nm = getdate(add_months(getdate(f"{base.year}-{base.month:02d}-01"), 1))
		candidate = _clamp(nm.year, nm.month, day)
	return candidate


def _next_fixed(due_dates, base):
	upcoming = []
	for row in due_dates or []:
		month = MONTHS.get(row.due_month)
		if not month or not row.due_day:
			continue
		# nearest occurrence of this (month, day) that is today or later
		for year in (base.year, base.year + 1):
			d = _clamp(year, month, cint(row.due_day))
			if d >= base:
				upcoming.append(d)
				break
	return min(upcoming) if upcoming else None


def _clamp(year, month, day):
	"""Build a valid date, clamping the day to the month's length (31 -> 28/29/30)."""
	last = get_last_day(getdate(f"{year}-{month:02d}-01")).day
	day = min(max(cint(day), 1), last)
	return getdate(f"{year}-{month:02d}-{day:02d}")
