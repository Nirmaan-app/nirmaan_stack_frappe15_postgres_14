import frappe
from frappe.model.document import Document

@frappe.whitelist()
def rename_zone_and_cascade(project_name: str, zone_doc_name: str, old_zone_name: str, new_zone_name: str):
    """
    Renames a Project Zone in the Project document and cascades the change
    to all associated Project Progress Report entries for that project.

    :param project_name: The name (ID) of the Project document.
    :param zone_doc_name: The name (ID) of the specific Project Zone child document row.
    :param old_zone_name: The old zone name (for verification and filtering reports).
    :param new_zone_name: The new zone name.
    """
    
    if not all([project_name, zone_doc_name, old_zone_name, new_zone_name]):
        frappe.throw("Missing required parameters for zone rename.")

    try:
        # 1. Update the Project Document's Child Table Entry
        project = frappe.get_doc("Projects", project_name, for_update=True)
        zone_updated = False
        
        for zone_row in project.project_zones:
            # Check for the unique child document name (the primary key of the row)
            if zone_row.name == zone_doc_name:
                zone_row.zone_name = new_zone_name
                zone_updated = True
                break
        
        if not zone_updated:
            frappe.throw(f"Project Zone with ID '{zone_doc_name}' not found in Project '{project_name}'.")

        # Save the Project document. This updates the zone name in the master doc.
        # Use ignore_permissions=True if the user lacks write permission on child table field directly
        project.save(ignore_permissions=False, ignore_mandatory=True)
        frappe.db.commit()

        # 2. Cascade the update to all Project Progress Reports
        
        # Query for all Project Progress Reports linked to this Project and using the old zone name
        report_names = frappe.get_list(
            "Project Progress Report",
            filters={
                "project_id": project_name,
                "report_zone": old_zone_name
            },
            fields=["name"]
        )

        reports_updated_count = 0
        for report in report_names:
            try:
                report_doc = frappe.get_doc("Project Progress Report", report.name, for_update=True)
                
                # Update the field, explicitly setting modified=False to prevent unnecessary modification stamp changes
                report_doc.report_zone = new_zone_name
                
                # Use frappe.db.set_value to update quickly and prevent triggering other hooks/validations 
                # that might occur on a full .save() if we only want a direct field update.
                # However, for robustness, we use update_modified=False to handle the specific requirement.
                
                # Manually setting the value and updating DB directly for modification control
                frappe.db.set_value(
                    "Project Progress Report", 
                    report.name, 
                    "report_zone", 
                    new_zone_name,
                    update_modified=False
                )
                
                reports_updated_count += 1
            except Exception as e:
                # Log and continue if a specific report fails
                frappe.log_error(f"Failed to update report {report.name} during zone cascade: {e}", "Zone Rename Cascade Error")


        frappe.db.commit() # Commit all report changes

        return {
            "status": "success",
            "message": f"Zone '{old_zone_name}' successfully renamed to '{new_zone_name}'. {reports_updated_count} reports updated.",
            "updated_reports": reports_updated_count
        }

    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(message=f"Critical error during zone rename/cascade: {e}", title="Zone Rename API Failure")
        frappe.throw(f"Zone Rename Failed: {e}")