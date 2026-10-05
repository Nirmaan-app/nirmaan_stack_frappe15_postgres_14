"""Shared reads for the client billing tracker endpoints.

Every money total and count is a GROUP BY in the database, filtered by the
status sets owned by `services/project_billing/rules.py`. NA bills are left out of
every count and total.
"""

import frappe
from frappe import _

from nirmaan_stack.services.project_billing.rules import (
	APPROVED_STATUSES,
	NA_STATUS,
	PENDING_STATUSES,
	can_edit_package_bills,
	next_bill,
)
from nirmaan_stack.services.role_profiles import can_write_project_billing, is_nirmaan_admin


def require_billing_access():
	"""Billing is visible to Admin, PMO and billing profiles only (owner, 2026-10-03)."""
	if not can_write_project_billing(frappe.session.user):
		frappe.throw(_("Billing is available to Admin, PMO and Billing users only."), frappe.PermissionError)


# Each tracker `t` gets its managers as two arrays in pick order; `with_managers` pairs them.
MANAGERS_JOIN = """
	LEFT JOIN (
		SELECT m.parent,
			ARRAY_AGG(m.manager ORDER BY m.idx) AS manager_ids,
			ARRAY_AGG(COALESCE(mu.full_name, m.manager) ORDER BY m.idx) AS manager_names
		FROM "tabProject Billing Manager" m
		LEFT JOIN "tabUser" mu ON mu.name = m.manager
		WHERE m.parenttype = 'Project Billing Tracker'
		GROUP BY m.parent
	) mg ON mg.parent = t.name
"""

MANAGER_FIELDS = "mg.manager_ids, mg.manager_names"


def managed_by(param: str) -> str:
	"""WHERE clause: the user in `%(param)s` is one of tracker `t`'s managers."""
	return f"""EXISTS (
		SELECT 1 FROM "tabProject Billing Manager" m
		WHERE m.parent = t.name AND m.parenttype = 'Project Billing Tracker' AND m.manager = %({param})s
	)"""


def with_managers(row: dict) -> dict:
	"""Swap the MANAGERS_JOIN arrays for `billing_managers: [{user, full_name}]`."""
	ids = row.pop("manager_ids", None) or []
	names = row.pop("manager_names", None) or []
	row["billing_managers"] = [{"user": user, "full_name": name} for user, name in zip(ids, names)]
	return row


def stamp_can_edit_bills(rows: list[dict]) -> list[dict]:
	"""Set `can_edit_bills` on tracker rows that went through `with_managers`.

	The screens offer Add Bill, the bill pencil and Supply DC only where it is true;
	the controller hooks enforce the same rule on every save.
	"""
	user = frappe.session.user
	admin = is_nirmaan_admin(user)
	for row in rows:
		row["can_edit_bills"] = can_edit_package_bills(user, [m["user"] for m in row["billing_managers"]], admin)
	return rows


BILL_FIELDS = f"""
	b.name, b.billing_tracker, b.project, p.project_name, b.package, b.bill_type, b.status,
	b.bill_value, b.payment_received, b.invoice_requested, b.eta_date,
	b.first_submission_date, b.approval_date, b.bill_document_link, b.bill_attachment, b.modified,
	{MANAGER_FIELDS}, t.supply_dc AS tracker_supply_dc, t.po_value AS tracker_po_value
"""

BILL_FROM = f"""
	FROM "tabProject Billing" b
	JOIN "tabProject Billing Tracker" t ON t.name = b.billing_tracker
	LEFT JOIN "tabProjects" p ON p.name = b.project
	{MANAGERS_JOIN}
"""


def status_params():
	return {
		"approved": tuple(APPROVED_STATUSES),
		"pending": tuple(PENDING_STATUSES),
		"na": NA_STATUS,
	}


def bill_totals(group_by: str, where: str = "1=1", params: dict | None = None) -> list[dict]:
	"""Bill counts and money totals grouped by one `b.<column>`.

	No invoiced / inflow totals here: those come from the project's Project Invoices and
	Project Inflows (the Financials tab), never from the bills (decision 11).
	"""
	values = dict(status_params(), **(params or {}))
	return frappe.db.sql(
		f"""
		SELECT b.{group_by} AS key,
			COUNT(*) FILTER (WHERE b.status <> %(na)s) AS bill_count,
			COUNT(*) FILTER (WHERE b.status IN %(pending)s) AS pending_count,
			COALESCE(SUM(b.bill_value) FILTER (WHERE b.status <> %(na)s), 0) AS billed,
			COALESCE(SUM(b.bill_value) FILTER (WHERE b.status IN %(approved)s), 0) AS approved
		FROM "tabProject Billing" b
		WHERE {where}
		GROUP BY b.{group_by}
		""",
		values,
		as_dict=True,
	)


def next_bills_by_tracker(trackers: list[str]) -> dict[str, dict]:
	"""Each tracker's next bill: the pending bill with the earliest ETA."""
	if not trackers:
		return {}
	rows = frappe.db.sql(
		"""
		SELECT name, billing_tracker, bill_type, status, eta_date
		FROM "tabProject Billing"
		WHERE billing_tracker IN %(trackers)s AND status IN %(pending)s
		ORDER BY creation
		""",
		{"trackers": tuple(trackers), "pending": tuple(PENDING_STATUSES)},
		as_dict=True,
	)
	grouped: dict[str, list[dict]] = {}
	for row in rows:
		grouped.setdefault(row.billing_tracker, []).append(row)
	return {tracker: next_bill(bills) for tracker, bills in grouped.items()}


def overdue_counts_by_tracker(trackers: list[str]) -> dict[str, int]:
	"""Each tracker's overdue bills: pending (not approved yet) with an ETA before today."""
	if not trackers:
		return {}
	return dict(
		frappe.db.sql(
			"""
			SELECT billing_tracker, COUNT(*)
			FROM "tabProject Billing"
			WHERE billing_tracker IN %(trackers)s AND status IN %(pending)s AND eta_date < %(today)s
			GROUP BY billing_tracker
			""",
			{"trackers": tuple(trackers), "pending": tuple(PENDING_STATUSES), "today": frappe.utils.today()},
		)
	)


def empty_totals() -> dict:
	return {
		"bill_count": 0,
		"pending_count": 0,
		"billed": 0,
		"approved": 0,
	}


def totals_of(row: dict | None) -> dict:
	out = empty_totals()
	if row:
		for key in out:
			out[key] = row.get(key) or 0
	return out
