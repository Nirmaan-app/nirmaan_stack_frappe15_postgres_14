"""The projects an asset can be assigned for: every Won project.

The Assign dialog's Project picker used a plain Projects read, which follows the assigner's project
User Permissions -- a procurement user allowed on one project was offered just that one. Owner,
2026-10-13: the picker lists all Won projects. Only people who may assign assets get the list
(`ASSET_ASSIGN_*_PROFILES`), and only what the picker shows.
"""

import frappe

from nirmaan_stack.services.role_profiles import (
    ASSET_ASSIGN_ALL_PROFILES,
    ASSET_ASSIGN_PROJECT_PROFILES,
    has_role_profile,
)

PROJECT_FIELDS = ("name", "project_name", "project_city", "project_state", "tendering_status")


@frappe.whitelist(methods=["GET"])
def get_won_projects() -> list[dict]:
    """Every Won project, for assigning an asset -- whatever projects the caller is allowed on.

    Returns:
        [{name, project_name, project_city, project_state, tendering_status}, ...] by project name.

    Example:
        GET /api/method/nirmaan_stack.api.assets.projects.get_won_projects
    """
    if not has_role_profile(frappe.session.user, ASSET_ASSIGN_ALL_PROFILES + ASSET_ASSIGN_PROJECT_PROFILES):
        frappe.throw("You don't have permission to assign assets.", frappe.PermissionError)

    # get_all reads without the caller's project permissions -- the point of this endpoint.
    return frappe.get_all(
        "Projects",
        filters={"tendering_status": "Won"},
        fields=list(PROJECT_FIELDS),
        order_by="project_name asc",
    )
