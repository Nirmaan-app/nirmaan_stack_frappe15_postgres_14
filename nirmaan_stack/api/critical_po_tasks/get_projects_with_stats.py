import frappe
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

    Returns:
        True if user should only see their assigned projects
        False if user has full access to all projects
    """
    # Administrator and full-access roles see everything
    if user == "Administrator" or role in FULL_ACCESS_ROLES:
        return False

    # These roles see only their assigned projects
    if role in FILTERED_ACCESS_ROLES:
        return True

    # Default: show all (for any other roles not explicitly defined)
    return False


@frappe.whitelist()
def get_projects_with_critical_po_stats():
    """
    Fetches projects that have Critical PO Tasks with aggregated statistics.

    For Project Manager, Project Lead, and Procurement Executive roles:
        Returns only projects they have access to via Nirmaan User Permissions.

    For Admin, PMO Executive, and other roles:
        Returns all projects with Critical PO Tasks.

    Returns:
        List of dicts: [
            {
                "project": "PROJ-0001",
                "project_name": "Project Alpha",
                "total_tasks": 10,
                "released_tasks": 5,
                "status_counts": {
                    "Not Released": 3,
                    "Partially Released": 2,
                    "Released": 5
                }
            },
            ...
        ]
    """
    # Get current user and their role
    user = frappe.session.user
    role = _get_user_role(user)

    # Determine if we need to filter by user permissions
    filters = []
    if _should_filter_by_permissions(user, role):
        allowed_projects = _get_allowed_projects(user)
        if not allowed_projects:
            # User has no project assignments, return empty list
            return []
        filters = [["project", "in", allowed_projects]]

    # Fetch Critical PO Tasks (with optional project filter)
    tasks = frappe.get_all(
        "Critical PO Tasks",
        fields=[
            "name",
            "project",
            "project_name",
            "status"
        ],
        filters=filters,
        order_by="project asc"
    )

    if not tasks:
        return []

    # Group tasks by project and aggregate stats
    project_stats = defaultdict(lambda: {
        "project": "",
        "project_name": "",
        "total_tasks": 0,
        "released_tasks": 0,
        "status_counts": defaultdict(int)
    })

    for task in tasks:
        project_id = task.get("project")
        if not project_id:
            continue

        stats = project_stats[project_id]
        stats["project"] = project_id
        stats["project_name"] = task.get("project_name", "")

        status = task.get("status", "Unknown")

        # Skip "Not Applicable" from metrics
        if status == "Not Applicable":
            continue

        stats["total_tasks"] += 1
        stats["status_counts"][status] += 1

        # Count "Released" status
        if status == "Released":
            stats["released_tasks"] += 1

    # Convert to list and clean up status_counts
    result = []
    for project_id, stats in project_stats.items():
        # Only include projects that have tasks (after excluding "Not Applicable")
        if stats["total_tasks"] > 0:
            result.append({
                "project": stats["project"],
                "project_name": stats["project_name"],
                "total_tasks": stats["total_tasks"],
                "released_tasks": stats["released_tasks"],
                "status_counts": dict(stats["status_counts"])
            })

    # Sort by project name
    result.sort(key=lambda x: x["project_name"].lower())

    return result
