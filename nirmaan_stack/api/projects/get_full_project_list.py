# Path: nirmaan_stack/nirmaan_stack/api/project_progress.py

import frappe

@frappe.whitelist()
def get_active_projects_for_progress_report():
    try:
        # Step 1: Get list of active projects (basic fields only)
        projects = frappe.get_all(
            "Projects",
            filters={
                "status": ["not in", ["Completed", "Cancelled"]],
                "enable_project_milestone_tracking": 1
            }
        )

        # Step 2: For each project, load full doc using get_doc()
        for project in projects:
            full_doc = frappe.get_doc("Projects", project["name"])

            # Child table automatically available
            project["project_name"] = full_doc.project_name
            project["status"] = full_doc.status
            project["enable_project_milestone_tracking"] = full_doc.enable_project_milestone_tracking
            project["project_zones"] = full_doc.get("project_zones") or []
            

        return {
            "success": True,
            "data": projects,
            "count": len(projects)
        }

    except Exception:
        frappe.db.rollback()
        frappe.log_error(frappe.get_traceback(), "Get Active Projects for Progress Report Failed")
        return {
            "success": False,
            "error": "Failed to fetch active projects",
            "data": []
        }
