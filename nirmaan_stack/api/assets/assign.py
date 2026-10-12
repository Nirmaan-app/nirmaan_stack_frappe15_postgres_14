"""Assign an asset to a person -- the whole assignment in one request.

Creates the Asset Management record (the current assignment) and, in the same transaction, makes the
person the asset's holder, sets the project, moves the asset's department when the person is in another
department, and writes the history row. The department-change reason is not a field on the assignment
(owner, 2026-10-12): it travels on the record's flags and is kept only in the asset's history.

The rules themselves live in `AssetManagement.validate` (one holder per asset, a reason to move
departments) and the Asset Management hooks, so this endpoint only gathers the input and commits.
"""

import frappe

ASSET_MASTER_DOCTYPE = "Asset Master"
ASSET_MANAGEMENT_DOCTYPE = "Asset Management"


@frappe.whitelist(methods=["POST"])
def assign_asset(
    asset: str,
    assigned_to: str,
    assigned_on: str,
    project: str | None = None,
    declaration: str | None = None,
    department_change_reason: str | None = None,
) -> dict:
    """Assign `asset` to `assigned_to`.

    Args:
        asset: Asset Master name.
        assigned_to: Nirmaan Users name (email) of the person receiving it.
        assigned_on: handover date (YYYY-MM-DD).
        project: Projects name, for Project assets.
        declaration: URL of a signed declaration uploaded with the assignment (optional).
        department_change_reason: why the asset moves to the person's department; required only
            when the asset already belongs to another department.

    Returns:
        {"assignment": <Asset Management name>, "department": <the asset's department after>}

    Example:
        POST /api/method/nirmaan_stack.api.assets.assign.assign_asset
        {"asset": "ASSET-LAP-029", "assigned_to": "bhavani@nirmaan.app", "assigned_on": "2026-10-12",
         "department_change_reason": "Moved to site team for the Whitefield project"}
    """
    if not frappe.has_permission(ASSET_MANAGEMENT_DOCTYPE, "create"):
        frappe.throw("You don't have permission to assign assets.", frappe.PermissionError)

    assignment = frappe.get_doc({
        "doctype": ASSET_MANAGEMENT_DOCTYPE,
        "asset": asset,
        "asset_assigned_to": assigned_to,
        "asset_assigned_on": assigned_on,
        "asset_declaration_attachment": declaration or None,
    })
    assignment.flags.department_change_reason = department_change_reason
    assignment.insert()

    if project:
        frappe.db.set_value(ASSET_MASTER_DOCTYPE, asset, "project", project)
        # asset_city / asset_state are fetched from the project; set_value does not fetch.
        city, state = frappe.db.get_value("Projects", project, ["project_city", "project_state"]) or (None, None)
        frappe.db.set_value(ASSET_MASTER_DOCTYPE, asset, {"asset_city": city, "asset_state": state})

    frappe.db.commit()
    return {
        "assignment": assignment.name,
        "department": frappe.db.get_value(ASSET_MASTER_DOCTYPE, asset, "department"),
    }
