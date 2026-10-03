"""Reads for the Billing Trackers page: Project Wise, Bill Wise, My Bills."""

import frappe

from nirmaan_stack.api.project_billing._queries import (
	BILL_FIELDS,
	BILL_FROM,
	MANAGER_FIELDS,
	MANAGERS_JOIN,
	bill_totals,
	managed_by,
	next_bills_by_tracker,
	require_billing_access,
	stamp_can_edit_bills,
	status_params,
	totals_of,
	with_managers,
)
from nirmaan_stack.services.project_billing.rules import (
	DEADLINE_CHOICES,
	PENDING_STATUSES,
	SUMMARY_COLUMNS,
	deadline_window,
	summary_column,
)
from nirmaan_stack.services.role_profiles import can_write_project_billing

UNASSIGNED = "Unassigned"


def _trackers(where: str = "1=1", params: dict | None = None) -> list[dict]:
	rows = frappe.db.sql(
		f"""
		SELECT t.name, t.project, p.project_name, p.status AS project_status, t.package, {MANAGER_FIELDS},
			t.po_value, t.supply_dc, t.dc_updated_on, t.remarks
		FROM "tabProject Billing Tracker" t
		LEFT JOIN "tabProjects" p ON p.name = t.project
		{MANAGERS_JOIN}
		WHERE {where}
		ORDER BY p.project_name, t.creation
		""",
		params or {},
		as_dict=True,
	)
	return stamp_can_edit_bills([with_managers(row) for row in rows])


@frappe.whitelist()
def get_billing_projects() -> dict:
	"""Project Wise: one row per project, with its packages for the expanded view."""
	require_billing_access()

	trackers = _trackers()
	per_tracker = {row.key: row for row in bill_totals("billing_tracker")}
	next_bills = next_bills_by_tracker([t.name for t in trackers])

	projects: dict[str, dict] = {}
	for t in trackers:
		project = projects.setdefault(
			t.project,
			{
				"project": t.project,
				"project_name": t.project_name or t.project,
				"status": t.project_status,
				"managers": [],
				"packages": [],
				"supply_dc": 0,
				"po_value": 0,
				**totals_of(None),
			},
		)
		totals = totals_of(per_tracker.get(t.name))
		for key, value in totals.items():
			project[key] += value
		project["supply_dc"] += t.supply_dc or 0
		project["po_value"] += t.po_value or 0
		for manager in [m["full_name"] for m in t.billing_managers] or [UNASSIGNED]:
			if manager not in project["managers"]:
				project["managers"].append(manager)
		project["packages"].append(dict(t, **totals, next_bill=next_bills.get(t.name)))

	rows = list(projects.values())
	header = totals_of(None)
	for row in rows:
		for key in header:
			header[key] += row[key]

	return {
		"projects": rows,
		"totals": dict(header, project_count=len(rows)),
		"can_write": can_write_project_billing(frappe.session.user),
	}


def _deadline_where(deadline: str | None) -> tuple[str, dict]:
	"""SQL for the Deadline filter on bill `b`; the window itself is `rules.deadline_window`."""
	if not deadline:
		return "", {}
	if deadline not in DEADLINE_CHOICES:
		frappe.throw(f"Unknown deadline filter: {deadline}")
	window = deadline_window(deadline, frappe.utils.getdate())
	clauses = ["b.status IN %(pending)s"]
	params = {}
	if window["eta_unset"]:
		clauses.append("b.eta_date IS NULL")
	if window["eta_from"]:
		clauses.append("b.eta_date >= %(eta_from)s")
		params["eta_from"] = window["eta_from"]
	if window["eta_to"]:
		clauses.append("b.eta_date <= %(eta_to)s")
		params["eta_to"] = window["eta_to"]
	return " AND " + " AND ".join(clauses), params


def _all_managers() -> list[dict]:
	"""Every billing manager of any tracker, plus Unassigned when some tracker has none."""
	rows = frappe.db.sql(
		"""
		SELECT DISTINCT m.manager, mu.full_name AS manager_name
		FROM "tabProject Billing Manager" m
		LEFT JOIN "tabUser" mu ON mu.name = m.manager
		WHERE m.parenttype = 'Project Billing Tracker'
		""",
		as_dict=True,
	)
	unassigned = frappe.db.sql(
		"""
		SELECT 1 FROM "tabProject Billing Tracker" t
		WHERE NOT EXISTS (
			SELECT 1 FROM "tabProject Billing Manager" m
			WHERE m.parent = t.name AND m.parenttype = 'Project Billing Tracker'
		)
		LIMIT 1
		"""
	)
	if unassigned:
		rows.append(frappe._dict(manager=None, manager_name=None))
	return rows


