"""
Daily cron entry point for PMO recurring-task rollover.

Scans all PMO Project Task rows belonging to recurring masters whose deadline
has elapsed, and rolls them over via `pmo_recurrence.close_and_renew`. Halts
per task when the parent project is in a stop status (Completed, CEO Hold).
"""

import frappe
from frappe.utils import today

from nirmaan_stack.api.pmo_recurrence import close_and_renew


def renew_due_recurring_tasks():
	# Pre-migration safety: skip silently if schema additions aren't applied yet.
	if not frappe.db.has_column("PMO Task Master", "is_recurring"):
		return {"renewed": 0, "scanned": 0, "skipped": "is_recurring column missing"}
	if not frappe.db.table_exists("PMO Task Submission Log"):
		return {"renewed": 0, "scanned": 0, "skipped": "submission log table missing"}

	rows = frappe.db.sql(
		"""
		SELECT pt.name
		FROM `tabPMO Project Task` pt
		INNER JOIN `tabPMO Task Master` tm ON pt.task_master = tm.name
		INNER JOIN `tabProjects` p ON pt.project = p.name
		WHERE tm.is_recurring = 1
		  AND p.status NOT IN ('Completed', 'CEO Hold', 'Halted')
		  AND pt.expected_completion_date IS NOT NULL
		  AND pt.expected_completion_date < %s
		""",
		(today(),),
		as_dict=True,
	)

	renewed = 0
	for r in rows:
		try:
			doc = frappe.get_doc("PMO Project Task", r.name)
			project_status = frappe.db.get_value("Projects", doc.project, "status")
			if close_and_renew(doc, project_status=project_status):
				doc.save(ignore_permissions=True)
				# Commit per-iteration so one bad row can't poison the batch
				# (close_and_renew inserts a Submission Log row before mutating
				# the task — both must persist atomically per cycle).
				frappe.db.commit()
				renewed += 1
		except Exception:
			# Rollback the partial cycle insert/save before moving on.
			frappe.db.rollback()
			frappe.log_error(
				frappe.get_traceback(),
				f"PMO recurrence rollover failed for {r.name}",
			)

	return {"renewed": renewed, "scanned": len(rows)}
