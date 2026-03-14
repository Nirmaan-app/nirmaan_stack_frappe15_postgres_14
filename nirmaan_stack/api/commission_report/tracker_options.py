import frappe
from collections import defaultdict

@frappe.whitelist()
def get_all_master_data():
    """
    Fetches all required master data (Projects, Users, Categories/Tasks).
    """
    tracked_projects = frappe.get_list(
        "Project Commission Report",
        fields=["project","project_name"],
        as_list=True 
    )
    # Flatten the list of IDs: ['PROJ-001', 'PROJ-002', ...]
    tracked_project_names = [p[0] for p in tracked_projects]

    # 1b. Define main Project filters
    project_filters = [
        # Exclude projects that already have a tracker
        ["name", "not in", tracked_project_names or []], 
        # For Commission Report, we ONLY show projects in 'Handover' (per user requirement)
        ["status", "=", "Handover"], 
    ]

    # Fetch eligible projects
    projects = frappe.get_list(
        "Projects", 
        fields=["name", "project_name", "project_start_date"], 
        filters=project_filters,
        limit=0, 
        as_list=False
    )
    
    # 2. Fetch Users
    allowed_profiles = [
        "Nirmaan Design Executive Profile","Nirmaan Design Lead Profile"
    ] # Need to verify if these roles change for commission

    users = frappe.get_list(
        "Nirmaan Users", 
        fields=["name", "full_name", "email", "role_profile"], 
        filters={"role_profile": ["in", allowed_profiles]}, 
        limit=0, 
        as_list=False
    )
    
    # 3. Fetch Commission Categories and Tasks
    categories = frappe.get_list(
        "Commission Report Category",
        fields=["name", "category_name"],
        order_by="category_name asc",
        as_list=False
    )
    
    all_tasks = frappe.get_list(
        "Commission Report Tasks",
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
        
    return {
        "facetProjects":tracked_projects,
        "projects": projects,
        "users": users,
        "categories": categories,
    }
