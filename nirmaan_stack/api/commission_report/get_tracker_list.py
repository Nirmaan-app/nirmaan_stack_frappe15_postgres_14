import frappe
from collections import defaultdict
import json

# Roles that can see hidden trackers
FULL_VISIBILITY_ROLES = {
    "Nirmaan Admin Profile",
    "Nirmaan PMO Executive Profile",
    "Nirmaan Design Lead Profile",
}

def _get_user_role_profile(user: str) -> str:
    """Get user's role profile."""
    if user == "Administrator":
        return "Nirmaan Admin Profile"
    return frappe.db.get_value("Nirmaan Users", user.strip().lower(), "role_profile") or ""

@frappe.whitelist()
def get_tracker_list():
    """
    Fetches Project Commission Reports with aggregated task statistics.
    """
    # 1. Fetch all projects with "Handover" status
    projects = frappe.get_list(
        "Projects",
        # filters={"status": "Handover"},
        fields=["name", "project_name"],
        order_by="creation desc"
    )

    if not projects:
        return []

    user = frappe.session.user
    role = _get_user_role_profile(user)
    should_filter_hidden = user != "Administrator" and role not in FULL_VISIBILITY_ROLES

    result = []

    for proj in projects:
        # Construct a base dictionary for the project
        proj_dict = {
            "name": proj.name, # Using project ID for navigation fallback if no tracker exists
            "project": proj.name,
            "project_name": proj.project_name,
            "total_tasks": 0,
            "completed_tasks": 0,
            "status_counts": {},
            "has_tracker": False
        }
        total_tasks = 0
        completed_tasks = 0
        status_counts = defaultdict(int)

        # Check if a Project Commission Report exists for this project
        tracker_name = frappe.db.get_value("Project Commission Report", {"project": proj.name}, "name")

        if tracker_name:
            doc = frappe.get_doc("Project Commission Report", tracker_name)

            if should_filter_hidden and doc.get("hide_commission_report"):
                continue

            proj_dict["has_tracker"] = True
            proj_dict["name"] = doc.name # Override with tracker name for routing
            proj_dict.update(doc.as_dict())

            for task in doc.commission_report_task:
                status = task.task_status or "Unknown"
                
                if status == "Not Applicable":
                    continue

                total_tasks += 1
                status_counts[status] += 1
                
                if status == "Completed":
                    completed_tasks += 1
                
                if isinstance(task.get("assigned_designers"), list):
                    task.assigned_designers = json.dumps(task.assigned_designers)

        proj_dict["total_tasks"] = total_tasks
        proj_dict["completed_tasks"] = completed_tasks
        proj_dict["status_counts"] = dict(status_counts)

        result.append(proj_dict)

    return result
