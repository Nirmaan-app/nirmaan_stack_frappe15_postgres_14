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
def get_trackers_with_stats():
    """
    Fetches Project Design Trackers with aggregated task statistics.
    Returns:
        List of dicts: [
            {
                "name": "DT-2024-001",
                "project_name": "Project A",
                "creation": "...",
                "status": "In Progress",
                "total_tasks": 10,
                "status_counts": {"Todo": 5, "Done": 5},
                ...
            },
            ...
        ]
    """
    # 1. Fetch all parent trackers
    trackers = frappe.get_list(
        "Project Design Tracker",
         fields=["name"], # Only need name to get_doc
        order_by="creation desc"
    )

    if not trackers:
        return []

    # Role-based visibility check
    user = frappe.session.user
    role = _get_user_role_profile(user)
    should_filter_hidden = user != "Administrator" and role not in FULL_VISIBILITY_ROLES

    result = []

    # 2. Iterate and fetch full Element (Get Doc)
    for t in trackers:
        # Fetch the full document (includes child tables)
        doc = frappe.get_doc("Project Design Tracker", t.name)

        # Skip hidden trackers for non-privileged users
        if should_filter_hidden and doc.get("hide_design_tracker"):
            continue

        # Calculate stats
        total_tasks = 0
        completed_tasks = 0
        status_counts = defaultdict(int)
        
        # Access child table 'design_tracker_task' directly from doc
        for task in doc.design_tracker_task:
            status = task.task_status or "Unknown"
            
            # Skip 'Not Applicable' from metrics
            if status == "Not Applicable":
                continue

            total_tasks += 1
            status_counts[status] += 1
            
            # Count ONLY "Approved" as requested
            if status == "Approved":
                completed_tasks += 1
            
            # --- DATA CLEANING FIX ---
            # If assigned_designers is incorrectly a list object, stringify it
            if isinstance(task.get("assigned_designers"), list):
                task.assigned_designers = json.dumps(task.assigned_designers)
            
        # Serialize doc to dict
        doc_dict = doc.as_dict()
        doc_dict["total_tasks"] = total_tasks
        doc_dict["completed_tasks"] = completed_tasks
        doc_dict["status_counts"] = dict(status_counts)
        
        result.append(doc_dict)

    return result
