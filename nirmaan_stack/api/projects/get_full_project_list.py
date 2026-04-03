# Path: nirmaan_stack/nirmaan_stack/api/project_progress.py

import frappe

@frappe.whitelist()
def get_active_projects_for_progress_report():
    try:
        from frappe.utils import nowdate
        today = nowdate()

        # Step 1: Get list of active projects with deactivation filtering in database
        # This handles:
        # 1. Not Cancelled
        # 2. Milestone tracking enabled
        # 3. NOT (disabled_dpr = 1 AND disabled_dpr_date <= today)
        projects = frappe.get_all(
            "Projects",
            filters=[
                ["status", "not in", ["Cancelled"]],
                ["enable_project_milestone_tracking", "=", 1],
                [
                    "OR",
                    [["disabled_dpr", "in", [0, None]]],
                    [
                        ["disabled_dpr", "=", 1],
                        ["disabled_dpr_date", ">", today]
                    ]
                ]
            ],
            fields=["name", "project_name", "status", "enable_project_milestone_tracking", "disabled_dpr", "disabled_dpr_date"]
        )

        # Step 2: For each project, fetch zones
        for project in projects:
            full_doc = frappe.get_doc("Projects", project["name"])
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
