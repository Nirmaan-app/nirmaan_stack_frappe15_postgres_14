# frappe_app/design_tracker/master_api.py

import frappe
from collections import defaultdict

@frappe.whitelist()
def get_all_master_data():
    """
    Fetches all required master data (Projects, Users, Categories/Tasks).
    Design Phases have been removed from this function's scope.
    """
    tracked_projects = frappe.get_list(
        "Project Design Tracker",
        fields=["project","project_name"],
        as_list=True # Fetch as a list of lists/tuples for easier exclusion
    )
    # Flatten the list of IDs: ['PROJ-001', 'PROJ-002', ...]
    tracked_project_names = [p[0] for p in tracked_projects]

    # 1b. Define main Project filters
    project_filters = [
        # Exclude projects that already have a tracker
        ["name", "not in", tracked_project_names or []], 
        # Exclude projects whose status is Halted or Completed (assuming standard ERPNext Project status fields)
        ["status", "not in", ["Halted", "Completed", "On Hold"]], 
    ]

    # Fetch eligible projects
    projects = frappe.get_list(
        "Projects", 
        fields=["name", "project_name", "project_start_date"], 
        filters=project_filters,
        limit=0, 
        as_list=False
    )
    # # 1. Fetch Projects
    # projects = frappe.get_list(
    #     "Projects", 
    #     fields=["name", "project_name"], 
    #     limit=0, 
    #     as_list=False
    # )
    
    # 2. Fetch Users
    allowed_profiles = [
        "Nirmaan Design Executive Profile","Nirmaan Design Lead Profile"
    ]

    users = frappe.get_list(
        "Nirmaan Users", 
        fields=["name", "full_name", "email", "role_profile"], 
        filters={"role_profile": ["in", allowed_profiles]}, # Filter by list of profiles
        limit=0, 
        as_list=False
    )
    
    # 3. Fetch Design Categories and Tasks (Grouping logic remains)
    categories = frappe.get_list(
        "Design Tracker Category",
        fields=["name", "category_name"],
        order_by="category_name asc",
        as_list=False
    )
    
    all_tasks = frappe.get_list(
        "Design Tracker Tasks",
        fields=["task_name", "category_link","deadline_offset"], 
        order_by="task_name asc",
        as_list=False
    )
    
    tasks_by_category = defaultdict(list)
    for task in all_tasks:
        tasks_by_category[task.category_link].append({
            "task_name": task.task_name,
            "deadline_offset":task.deadline_offset
        })
        
    for category in categories:
        category['tasks'] = tasks_by_category[category.name]
        
    
    # --- Return the consolidated dictionary (Phases are omitted) ---
    return {
        "facetProjects":tracked_projects,
        "projects": projects,
        "users": users,
        "categories": categories,
        # Phases key is intentionally omitted
    }