"""Assign an asset to a person, or unassign it -- each the whole change in one request.

Creates the Asset Management record (the current assignment) and, in the same transaction, makes the
person the asset's holder, sets the project, moves the asset's department when the person is in another
department, and writes the history row. The department-change reason is not a field on the assignment
(owner, 2026-10-12): it travels on the record's flags and is kept only in the asset's history.

The rules themselves live in `AssetManagement.validate` (one holder per asset, a reason to move
departments) and the Asset Management hooks, so this endpoint only gathers the input and commits.
"""

import frappe

from nirmaan_stack.integrations.controllers.asset_management import free_asset, notify_asset_changed
from nirmaan_stack.services.asset_assign_access import check_may_assign
from nirmaan_stack.services.asset_history import UNASSIGNED, add_history
from nirmaan_stack.services.asset_project import check_asset_project
from nirmaan_stack.services.asset_unassign import unassign_reason_refusal, unassign_reason_text

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
    # A Won project, on a Project asset only (owner, 2026-10-15) -- checked before anything is written.
    check_asset_project(frappe.db.get_value(ASSET_MASTER_DOCTYPE, asset, "asset_category"), project)

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


@frappe.whitelist(methods=["POST"])
def unassign_asset(asset: str, reason: str, details: str | None = None, assignment: str | None = None) -> dict:
    """Unassign `asset`, saying why (owner, 2026-10-13).

    The reason must be one of `services/asset_unassign.UNASSIGN_REASONS`; "Other" needs details. It is
    kept on the asset's "Unassigned" history row. Deleting the assignment is the unassign itself: its
    on_trash hook writes that row, keeps the declaration file and frees the asset (holder, project,
    city, state), all in this one transaction.

    Args:
        asset: Asset Master name.
        reason: one of UNASSIGN_REASONS.
        details: free text; required (at least 10 characters) for "Other", optional otherwise.
        assignment: the Asset Management row to remove. Default: the row of the asset's current
            holder. A profile card passes its own row, which may be an old leftover for someone else.

    Returns:
        {"asset": <asset>}

    Example:
        POST /api/method/nirmaan_stack.api.assets.assign.unassign_asset
        {"asset": "ASSET-LAP-029", "reason": "Employee left / exit", "details": "Returned on last day"}
    """
    # Procurement may unassign Project assets only; Admin, HR and PMO any (services/asset_assign_access.py).
    check_may_assign(asset, "unassign")
    refusal = unassign_reason_refusal(reason, details)
    if refusal:
        frappe.throw(refusal)

    end_assignment(asset, unassign_reason_text(reason, details), assignment)
    frappe.db.commit()
    return {"asset": asset}


def end_assignment(asset: str, reason_text: str, assignment: str | None = None) -> None:
    """End `asset`'s assignment and record why, in the caller's transaction (the caller commits).

    Shared by `unassign_asset` and `api/assets/lost_damaged.mark_lost_damaged`, which checked who may do it and
    the reason. `assignment` defaults to the current holder's row.
    """
    holder = frappe.db.get_value(ASSET_MASTER_DOCTYPE, asset, "current_assignee")
    if not assignment and holder:
        assignment = frappe.db.get_value(
            ASSET_MANAGEMENT_DOCTYPE, {"asset": asset, "asset_assigned_to": holder}, "name"
        )

    if assignment:
        if frappe.db.get_value(ASSET_MANAGEMENT_DOCTYPE, assignment, "asset") != asset:
            frappe.throw(f"That assignment is not for {asset}.")
        # delete_doc checks the delete permission; the reason reaches on_trash on the record's flags.
        frappe.delete_doc(ASSET_MANAGEMENT_DOCTYPE, assignment, flags={"unassign_reason": reason_text})
    elif holder:
        # A holder with no assignment row: free the asset directly, and still record why.
        if not frappe.has_permission(ASSET_MASTER_DOCTYPE, "write", asset):
            frappe.throw("You don't have permission to unassign assets.", frappe.PermissionError)
        free_asset(asset)
        add_history(asset, UNASSIGNED, assigned_to=holder, reason=reason_text)
        notify_asset_changed(asset)
    else:
        frappe.throw(f"{asset} is not assigned to anyone.")
