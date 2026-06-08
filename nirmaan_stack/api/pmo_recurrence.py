"""
Recurrence helper for PMO Project Tasks.

A PMO Task Master flagged `is_recurring` repeats on its own `deadline_offset`
cadence. This module provides `close_and_renew(task_doc)` — called from the
daily cron (`nirmaan_stack.tasks.pmo_task_renewal`) — which:

1. Inserts a PMO Task Submission Log row capturing the closing cycle.
2. Resets the task row (status, attachment, completion_date) and advances
   `expected_completion_date` to `today() + deadline_offset`.

Renewal halts when the project is in a stop status (Completed, CEO Hold).
"""

import frappe
from frappe.utils import add_days, getdate, today

STOP_STATUSES = {"Completed", "CEO Hold", "Halted"}
CYCLE_DONE_VALUES = {"Approve by client", "Done"}


def _next_cycle_number(task_name):
	row = frappe.db.sql(
		"""
		SELECT COALESCE(MAX(cycle_number), 0)
		FROM `tabPMO Task Submission Log`
		WHERE task = %s
		""",
		(task_name,),
	)
	return (row[0][0] or 0) + 1


def _previous_cycle_end(task_name):
	row = frappe.db.sql(
		"""
		SELECT cycle_end_date
		FROM `tabPMO Task Submission Log`
		WHERE task = %s
		ORDER BY cycle_number DESC
		LIMIT 1
		""",
		(task_name,),
	)
	return getdate(row[0][0]) if row and row[0][0] else None


def close_and_renew(task_doc, project_status=None):
	"""
	Close the current cycle and start a fresh one.

	Mutates `task_doc` in place; caller is responsible for `task_doc.save()`.
	The Submission Log row is persisted by this function directly.

	Returns True if a cycle was closed, False if no-op (not recurring, project
	stopped, zero/missing cadence, or task_master missing).
	"""
	if not task_doc.task_master:
		return False

	master = frappe.get_cached_doc("PMO Task Master", task_doc.task_master)
	if not master.get("is_recurring"):
		return False

	if project_status is None:
		project_status = frappe.db.get_value("Projects", task_doc.project, "status")
	if project_status in STOP_STATUSES:
		return False

	interval = int(master.deadline_offset or 0)
	if interval <= 0:
		return False  # zero cadence would infinite-loop on subsequent cron runs

	was_done = (task_doc.status or "") in CYCLE_DONE_VALUES
	was_force_marked = 0 if was_done or task_doc.status == "Not Done" else 1
	result = "Done" if was_done else "Not Done"

	cycle_end = (
		getdate(task_doc.expected_completion_date)
		if task_doc.expected_completion_date
		else getdate(today())
	)
	prev_end = _previous_cycle_end(task_doc.name)
	cycle_start = prev_end or add_days(cycle_end, -interval)

	log = frappe.new_doc("PMO Task Submission Log")
	log.task = task_doc.name
	log.project = task_doc.project
	log.task_master = task_doc.task_master
	log.cycle_number = _next_cycle_number(task_doc.name)
	log.cycle_start_date = cycle_start
	log.cycle_end_date = cycle_end
	log.result = result
	log.was_force_marked = was_force_marked
	log.closed_on = today()
	log.attachment = task_doc.attachment
	log.insert(ignore_permissions=True)

	task_doc.status = "Not Defined"
	task_doc.completion_date = None
	task_doc.attachment = None
	task_doc.expected_completion_date = add_days(today(), interval)
	return True
