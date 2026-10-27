"""
Destination projects for the New Transfer page (Project → Project, Warehouse → Project).

Admin, PMO and Material Procurement may send material to ANY Won project, whatever
projects they are themselves assigned to (rule set by Abhishek, 2026-10-16). A plain
``frappe.get_list`` hides the projects a project-scoped user (User Permission rows on
Projects) is not assigned to, so this reads with ``frappe.get_all``, which skips User
Permissions, and gates on the caller's role profile instead.

Mirrors ``ITM_CREATE_ROLES`` in ``frontend/src/constants/itm.ts``: the roles the page
lets pick a destination project. Project Managers and Leads only return stock to the
warehouse, so they never call this.
"""

import frappe

from nirmaan_stack.services.role_profiles import (
	ADMIN_PROFILE,
	MATERIAL_PROCUREMENT_PROFILES,
	PMO_EXECUTIVE_PROFILE,
)

DESTINATION_PROFILES = (ADMIN_PROFILE, PMO_EXECUTIVE_PROFILE) + tuple(MATERIAL_PROCUREMENT_PROFILES)


def _require_destination_profile():
	"""Permit the ``Administrator`` user or a user whose role profile is in DESTINATION_PROFILES.

	Compares the user's *role profile*, the string the frontend reads via ``useUserData``,
	not ``frappe.get_roles`` (which returns the profile's roles, never its name). Same
	reasoning as ``add_warehouse_stock._require_add_stock_profile``.
	"""
	user = frappe.session.user
	if user == "Administrator":
		return
	if frappe.db.get_value("User", user, "role_profile_name") in DESTINATION_PROFILES:
		return
	frappe.throw(
		"Only Admin, PMO and Procurement users may send material to a project.",
		frappe.PermissionError,
	)


@frappe.whitelist()
def get_transfer_destinations() -> list[dict]:
	"""Every Won project as ``[{"name", "project_name"}]``, sorted by project name.

	Won only: a tender-stage project has no site to receive material.
	"""
	_require_destination_profile()
	return frappe.get_all(
		"Projects",
		filters={"tendering_status": "Won"},
		fields=["name", "project_name"],
		order_by="project_name asc",
		limit_page_length=0,
	)
