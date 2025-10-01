# your_app/your_app/api.py
import frappe

@frappe.whitelist(allow_guest=False)
def get_project_progress_report_state(project_id, report_date):
    """
    Fetches the project progress report state for a given project and date.
    - If an exact report for the date exists, returns it in 'edit' mode.
    - If no exact report, but previous reports for the project exist,
      returns the most recent report's data in 'create' mode (for pre-filling).
    - If no reports exist for the project, returns default empty data in 'create' mode.
    - Includes robust error handling and ensures all returned fields have sensible non-null defaults.
    """
    if not project_id or not report_date:
        frappe.throw("Project ID and Report Date are required.")

    try:
        # 1. Try to find an exact report for the given date
        exact_report_names = frappe.get_list(
            "Project Progress Reports", # <<< Your main DocType name here
            filters={
                "project": project_id,
                "report_date": report_date
            },
            fields=["name"],
            limit=1
        )

        if exact_report_names:
            report_doc_name = exact_report_names[0]['name']
            report_doc = frappe.get_doc("Project Progress Reports", report_doc_name)
            
            manpower_data = []
            # Ensure report_doc.manpower is iterable (could be None if no entries)
            if report_doc.manpower:
                for entry in report_doc.manpower:
                    manpower_data.append({
                        "label": entry.label or "",  # Ensure label is string, not None
                        "count": entry.count or 0    # Ensure count is number, not None
                    })

            milestones_data = []
            # Ensure report_doc.milestones is iterable (could be None if no entries)
            if report_doc.milestones:
                for entry in report_doc.milestones:
                    milestones_data.append({
                        "name": entry.name or "",
                        "work_milestone_name": entry.work_milestone_name or "",
                        "work_header": entry.work_header or "",
                        "status": entry.status or "Not Started", # Default status if None
                        "progress": entry.progress or 0,         # Default progress if None
                        "expected_start_date": entry.expected_start_date or "",
                        "expected_completion_date": entry.expected_completion_date or "",
                        "remarks": entry.remarks or ""
                    })

            return {
                "name": report_doc.name,
                "project": report_doc.project,
                "report_date": report_doc.report_date,
                "manpower_remarks": report_doc.manpower_remarks or "", # Ensure remarks is string
                "manpower": manpower_data,
                "milestones": milestones_data,
                "_mode": "edit"
            }

        # 2. If no exact report, try to find the most recent report for the project
        recent_report_names = frappe.get_list(
            "Project Progress Reports", # <<< Your main DocType name here
            filters={
                "project": project_id
            },
            fields=["name"],
            order_by="report_date desc",
            limit=1
        )

        if recent_report_names:
            report_doc_name = recent_report_names[0]['name']
            report_doc = frappe.get_doc("Project Progress Reports", report_doc_name)

            manpower_data = []
            if report_doc.manpower:
                for entry in report_doc.manpower:
                    manpower_data.append({
                        "label": entry.label or "",
                        "count": entry.count or 0
                    })

            milestones_data = []
            if report_doc.milestones:
                for entry in report_doc.milestones:
                    milestones_data.append({
                        "name": entry.name or "",
                        "work_milestone_name": entry.work_milestone_name or "",
                        "work_header": entry.work_header or "",
                        "status": entry.status or "Not Started",
                        "progress": entry.progress or 0,
                        "expected_start_date": entry.expected_start_date or "",
                        "expected_completion_date": entry.expected_completion_date or "",
                        "remarks": entry.remarks or ""
                    })

            return {
                "project": project_id,
                "report_date": report_date,
                "manpower_remarks": report_doc.manpower_remarks or "", # Ensure remarks is string
                "manpower": manpower_data,
                "milestones": milestones_data,
                "_mode": "create" # Indicate that this will be a new creation (pre-filled)
            }

        # 3. If no reports at all for this project, return a minimal structure for 'create' mode
        # The frontend will handle populating default manpower and milestones from its own static data.
        return {
            "project": project_id,
            "report_date": report_date,
            "manpower_remarks": "", # Explicitly empty string
            "manpower": [], # Explicitly empty list
            "milestones": [], # Explicitly empty list
            "_mode": "create" # Indicate a brand new creation
        }

    except Exception as e:
        error_message = f"Failed to retrieve project progress report state for project {project_id}, date {report_date}: {e}"
        frappe.log_error(message=error_message, title="get_project_progress_report_state_error")
        
        frappe.clear_messages()
        frappe.response["http_status_code"] = 500
        return {
            "project": project_id,
            "report_date": report_date,
            "manpower_remarks": "",
            "manpower": [],
            "milestones": [],
            "_mode": "error",
            "error_message": "An unexpected error occurred on the server. Please try again or contact support."
        }