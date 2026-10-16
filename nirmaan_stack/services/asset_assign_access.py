"""Who may assign and unassign which kind of asset (owner, 2026-10-13).

Admin, HR and PMO assign and unassign every asset; procurement only Project assets, never IT ones
(`ASSET_ASSIGN_ALL_PROFILES` / `ASSET_ASSIGN_PROJECT_PROFILES` in `services/role_profiles.py`). The
kind is the asset's category's `category_type`.

`assign_refusal` is the rule; `check_may_assign` loads the user's profile and the asset's kind for it.
Assign is checked in `AssetManagement.validate` (so the endpoint, the REST API and Desk all pass
through it) and unassign in `api/assets/assign.unassign_asset`, the only way to unassign.
"""

import frappe

from nirmaan_stack.services.role_profiles import (
    ASSET_ASSIGN_ALL_PROFILES,
    ASSET_ASSIGN_PROJECT_PROFILES,
    has_role_profile,
)

PROJECT = "Project"


def assign_refusal(category_type: str | None, *, all_kinds: bool, project_kind: bool, action: str) -> str | None:
    """Why the user may not `action` ("assign" / "unassign") an asset of `category_type`; None if they may.

    `all_kinds`: the user is Admin, HR or PMO. `project_kind`: the user is procurement.
    """
    if all_kinds:
        return None
    if project_kind:
        if category_type == PROJECT:
            return None
        return f"Procurement can {action} Project assets only. Ask Admin, HR or PMO to {action} this one."
    return f"You don't have permission to {action} assets."


def check_may_assign(asset: str, action: str) -> None:
    """Refuse (PermissionError) when the session user may not `action` this asset."""
    user = frappe.session.user
    category = frappe.db.get_value("Asset Master", asset, "asset_category")
    category_type = frappe.db.get_value("Asset Category", category, "category_type") if category else None
    refusal = assign_refusal(
        category_type,
        all_kinds=has_role_profile(user, ASSET_ASSIGN_ALL_PROFILES),
        project_kind=has_role_profile(user, ASSET_ASSIGN_PROJECT_PROFILES, superuser_passes=False),
        action=action,
    )
    if refusal:
        frappe.throw(refusal, frappe.PermissionError)
