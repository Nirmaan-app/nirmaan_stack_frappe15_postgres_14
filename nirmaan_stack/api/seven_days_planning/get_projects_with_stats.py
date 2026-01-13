import frappe
from collections import defaultdict


# Roles that require project-level filtering based on user permissions
FILTERED_ACCESS_ROLES = {
    "Nirmaan Project Manager Profile",
    "Nirmaan Project Lead Profile",
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
def get_projects_with_work_plan_stats():
    """
    Fetches projects that have Project Milestone Tracking enabled with aggregated work plan statistics.

    For Project Manager and Project Lead roles:
        Returns only projects they have access to via Nirmaan User Permissions.

    For Admin and PMO Executive roles:
        Returns all projects with milestone tracking enabled.

    Returns:
        List of dicts: [
            {
                "project": "PROJ-0001",
                "project_name": "Project Alpha",
                "total_activities": 25,
                "status_counts": {
                    "Pending": 10,
                    "In Progress": 12,
                    "Completed": 3
                },
                "overall_progress": 65
            },
            ...
        ]
    """
    # Get current user and their role
    user = frappe.session.user
    role = _get_user_role(user)

    # Determine if we need to filter by user permissions
    project_filters = {"enable_project_milestone_tracking": 1}

    if _should_filter_by_permissions(user, role):
        allowed_projects = _get_allowed_projects(user)
        if not allowed_projects:
            # User has no project assignments, return empty list
            return []
        project_filters["name"] = ["in", allowed_projects]

    # Fetch projects with milestone tracking enabled
    projects = frappe.get_all(
        "Projects",
        filters=project_filters,
        fields=["name", "project_name"],
        order_by="project_name asc"
    )

    if not projects:
        return []

    result = []

    for project in projects:
        project_id = project.name
        project_name = project.project_name

        # Get all zones for this project
        project_doc = frappe.get_doc("Projects", project_id)
        zones = [z.zone_name for z in project_doc.project_zones] if project_doc.get("project_zones") else []

        if not zones:
            continue

        # Collect all work plans for this project
        total_activities = 0
        status_counts = defaultdict(int)
        progress_values = []

        for zone in zones:
            # Get Latest Completed Project Progress Report for this Zone
            reports = frappe.get_list(
                "Project Progress Reports",
                filters={
                    "project": project_id,
                    "report_zone": zone,
                    "report_status": "Completed"
                },
                fields=["name"],
                order_by="creation desc",
                limit=1
            )

            if not reports:
                continue

            report_name = reports[0].name

            # Get all work plans for this project/zone
            work_plans = frappe.get_all(
                "Work Plan",
                filters={
                    "project": project_id,
                    "wp_zone": zone,
                },
                fields=["name", "wp_status", "wp_progress"]
            )

            for wp in work_plans:
                total_activities += 1
                status = wp.wp_status or "Pending"
                status_counts[status] += 1

                # Track progress for averaging
                if wp.wp_progress:
                    try:
                        progress_values.append(float(wp.wp_progress))
                    except (ValueError, TypeError):
                        pass

        # Only include projects that have work plan activities
        if total_activities > 0:
            # Calculate overall progress
            overall_progress = 0
            if progress_values:
                overall_progress = round(sum(progress_values) / len(progress_values))

            result.append({
                "project": project_id,
                "project_name": project_name,
                "total_activities": total_activities,
                "status_counts": dict(status_counts),
                "overall_progress": overall_progress
            })

    # Sort by project name
    result.sort(key=lambda x: x["project_name"].lower())

    return result