@frappe.whitelist()
def get_manager_summary(deadline: str | None = None) -> dict:
	"""Bill Wise summary grid: bill counts per manager × status column, per project.

	A package with several managers counts its bills under each of them, so the
	manager rows can add up to more than the overall bill count.

	`deadline` (week / overdue / none) keeps only the pending bills in that ETA window,
	the same rule as the bills table's Deadline filter. Every manager stays listed,
	with zero counts when none of their bills match.
	"""
	require_billing_access()
	deadline_sql, deadline_params = _deadline_where(deadline)

	# Counted per STATUS so the grid can show, per count, which statuses it is made of;
	# each status's column comes from `summary_column`.
	rows = frappe.db.sql(
		f"""
		SELECT m.manager, mu.full_name AS manager_name, b.project, p.project_name,
			b.status, COUNT(*) AS n
		FROM "tabProject Billing" b
		JOIN "tabProject Billing Tracker" t ON t.name = b.billing_tracker
		LEFT JOIN "tabProjects" p ON p.name = b.project
		LEFT JOIN "tabProject Billing Manager" m
			ON m.parent = t.name AND m.parenttype = 'Project Billing Tracker'
		LEFT JOIN "tabUser" mu ON mu.name = m.manager
		WHERE b.status <> %(na)s{deadline_sql}
		GROUP BY 1, 2, 3, 4, 5
		""",
		dict(status_params(), **deadline_params),
		as_dict=True,
	)

	empty = {key: 0 for key, _label, _statuses in SUMMARY_COLUMNS}
	managers: dict[str, dict] = {}

	def manager_of(row):
		return managers.setdefault(
			row.manager or UNASSIGNED,
			{
				"manager": row.manager,
				"manager_name": row.manager_name or row.manager or UNASSIGNED,
				"counts": dict(empty),
				"by_status": {},
				"projects": {},
			},
		)

	# Every manager first, so one with no matching bills still shows a row of zeros.
	for row in _all_managers():
		manager_of(row)
	for row in rows:
		manager = manager_of(row)
		project = manager["projects"].setdefault(
			row.project,
			{
				"project": row.project,
				"project_name": row.project_name or row.project,
				"counts": dict(empty),
				"by_status": {},
			},
		)
		col = summary_column(row.status)
		if not col:
			continue
		for target in (manager, project):
			target["counts"][col] += row.n
			target["by_status"][row.status] = target["by_status"].get(row.status, 0) + row.n

	out = []
	for manager in sorted(managers.values(), key=lambda m: m["manager_name"].lower()):
		manager["projects"] = sorted(manager["projects"].values(), key=lambda p: p["project_name"].lower())
		out.append(manager)

	return {
		# `statuses` lets the grid say which bill statuses each column counts.
		"columns": [
			{"key": key, "label": label, "statuses": list(statuses)} for key, label, statuses in SUMMARY_COLUMNS
		],
		"managers": out,
	}


@frappe.whitelist()
def get_my_bills() -> dict:
	"""My Bills: bills of the packages the current user is a manager of, and those packages."""
	require_billing_access()
	user = frappe.session.user
	rows = frappe.db.sql(
		f"""
		SELECT {BILL_FIELDS} {BILL_FROM}
		WHERE {managed_by("user")}
		ORDER BY b.eta_date NULLS LAST, p.project_name, b.package, b.creation
		""",
		{"user": user},
		as_dict=True,
	)
	bills = [with_managers(row) for row in rows]

	today = frappe.utils.getdate()
	week = frappe.utils.add_days(today, 7)
	pending = [b for b in bills if b.status in PENDING_STATUSES]
	counts = {
		"total": len([b for b in bills if b.status != "NA"]),
		"pending": len(pending),
		"due_in_7_days": len([b for b in pending if b.eta_date and today <= b.eta_date <= week]),
		"overdue": len([b for b in pending if b.eta_date and b.eta_date < today]),
	}

	return {
		"user": user,
		"user_name": frappe.db.get_value("User", user, "full_name") or user,
		"bills": bills,
		"counts": counts,
		"trackers": _trackers(managed_by("user"), {"user": user}),
		"can_write": can_write_project_billing(user),
	}
