"""Project assignees -- taking a user off a project.

An assignment is a Frappe `User Permission` (allow = "Projects", for_value = the
project). ASSIGNING is still a plain `User Permission` insert from the browser (the
Project Overview "Assignees" card and the user profile page); this module owns
REMOVING one from the project side.

Wire contract: `frontend/src/pages/projects/data/tab/overview/useProjectOverviewTabApi.ts`.
"""

import frappe

from nirmaan_stack.integrations.controllers.user_permission import sync_has_project
from nirmaan_stack.services.role_profiles import is_nirmaan_admin


@frappe.whitelist(methods=["POST"])
def remove_project_assignee(project=None, user=None):
    """Remove `user` from `project`. Nirmaan Admin and Administrator only.

    Removing the assignment takes the user's access to the project away -- for a
    Project Manager, its PRs, POs and the rest -- until someone assigns them again.

    ADMIN ONLY, ENFORCED HERE. Assigning is open to Admin / PMO / Project Lead; removing
    is deliberately narrower (owner, 2026-09-11). A browser-side delete would lean on
    Frappe's doctype permissions and make "admin only" nothing more than a hidden button.

    TWO TABLES, BOTH CLEARED:
      - `User Permission` rows go through `frappe.delete_doc`, so the controller's
        `on_trash` runs: it deletes the `Nirmaan User Permissions` mirror row and keeps
        `Nirmaan Users.has_project` right. A raw delete would skip both.
      - Any mirror row still left afterwards is deleted directly. The mirror is what the
        Assignees card reads, and it has drifted: measured 2026-09-11, 285 of 570 mirror
        rows had no `User Permission` behind them (281 for users deleted since, 4 for live
        ones). Without this step a name the card shows could not be removed. The raw
        delete is safe -- the mirror doctype has no doc_events and a bare controller --
        and the one field it feeds, `has_project`, is recomputed straight after.
    Every matching row goes, duplicates included: one left behind would keep the access
    (or the card entry) the admin just removed.
    """
    if not project:
        frappe.throw("project is required.", title="Missing field: project")
    if not user:
        frappe.throw("user is required.", title="Missing field: user")
    if not is_nirmaan_admin(frappe.session.user):
        frappe.throw(
            "Only an Admin can remove a user from a project.",
            frappe.PermissionError,
        )

    match = {"user": user, "allow": "Projects", "for_value": project}

    permissions = frappe.get_all("User Permission", filters=match, pluck="name")
    for name in permissions:
        frappe.delete_doc("User Permission", name, ignore_permissions=True)

    leftover_mirrors = frappe.db.count("Nirmaan User Permissions", match)
    if leftover_mirrors:
        frappe.db.delete("Nirmaan User Permissions", match)
        sync_has_project(user)

    if not permissions and not leftover_mirrors:
        frappe.throw(f"{user} is not assigned to {project}.", title="Not assigned")

    frappe.db.commit()
    return {"project": project, "user": user}
