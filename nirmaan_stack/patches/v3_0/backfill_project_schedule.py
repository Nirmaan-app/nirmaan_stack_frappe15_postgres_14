"""Backfill `Project Schedule` docs for projects that pre-date the
sync_project_schedule hook.

For each existing Project that has at least one enabled
`project_work_header_entries` row but no `Project Schedule` doc, run the
same reconcile path the runtime uses so child rows get seeded with
formula-derived `start_date` / `end_date` based on the project's window
and each Work Milestone's `week_1..week_9` anchors.

After insert, the schedule's `creation` and `owner` are aligned to the
project's so the audit timeline reflects the project's lifecycle (instead
of "today" for every backfilled row). Without this alignment every old
project's schedule would show today's creation timestamp.

This patch also fixes any already-backfilled Project Schedule docs whose
`creation` doesn't match their project's — re-running is safe and
idempotent.
"""

import frappe

from nirmaan_stack.api.milestone.project_schedule import (
	_enabled_headers,
	_reconcile_rows,
)


def execute():
	project_names = frappe.get_all("Projects", pluck="name", limit=0)
	created = 0
	skipped_no_headers = 0
	realigned = 0
	failed = []

	for project_name in project_names:
		try:
			project_doc = frappe.get_doc("Projects", project_name)
		except Exception as exc:
			failed.append((project_name, f"load failed: {exc}"))
			continue

		if frappe.db.exists("Project Schedule", project_name):
			# Schedule already exists — only realign timestamps if they
			# diverge from the project's. Avoids spamming `modified` on
			# already-correct rows.
			realigned += _align_creation(project_doc)
			continue

		if not _enabled_headers(project_doc):
			skipped_no_headers += 1
			continue

		try:
			sched = frappe.new_doc("Project Schedule")
			sched.project = project_name
			_reconcile_rows(sched, project_doc)
			sched.insert(ignore_permissions=True)
			_align_creation(project_doc)
			created += 1
		except Exception as exc:
			failed.append((project_name, f"insert failed: {exc}"))
			frappe.db.rollback()
			continue

	frappe.db.commit()

	print(
		f"[backfill_project_schedule] created={created} "
		f"realigned={realigned} "
		f"skipped_no_headers={skipped_no_headers} "
		f"failed={len(failed)}"
	)
	for name, reason in failed:
		print(f"  FAILED {name}: {reason}")


def _align_creation(project_doc) -> int:
	"""Set the Project Schedule's `creation` / `modified` / `owner` (and the
	same fields on every child `Project Schedule Milestone` row) to match
	the project's, but only if they differ. Returns 1 when an update was
	made, else 0.

	Aligning the child rows is what stops the Desk grid from showing today's
	date as the row's "edit date" for backfilled schedules.
	"""
	if not project_doc.creation:
		return 0
	current = frappe.db.get_value(
		"Project Schedule",
		project_doc.name,
		["creation", "modified", "owner"],
		as_dict=True,
	)
	if not current:
		return 0
	target_ts = project_doc.creation
	target_owner = project_doc.owner
	already_aligned = (
		str(current.creation) == str(target_ts)
		and str(current.modified) == str(target_ts)
		and current.owner == target_owner
	)
	if already_aligned:
		return 0
	# Align parent: raw SQL so we can set `modified` explicitly (the framework
	# would otherwise stamp it to now()).
	frappe.db.sql(
		"""
		UPDATE "tabProject Schedule"
		SET creation = %s, modified = %s, owner = %s
		WHERE name = %s
		""",
		(target_ts, target_ts, target_owner, project_doc.name),
	)
	# Align every child row under this parent.
	frappe.db.sql(
		"""
		UPDATE "tabProject Schedule Milestone"
		SET creation = %s, modified = %s, owner = %s
		WHERE parent = %s AND parenttype = 'Project Schedule'
		""",
		(target_ts, target_ts, target_owner, project_doc.name),
	)
	return 1
