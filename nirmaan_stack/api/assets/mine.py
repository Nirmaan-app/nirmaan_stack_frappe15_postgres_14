"""The signed-in person's own assets, whatever project they are booked against.

Asset Master reads follow the reader's project User Permissions (its `project` Link). An asset assigned
to someone for a project they are not on was therefore hidden from them: their profile counted the
assignment but showed no card and no Sign button, and the sidebar's declaration badge skipped it.
Owner, 2026-10-13: an asset assigned to a person always shows for that person.

Only the caller's own assets, and only what the profile card and the badge need -- no value, no
credentials, no project. Nobody else's assets are reachable through this.
"""

import frappe

ASSET_MASTER_DOCTYPE = "Asset Master"
ASSET_MANAGEMENT_DOCTYPE = "Asset Management"

MY_ASSET_FIELDS = (
    "name",
    "asset_name",
    "asset_category",
    "asset_condition",
    "asset_serial_number",
    "department",
    "current_assignee",
)


@frappe.whitelist(methods=["GET"])
def get_my_assets() -> list[dict]:
    """The assets the signed-in person holds, plus any an assignment row names them on.

    The second set covers an assignment row whose asset has moved on to someone else: the profile
    shows that row, so it needs the asset's name and category too.

    Returns:
        [{name, asset_name, asset_category, asset_condition, asset_serial_number, department,
          current_assignee}, ...] sorted by asset name.

    Example:
        GET /api/method/nirmaan_stack.api.assets.mine.get_my_assets
    """
    user = frappe.session.user
    if user == "Guest":
        frappe.throw("Log in to see your assets.", frappe.PermissionError)

    # get_all reads without the caller's permissions -- deliberately: both filters pin it to them.
    named = frappe.get_all(ASSET_MANAGEMENT_DOCTYPE, filters={"asset_assigned_to": user}, pluck="asset")
    return frappe.get_all(
        ASSET_MASTER_DOCTYPE,
        or_filters=[
            ["current_assignee", "=", user],
            ["name", "in", named or ["__none__"]],
        ],
        fields=list(MY_ASSET_FIELDS),
        order_by="asset_name asc",
    )
