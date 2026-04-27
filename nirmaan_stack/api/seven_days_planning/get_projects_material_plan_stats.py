import frappe
import json
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


def _count_items_in_plan(mp_items) -> int:
    """Safely count items in a material plan's mp_items field."""
    if not mp_items:
        return 0
    
    try:
        if isinstance(mp_items, str):
            parsed = json.loads(mp_items)
        else:
            parsed = mp_items
        
        if isinstance(parsed, dict) and "list" in parsed:
            return len(parsed["list"])
        elif isinstance(parsed, list):
            return len(parsed)
        return 0
    except (json.JSONDecodeError, TypeError):
        return 0


def _is_delivered(plan) -> bool:
    """
    Check if a material plan is considered 'Delivered'.
    A plan is delivered if delivery_date is in the past or today.
    """
    if not plan.get("delivery_date"):
        return False
    
    try:
        delivery = plan.delivery_date
        if isinstance(delivery, str):
            delivery = frappe.utils.getdate(delivery)
        return delivery <= date.today()
    except:
        return False


@frappe.whitelist()
def get_projects_with_material_plan_stats():
    """
    Fetches projects that have Material Delivery Plans with aggregated statistics.

    Status Logic:
        - "Delivered": Plans with delivery_date <= today
        - "Not Delivered": Plans with delivery_date > today or no delivery_date

    Returns:
        List of dicts: [
            {
                "project": "PROJ-0001",
                "project_name": "Project Alpha",
                "total_plans": 25,
                "status_counts": {
                    "Delivered": 10,
                    "Not Delivered": 15
                },
                "overall_progress": 40,
                "total_pos": 15,
                "total_items": 50
            },
            ...
        ]
    """
    user = frappe.session.user
    role = _get_user_role(user)

    # 1. Fetch all Material Delivery Plans (with permission scoping for restricted roles).
    #    Only projects that already have at least one plan will appear in the response —
    #    the WIP / status filter on the frontend further narrows the list.
    plan_filters = {}
    if _should_filter_by_permissions(user, role):
        allowed_projects = _get_allowed_projects(user)
        if not allowed_projects:
            return []
        plan_filters["project"] = ["in", allowed_projects]

    plans = frappe.get_all(
        "Material Delivery Plan",
        filters=plan_filters,
        fields=["name", "project", "po_link", "po_type", "mp_items", "delivery_date",
                "critical_po_category", "critical_po_task"]
    )
    if not plans:
        return []

    # 2. Group plan stats by project.
    projects_data = defaultdict(lambda: {
        "total_plans": 0,
        "delivered": 0,
        "not_delivered": 0,
        "po_set": set(),
        "total_items": 0,
    })

    for plan in plans:
        project_id = plan.project
        if not project_id:
            continue

        proj = projects_data[project_id]
        proj["total_plans"] += 1

        if plan.po_link:
            proj["po_set"].add(plan.po_link)

        proj["total_items"] += _count_items_in_plan(plan.mp_items)

        if _is_delivered(plan):
            proj["delivered"] += 1
        else:
            proj["not_delivered"] += 1

    if not projects_data:
        return []

    # 3. Fetch project name + lifecycle status for the projects that have plans.
    project_ids = list(projects_data.keys())
    project_docs = frappe.get_all(
        "Projects",
        filters={"name": ["in", project_ids]},
        fields=["name", "project_name", "status"]
    )
    project_meta_map = {
        p.name: {"project_name": p.project_name, "status": p.status or ""}
        for p in project_docs
    }

    # 4. Build result.
    result = []
    for project_id, data in projects_data.items():
        meta = project_meta_map.get(project_id, {})
        total_plans = data["total_plans"]
        delivered = data["delivered"]
        not_delivered = data["not_delivered"]
        overall_progress = round((delivered / total_plans * 100)) if total_plans > 0 else 0

        result.append({
            "project": project_id,
            "project_name": meta.get("project_name", project_id),
            "status_of_project": meta.get("status", ""),
            "total_plans": total_plans,
            "status_counts": {
                "Delivered": delivered,
                "Not Delivered": not_delivered,
            },
            "overall_progress": overall_progress,
            "total_pos": len(data["po_set"]),
            "total_items": data["total_items"],
        })

    result.sort(key=lambda x: x["project_name"].lower())
    return result
