"""Read for the project Billing tab: the package trackers and the summary totals.

The bill rows themselves come from the standard DataTable API (`Project Billing` doctype).
"""

import frappe

from nirmaan_stack.api.project_billing._queries import (
	MANAGER_FIELDS,
	MANAGERS_JOIN,
	bill_totals,
	next_bills_by_tracker,
	require_billing_access,
	stamp_can_edit_bills,
	totals_of,
	with_managers,
)
from nirmaan_stack.services.role_profiles import can_write_project_billing


@frappe.whitelist()
def get_project_billing(project: str) -> dict:
	require_billing_access()

	trackers = frappe.db.sql(
		f"""
		SELECT t.name, t.package, {MANAGER_FIELDS}, t.po_value, t.supply_dc, t.dc_updated_on, t.remarks
		FROM "tabProject Billing Tracker" t
		{MANAGERS_JOIN}
		WHERE t.project = %(project)s
		ORDER BY t.creation
		""",
		{"project": project},
		as_dict=True,
	)
	stamp_can_edit_bills([with_managers(tracker) for tracker in trackers])

	per_tracker = {
		row.key: row
		for row in bill_totals("billing_tracker", "b.project = %(project)s", {"project": project})
	}
	next_bills = next_bills_by_tracker([t.name for t in trackers])
	for tracker in trackers:
		tracker.update(totals_of(per_tracker.get(tracker.name)))
		tracker["next_bill"] = next_bills.get(tracker.name)

	project_totals = bill_totals("project", "b.project = %(project)s", {"project": project})
	summary = totals_of(project_totals[0] if project_totals else None)
	summary["supply_dc"] = sum(t.supply_dc or 0 for t in trackers)
	summary["po_value"] = sum(t.po_value or 0 for t in trackers)

	return {
		"trackers": trackers,
		"summary": summary,
		"can_write": can_write_project_billing(frappe.session.user),
	}
