"""
Single-document fetch endpoint for the Internal Transfer Memo detail page.

Returns the full ITM document (including child ``items`` rows) along with
denormalised display fields joined from ``Projects`` and ``User`` so the
frontend can render the detail view without additional round-trips.
"""

import frappe
from frappe import _


@frappe.whitelist()
def get_itm(name: str) -> dict:
	"""Fetch an Internal Transfer Memo by name with joined display labels.

	Args:
	    name: ``Internal Transfer Memo`` docname.

	Returns:
	    ``{
	        "itm": <doc.as_dict including items>,
	        "source_project_name": str | None,
	        "target_project_name": str | None,
	        "requested_by_full_name": str | None,
	        "approved_by_full_name": str | None,
	    }``
	"""

	if frappe.session.user == "Guest":
		frappe.throw(_("Authentication required."), frappe.PermissionError)

	# Frappe's permissions are checked inside get_doc; DoesNotExistError propagates as 404.
	doc = frappe.get_doc("Internal Transfer Memo", name)

	# --- Project display names (single query, handles source == target) ---
	project_names: dict[str, str | None] = {}
	project_ids = tuple({p for p in (doc.source_project, doc.target_project) if p})
	if project_ids:
		rows = frappe.db.sql(
			"""
			SELECT name, project_name
			FROM "tabProjects"
			WHERE name IN %(ids)s
			""",
			{"ids": project_ids},
			as_dict=True,
		)
		project_names = {r["name"]: r["project_name"] for r in rows}

	# --- User full names (single query, skip "Administrator" non-email) ---
	user_names: dict[str, str | None] = {}
	user_ids = tuple({u for u in (doc.requested_by, doc.approved_by) if u})
	if user_ids:
		rows = frappe.db.sql(
			"""
			SELECT name, full_name
			FROM "tabUser"
			WHERE name IN %(ids)s
			""",
			{"ids": user_ids},
			as_dict=True,
		)
		user_names = {r["name"]: r["full_name"] for r in rows}

	# --- Transfer Request status (if linked) ---
	transfer_request_status = None
	if doc.transfer_request:
		tr_status = frappe.db.get_value(
			"Internal Transfer Request", doc.transfer_request, "status"
		)
		transfer_request_status = tr_status

	return {
		"itm": doc.as_dict(),
		"source_project_name": project_names.get(doc.source_project),
		"target_project_name": project_names.get(doc.target_project),
		"requested_by_full_name": user_names.get(doc.requested_by) if doc.requested_by else None,
		"approved_by_full_name": user_names.get(doc.approved_by) if doc.approved_by else None,
		"transfer_request": doc.transfer_request,
		"transfer_request_status": transfer_request_status,
	}
