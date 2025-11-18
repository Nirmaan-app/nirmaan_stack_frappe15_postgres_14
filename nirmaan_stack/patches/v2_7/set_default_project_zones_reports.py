import frappe

def execute():
    """
    Main execution function for the patch.
    Adds default zones to projects and updates existing progress reports.
    Ensures rollback on critical errr and collects skipped document names.
    """
    try:
        print("Starting Patch Execution: Project Zone Initialization and Report Update.")
        
        # Part 1: Add Default Zones to Projects
        project_stats = add_default_zones_to_projects()
        print(f"Project Zone Update Complete: {project_stats['total_fetched']} fetched, {project_stats['updated']} projects updated, {project_stats['skipped_count']} skipped.")
        if project_stats['skipped_names']:
            print(f"Skipped Projects: {project_stats['skipped_names']}")
        
        # Part 2: Update Progress Reports Zone
        report_stats = update_progress_reports_zone()
        print(f"Report Zone Update Complete: {report_stats['total_fetched']} fetched, {report_stats['updated']} reports updated, {report_stats['skipped_count']} skipped.")
        if report_stats['skipped_names']:
            print(f"Skipped Reports: {report_stats['skipped_names']}")

        print("Patch completed successfully. Committing changes.")
        frappe.db.commit()

    except Exception as e:
        print(f"CRITICAL ERROR during patch execution: {e}")
        print("Rolling back database transaction.")
        frappe.db.rollback()
        # Re-raise the exception to mark the patch as failed in Frappe's patch log
        raise


def add_default_zones_to_projects():
    """Add a default 'Default' zone to Projects with no zones."""
    print("Executing: Add default 'Default' zone to Projects with no zones.")
    
    updated_count = 0
    skipped_count = 0
    skipped_names = []

    projects = frappe.get_all(
        "Projects", fields=["name", "project_zones"],
        filters={"enable_project_milestone_tracking":["=",1]},
        order_by="modifield asc")

    total_fetched_count = len(projects) # <<< ADDED TOTAL FETCH COUNT

    for project in projects:
        try:
            doc = frappe.get_doc("Projects", project.name)

            # Check if doc.project_zones exists and has rows. 
            if not doc.project_zones or len(doc.project_zones) == 0:
                
                # CORRECT WAY to add a child row using the ORM
                doc.append("project_zones", {
                    "zone_name": "Default"
                })
                
                # Save the parent document. This is MANDATORY for child tables.
                # update_modified=False prevents modified date/user changes.
                doc.flags.ignore_version = True
                doc.save(ignore_permissions=True, update_modified=False)
                
                # print(f"Updated Project: {project.name} - Added 'Default' zone.")
                updated_count += 1
            else:
                skipped_count += 1
                skipped_names.append(project.name)

        except Exception as e:
            # Catch exceptions during processing/saving
            print(f"Error processing Project {project.name}: {e}")
            skipped_count += 1
    
    return {"total_fetched": total_fetched_count,"updated": updated_count, "skipped_count": skipped_count, "skipped_names": skipped_names}


def update_progress_reports_zone():
    """Set report_zone = 'Default' for empty reports without updating modified timestamp."""
    print("Executing: Update Project Progress Reports where report_zone is empty.")

    updated_count = 0
    skipped_count = 0
    skipped_names = []
    
    DOCTYPE = "Project Progress Reports" 

    reports = frappe.get_all(
        DOCTYPE,
        filters={
            "report_zone": ["is", "not set"]
        },
        fields=["name"]
    )
    total_fetched_count = len(reports)
    for report in reports:
        success = False
        try:
            # Using frappe.db.set_value for direct, non-hook-triggering update
            frappe.db.set_value(
                DOCTYPE,
                report.name,
                "report_zone",
                "Default",
                update_modified=False
            )
            success = True
            
        except Exception as e:
            # Catch exceptions during database update
            print(f"Error updating Report {report.name}: {e}")
            
        
        # Explicit if-else for counting
        if success:
            updated_count += 1
        else:
            skipped_count += 1
            skipped_names.append(report.name) # Appending skipped name here
            
    return { "total_fetched": total_fetched_count,"updated": updated_count, "skipped_count": skipped_count, "skipped_names": skipped_names}