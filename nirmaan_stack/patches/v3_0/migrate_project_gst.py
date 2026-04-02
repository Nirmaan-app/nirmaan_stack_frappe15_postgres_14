import frappe
import json

def execute():
    # Fetch all projects with their legacy GST JSON
    projects = frappe.get_all("Projects", fields=["name", "project_gst_number"])
    
    updated_count = 0
    skipped_count = 0
    failed_count = 0
    
    skipped_projects = []
    failed_projects = []
    
    print("\nStarting Project GST Migration...")
    
    try:
        for project in projects:
            if not project.project_gst_number:
                skipped_count += 1
                skipped_projects.append(project.name)
                continue
                
            try:
                # Parse the JSON field
                data = project.project_gst_number
                if isinstance(data, str):
                    data = json.loads(data)
                    
                gst_list = data.get("list", [])
                
                if not gst_list:
                    skipped_count += 1
                    skipped_projects.append(project.name)
                    continue
                    
                # Get the first GST from the legacy list
                legacy_gstin = gst_list[0].get("gst")
                
                if legacy_gstin:
                    # Update the new project_gst Link field
                    # Use update_modified=False to keep the original modified timestamp
                    frappe.db.set_value(
                        "Projects", 
                        project.name, 
                        "project_gst", 
                        legacy_gstin, 
                        update_modified=False
                    )
                    updated_count += 1
                else:
                    skipped_count += 1
                    skipped_projects.append(project.name)
                    
            except (json.JSONDecodeError, KeyError) as e:
                print(f"Skipping project {project.name} due to invalid JSON/Format: {str(e)}")
                skipped_count += 1
                skipped_projects.append(project.name)
            except Exception as e:
                failed_count += 1
                failed_projects.append(project.name)
                print(f"CRITICAL: Failed to migrate project {project.name}: {str(e)}")
                # Re-raise to trigger the overall rollback
                raise e

        # Explicitly commit if all went well
        frappe.db.commit()
        print(f"\nMigration Successful!")
        print(f"Summary: {updated_count} updated, {skipped_count} skipped, {failed_count} failed.\n")
        
        if skipped_projects:
            print(f"Skipped Projects: {', '.join(skipped_projects)}")
        if failed_projects:
            print(f"Failed Projects: {', '.join(failed_projects)}")
        
    except Exception as overall_e:
        # If any major error occurs, rollback everything to keep it atomic
        frappe.db.rollback()
        print(f"\nMigration FAILED completely. Rolled back all changes. Error: {str(overall_e)}")
        if failed_projects:
            print(f"Projects that caused failure: {', '.join(failed_projects)}")
        # Re-raise to stop the bench migrate process
        raise overall_e
