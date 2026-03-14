import frappe
import json
from collections import defaultdict


# Roles that require project-level filtering based on user permissions
FILTERED_ACCESS_ROLES = {
    "Nirmaan Project Manager Profile",
    "Nirmaan Project Lead Profile",
    "Nirmaan Procurement Executive Profile",
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


@frappe.whitelist()
def get_projects_with_critical_pr_stats():
    """
    Fetches projects that have Critical PR Tags with aggregated statistics.
    """
    user = frappe.session.user
    role = _get_user_role(user)

    filters = []
    if _should_filter_by_permissions(user, role):
        allowed_projects = _get_allowed_projects(user)
        if not allowed_projects:
            return []
        filters = [["project", "in", allowed_projects]]

    # Fetch Critical PR Tags
    tags = frappe.get_all(
        "Critical PR Tags",
        fields=[
            "name",
            "project",
            "projectname",
            "associated_prs"
        ],
        filters=filters,
        order_by="project asc"
    )

    if not tags:
        return []

    project_data = {}

    for tag in tags:
        p_id = tag.get("project")
        if not p_id:
            continue

        if p_id not in project_data:
            project_data[p_id] = {
                "project": p_id,
                "project_name": tag.get("projectname", ""),
                "total_tags": 0,
                "released_tags": 0,
                "released_count": 0,
                "not_released_count": 0
            }
        
        # Determine release status based on associated_prs
        prs_raw = tag.get("associated_prs")
        is_rel = False
        if prs_raw:
            try:
                data = prs_raw
                if isinstance(prs_raw, str):
                    data = json.loads(prs_raw)
                
                if isinstance(data, dict) and data.get("prs"):
                    is_rel = True
            except Exception:
                pass
        
        project_data[p_id]["total_tags"] += 1
        if is_rel:
            project_data[p_id]["released_tags"] += 1
            project_data[p_id]["released_count"] += 1
        else:
            project_data[p_id]["not_released_count"] += 1

    result = []
    for p_id in sorted(project_data.keys()):
        data = project_data[p_id]
        if data["total_tags"] > 0:
            result.append({
                "project": data["project"],
                "project_name": data["project_name"],
                "total_tags": data["total_tags"],
                "released_tags": data["released_tags"],
                "status_counts": {
                    "Released": data["released_count"],
                    "Not Released": data["not_released_count"]
                }
            })

    # Final sort by project name
    result.sort(key=lambda x: x["project_name"].lower() if x["project_name"] else "")

    return result
