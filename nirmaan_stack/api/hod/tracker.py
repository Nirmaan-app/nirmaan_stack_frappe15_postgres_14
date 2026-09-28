# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""HOD Tracker: every project's handover progress, in ONE query.

The Handover Documents TAB reads a single project (`api/hod/project_hod.get_project_hod`); this is the
cross-project view behind the sidebar's "HOD Tracker".

It is deliberately a GROUP BY and not a row loop. ADR-0010 puts a count over many rows in the database,
and the Design Tracker's own list endpoint (`api/design_tracker/get_tracker_list.py`) is the
counter-example in this app -- it calls `frappe.get_doc` once per tracker, which is affordable at ~100
trackers and is not the pattern to copy onto a table that grows at 17 rows per project per system.

THE NUMBERS ARE THE TAB'S NUMBERS. `services/hod/checklist.counts` defines them: `needed` is the
switched-on rows and `completed` is the YES count among them, so a system reads `12/16` here exactly as
it reads on the project. NA rows stay IN the denominator, which is what the tab does -- a handover with
"not applicable" answers does not reach 16/16, and the tracker must not quietly disagree with the screen
someone opens next. The arithmetic is restated in SQL because the aggregate never loads a row;
`test_hod_tracker` pins the two definitions against each other so they cannot drift.
"""

import frappe
from frappe import _

DOCTYPE = "Project HOD Document"

# `checklist.normalise_status` reads anything unrecognised -- a blank, or one of the retired
# Pending / Form Filled / Completed -- as NO. The SQL has to do the same, or a row that has never been
# answered would fall out of every bucket and `no` would not add up.
_COUNTS_SQL = """
	SELECT
		d.project                                   AS project,
		p.project_name                              AS project_name,
		p.status                                    AS project_status,
		d.hod_system                                AS hod_system,
		COALESCE(s.display_name, d.hod_system)      AS system_label,
		s.work_package                              AS work_package,
		COUNT(*)                                    AS total,
		SUM(CASE WHEN COALESCE(d.disabled, 0) = 1 THEN 1 ELSE 0 END) AS switched_off,
		SUM(CASE WHEN COALESCE(d.disabled, 0) = 0
			AND UPPER(TRIM(COALESCE(d.status, ''))) = 'YES' THEN 1 ELSE 0 END) AS completed,
		SUM(CASE WHEN COALESCE(d.disabled, 0) = 0
			AND UPPER(TRIM(COALESCE(d.status, ''))) = 'NA'  THEN 1 ELSE 0 END) AS na,
		MAX(d.modified)                             AS last_activity
	FROM "tabProject HOD Document" d
	LEFT JOIN "tabProjects"   p ON p.name = d.project
	LEFT JOIN "tabHOD System" s ON s.name = d.hod_system
	GROUP BY d.project, p.project_name, p.status, d.hod_system, s.display_name, s.work_package
	ORDER BY p.project_name ASC, COALESCE(s.display_name, d.hod_system) ASC
"""


@frappe.whitelist()
def get_hod_trackers() -> list:
	"""One entry per project that has started a handover, with its systems nested.

	A project appears here because it HAS `Project HOD Document` rows -- there is no parent record to
	read (owner ruling 2026-09-21, see `api/hod/project_hod.py`), so the rows' own `project` is the
	list.
	"""
	if not frappe.has_permission(DOCTYPE, "read"):
		raise frappe.PermissionError(_("Not permitted to read handover documents."))

	rows = frappe.db.sql(_COUNTS_SQL, as_dict=True)

	by_project: dict = {}
	for r in rows:
		needed = int(r.total or 0) - int(r.switched_off or 0)
		completed = int(r.completed or 0)
		na = int(r.na or 0)
		system = {
			"hod_system": r.hod_system,
			"label": r.system_label or r.hod_system,
			"work_package": r.work_package,
			"completed": completed,
			"na": na,
			# The third answer is whatever is neither YES nor NA among the switched-on rows.
			"no": needed - completed - na,
			"off": int(r.switched_off or 0),
			"needed": needed,
		}
		entry = by_project.get(r.project)
		if entry is None:
			entry = by_project[r.project] = {
				"project": r.project,
				"project_name": r.project_name or r.project,
				"status_of_project": r.project_status or "",
				"systems": [],
				"completed": 0,
				"needed": 0,
				"na": 0,
				"last_activity": None,
			}
		entry["systems"].append(system)
		entry["completed"] += completed
		entry["needed"] += needed
		entry["na"] += na
		if r.last_activity and (entry["last_activity"] is None or r.last_activity > entry["last_activity"]):
			entry["last_activity"] = r.last_activity

	return list(by_project.values())
