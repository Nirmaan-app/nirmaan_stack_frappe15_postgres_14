"""Which project an asset may be booked to (owner, 2026-10-15): a Won project, and only for a Project asset.

The Assign and Edit dialogs already offer only Won projects (`api/assets/projects.get_won_projects`); this is
the same rule on the server, so a request can't book an asset to a project that doesn't exist, a lost tender,
or put a project on an IT asset. Checked by `api/assets/assign.assign_asset` and by `AssetMaster.validate` when
the project changes (an asset booked earlier to a project that is no longer Won still saves).
"""

import frappe

WON = "Won"
PROJECT_ASSET = "Project"


def project_refusal(project: str | None, category_type: str | None, exists: bool, tendering_status: str | None) -> str | None:
    """Why `project` can't go on an asset of `category_type`, or None when it can. Pure."""
    if not project:
        return None
    if category_type != PROJECT_ASSET:
        return "Only Project assets can be booked to a project."
    if not exists:
        return f"The project {project} doesn't exist. Choose a Won project."
    if tendering_status != WON:
        return f"The project {project} isn't Won. Choose a Won project."
    return None


def check_asset_project(asset_category: str | None, project: str | None) -> None:
    """Refuse (ValidationError) a project the asset can't be booked to."""
    if not project:
        return
    category_type = frappe.db.get_value("Asset Category", asset_category, "category_type") if asset_category else None
    status = frappe.db.get_value("Projects", project, "tendering_status")
    refusal = project_refusal(project, category_type, bool(frappe.db.exists("Projects", project)), status)
    if refusal:
        frappe.throw(refusal)
