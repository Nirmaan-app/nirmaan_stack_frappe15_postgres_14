import frappe
from collections import defaultdict
from datetime import date


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


def _is_done(plan) -> bool:
    """
    Check if a cashflow plan is considered 'Done'.
    A plan is done if planned_date is in the past or today.
    """
    planned_date = plan.get("planned_date")
    if not planned_date:
        return False
    
    try:
        if isinstance(planned_date, str):
            planned_date = frappe.utils.getdate(planned_date)
        return planned_date <= date.today()
    except:
        return False


@frappe.whitelist()
def get_projects_with_cashflow_plan_stats():
    """
    Fetches projects that have Cashflow Plans with aggregated statistics.
    Source: "Cashflow Plan" DocType

    Aggregation Logic (based on 'type' field):
        - PO Cashflow: type includes "PO" (e.g., "Existing PO", "New PO")
        - WO Cashflow: type includes "WO" (e.g., "Existing WO", "New WO")
        - Inflow Cashflow: type includes "Inflow"
        - Misc Cashflow: type includes "Misc" or "Miscellaneous"

    Status Logic:
        - "Done": Plans with planned_date <= today
        - "Pending": Plans with planned_date > today or no planned_date

    Returns:
        List of dicts: [
            {
                "project": "PROJ-0001",
                "project_name": "Project Alpha",
                "po_cashflow": { "done": 4, "total": 8 },
                "wo_cashflow": { "done": 2, "total": 5 },
                "inflow_cashflow": { "done": 1, "total": 3 },
                "misc_cashflow": { "done": 0, "total": 2 },
                "overall_progress": 45
            },
            ...
        ]
    """
    user = frappe.session.user
    role = _get_user_role(user)

    plan_filters = {}

    if _should_filter_by_permissions(user, role):
        allowed_projects = _get_allowed_projects(user)
        if not allowed_projects:
            return []
        plan_filters["project"] = ["in", allowed_projects]

    # Initialize projects data structure
    projects_data = defaultdict(lambda: {
        "po_cashflow": {"done": 0, "total": 0},
        "wo_cashflow": {"done": 0, "total": 0},
        "inflow_cashflow": {"done": 0, "total": 0},
        "misc_cashflow": {"done": 0, "total": 0},
    })

    # Fetch Data from single "Cashflow Plan" DocType
    all_plans = frappe.get_all(
        "Cashflow Plan",
        filters=plan_filters,
        fields=["name", "project", "planned_date", "type"]
    )
    
    if not all_plans:
        return []

    for plan in all_plans:
        project_id = plan.project
        if not project_id:
            continue
            
        plan_type = (plan.type or "").strip()
        is_plan_done = _is_done(plan)
        
        # Categorize based on type string
        if "PO" in plan_type:
             target_category = "po_cashflow"
        elif "WO" in plan_type:
             target_category = "wo_cashflow"
        elif "Inflow" in plan_type:
             target_category = "inflow_cashflow"
        elif "Misc" in plan_type or "Miscellaneous" in plan_type:
             target_category = "misc_cashflow"
        else:
            # Fallback for unknown types - maybe skip or count as Misc?
            # User instructions implies specific mappings, so skipping unknown/unmapped might be safer
            # or map to Misc if broadly interpreted. Let's skip for accuracy unless it matches known patterns.
            continue 

        projects_data[project_id][target_category]["total"] += 1
        if is_plan_done:
            projects_data[project_id][target_category]["done"] += 1

    if not projects_data:
        return []

    # Fetch project names
    project_ids = list(projects_data.keys())
    project_docs = frappe.get_all(
        "Projects",
        filters={"name": ["in", project_ids]},
        fields=["name", "project_name"]
    )
    project_name_map = {p.name: p.project_name for p in project_docs}

    # Build result
    result = []

    for project_id, data in projects_data.items():
        project_name = project_name_map.get(project_id, project_id)
        
        # Calculate overall progress
        total_done = (
            data["po_cashflow"]["done"] +
            data["wo_cashflow"]["done"] +
            data["inflow_cashflow"]["done"] +
            data["misc_cashflow"]["done"]
        )
        total_plans = (
            data["po_cashflow"]["total"] +
            data["wo_cashflow"]["total"] +
            data["inflow_cashflow"]["total"] +
            data["misc_cashflow"]["total"]
        )
        
        overall_progress = round((total_done / total_plans * 100)) if total_plans > 0 else 0
        
        result.append({
            "project": project_id,
            "project_name": project_name,
            "po_cashflow": data["po_cashflow"],
            "wo_cashflow": data["wo_cashflow"],
            "inflow_cashflow": data["inflow_cashflow"],
            "misc_cashflow": data["misc_cashflow"],
            "overall_progress": overall_progress
        })

    # Sort by project name
    result.sort(key=lambda x: x["project_name"].lower())

    return result
