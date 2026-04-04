# Path: nirmaan_stack/nirmaan_stack/api/project_progress.py

import frappe

@frappe.whitelist()
def get_active_projects_for_progress_report():
    try:
        from frappe.utils import nowdate
        today = nowdate()

        # Step 1: Get list of potentially active projects
        # We only apply basic status and configuration filters at the database level
        projects = frappe.get_all(
            "Projects",
            filters={
                "status": ["not in", ["Completed", "Cancelled"]],
                "enable_project_milestone_tracking": 1
            },
            fields=["name", "project_name", "status", "enable_project_milestone_tracking", "disabled_dpr", "disabled_dpr_date"]
        )

        # Step 2: Post-filter in Python for robust deactivation logic
        # Logic: Exclude only if (DPR is marked disabled AND the deactivation date has been reached)
        active_projects = []
        for p in projects:
            is_disabled = p.get("disabled_dpr") == 1
            deactive_date = p.get("disabled_dpr_date")
            
            # If deactivation is explicitly scheduled and the date has passed or is today, exclude it
            if is_disabled and deactive_date and str(deactive_date) <= str(today):
                continue
                
            # Populate additional project details (e.g., zones) from the full document
            try:
                full_doc = frappe.get_doc("Projects", p["name"])
                p["project_zones"] = full_doc.get("project_zones") or []
                active_projects.append(p)
            except frappe.DoesNotExistError:
                # Handle edge cases where a project might have been deleted mid-process
                continue
            
        return {
            "success": True,
            "data": active_projects,
            "count": len(active_projects)
        }

    except Exception:
        frappe.db.rollback()
        frappe.log_error(frappe.get_traceback(), "Get Active Projects for Progress Report Failed")
        return {
            "success": False,
            "error": "Failed to fetch active projects",
            "data": []
        }