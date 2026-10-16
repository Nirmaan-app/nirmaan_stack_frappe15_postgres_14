"""PR Tracker: which procurement packages each project's PRs carry.

Computed LIVE from the PRs' package rows (`Procurement Requests.pr_tag_list`, written from the
items by `integrations/controllers/procurement_request_packages.py`), grouped in the database.
Nothing is stored, so the tracker cannot drift from the PRs: a deleted PR, a PR whose items
change, or two PRs saved at the same moment are all reflected on the next read.

The older `Critical PR Tags` records (one per project + header) are no longer read or written.
They were a stored copy kept in step by PR hooks; under PostgreSQL's REPEATABLE READ two saves
at once could not both update one record, and deleted PRs were never removed from it.
"""

from collections import defaultdict

import frappe
from frappe.utils import create_batch

from nirmaan_stack.services.role_profiles import MATERIAL_PROCUREMENT_PROFILES

# Roles that require project-level filtering based on user permissions
FILTERED_ACCESS_ROLES = {
    "Nirmaan Project Manager Profile",
    "Nirmaan Project Lead Profile",
    *MATERIAL_PROCUREMENT_PROFILES,
}

# Roles with full access to all projects
FULL_ACCESS_ROLES = {
    "Nirmaan Admin Profile",
    "Nirmaan PMO Executive Profile",
}


def _get_user_role(user: str) -> str:
    """Get the role profile for a user from Nirmaan Users."""
    if user == "Administrator":
        return "Administrator"

    role = frappe.db.get_value("Nirmaan Users", user, "role_profile")
    return role or ""


def _get_allowed_projects(user: str) -> list[str]:
    """
    Get list of projects the user has access to via Nirmaan User Permissions.
    """
    return frappe.get_all(
        "Nirmaan User Permissions",
        filters={"user": user, "allow": "Projects"},
        pluck="for_value",
    )


def _should_filter_by_permissions(user: str, role: str) -> bool:
    """
    Determine if the user should see filtered projects based on role.
    """
    if user == "Administrator" or role in FULL_ACCESS_ROLES:
        return False

    if role in FILTERED_ACCESS_ROLES:
        return True

    return False


def _visible_projects() -> list[str] | None:
    """The projects the session user may see here: None means every project."""
    user = frappe.session.user
    if _should_filter_by_permissions(user, _get_user_role(user)):
        return _get_allowed_projects(user)
    return None


# A PR with no project has no tracker card and is skipped, as the old tracker did (an empty project
# would also break sorting the projects).
_PACKAGE_PRS_SQL = """
    SELECT pr.project,
           tag.tag_package AS package,
           STRING_AGG(DISTINCT pr.name, ',' ORDER BY pr.name) AS prs
    FROM `tabProcurement Requests` pr
    JOIN `tabPR Tag Child Table` tag
      ON tag.parent = pr.name
     AND tag.parenttype = 'Procurement Requests'
     AND tag.parentfield = 'pr_tag_list'
    WHERE COALESCE(tag.tag_package, '') <> ''
      AND COALESCE(pr.project, '') <> ''
      AND pr.docstatus < 2
      {project_filter}
    GROUP BY pr.project, tag.tag_package
"""


def _package_prs(projects: list[str] | None) -> list[dict]:
    """[{project, package, prs: [pr names, sorted]}] for `projects` (None = all)."""
    rows = []
    if projects is None:
        rows = frappe.db.sql(_PACKAGE_PRS_SQL.format(project_filter=""), as_dict=True)
    else:
        # Chunked: an IN list of every project would overrun sqlparse's 10k-token cap.
        for chunk in create_batch(sorted(set(projects)), 500):
            rows += frappe.db.sql(
                _PACKAGE_PRS_SQL.format(project_filter="AND pr.project IN %(projects)s"),
                {"projects": tuple(chunk)},
                as_dict=True,
            )
    return [
        {"project": row.project, "package": row.package, "prs": row.prs.split(",") if row.prs else []}
        for row in rows
    ]


def _enabled_packages(project_ids: list[str]) -> dict[str, set[str]]:
    enabled = defaultdict(set)
    # Chunk the IN list so the generated query never exceeds the sqlparse 10k-token
    # cap (prod: Frappe validate_generated_query + sqlparse 0.5.5).
    for chunk in create_batch(project_ids, 500):
        for entry in frappe.get_all(
            "Project Work Package Category Make",
            filters={"parent": ["in", list(chunk)], "parenttype": "Projects"},
            fields=["parent", "procurement_package"],
        ):
            if entry.procurement_package:
                enabled[entry.parent].add(entry.procurement_package)
    return enabled


@frappe.whitelist()
def get_projects_with_critical_pr_stats():
    """Every visible project that has at least one PR with a package, with its package stats."""
    visible = _visible_projects()
    if visible is not None and not visible:
        return []

    package_rows = _package_prs(visible)
    if not package_rows:
        return []

    by_project = defaultdict(list)
    for row in package_rows:
        by_project[row["project"]].append(row)

    project_ids = sorted(by_project)
    enabled = _enabled_packages(project_ids)
    project_info = {}
    for chunk in create_batch(project_ids, 500):
        for p in frappe.get_all(
            "Projects",
            filters={"name": ["in", list(chunk)]},
            fields=["name", "project_name", "status"],
        ):
            project_info[p.name] = p

    result = []
    for project_id in project_ids:
        rows = by_project[project_id]
        used = {row["package"] for row in rows}
        all_prs = {pr for row in rows for pr in row["prs"]}
        info = project_info.get(project_id) or {}
        result.append({
            "project": project_id,
            "project_name": info.get("project_name") or "",
            "status_of_project": info.get("status") or "",
            "total_tags": len(rows),
            "released_tags": len(rows),
            "status_counts": {"Released": len(rows), "Not Released": 0},
            # A PR may carry a package the project has not enabled (its items' categories
            # decide), so the total counts those too and "used" can never exceed it.
            "total_enabled_packages": len(enabled.get(project_id, set()) | used),
            "used_packages_count": len(used),
            "total_prs": len(all_prs),
        })

    result.sort(key=lambda x: x["project_name"].lower() if x["project_name"] else "")
    return result


@frappe.whitelist()
def get_project_pr_packages(project: str):
    """The PR Tracker detail for one project: [{package, prs: [pr names]}], sorted by package."""
    if not project:
        return []
    visible = _visible_projects()
    if visible is not None and project not in visible:
        frappe.throw("You do not have access to this project.", frappe.PermissionError)
    rows = _package_prs([project])
    return sorted(
        ({"package": row["package"], "prs": row["prs"]} for row in rows),
        key=lambda row: row["package"],
    )
