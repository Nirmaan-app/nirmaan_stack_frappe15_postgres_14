import frappe

def execute():
    """
    Patch to initialize 'Default' zone and backfill tasks without updating 'modified' timestamp.
    Logs skipped items and reasons.
    """
    try:
        print("Starting Patch: Initialize Default Zone (Preserving Timestamps).")
        update_design_tracker_zones()
        print("Patch completed successfully.")
        
    except Exception as e:
        print(f"CRITICAL ERROR during patch execution: {e}")
        raise


def update_design_tracker_zones():
    print("Executing updates...")
    
    trackers = frappe.get_all("Project Design Tracker", fields=["name", "modified"])
    
    updated_count = 0
    skipped_count = 0
    skipped_log = [] # List to store {name, reason}
    
    for tracker_ref in trackers:
        try:
            doc = frappe.get_doc("Project Design Tracker", tracker_ref.name)
            original_modified = doc.modified
            
            # 1. Update Zone Table (Add 'Default' if empty)
            zones_updated = False
            current_zones = doc.get("zone") or []
            
            if not current_zones:
                doc.append("zone", {
                    "tracker_zone": "Default"
                })
                
                doc.flags.ignore_permissions = True
                doc.flags.ignore_version = True
                doc.save() 
                
                # RESTORE Original Modified Timestamp
                frappe.db.set_value("Project Design Tracker", doc.name, "modified", original_modified, update_modified=False)
                
                zones_updated = True
            
            # 2. Update Tasks (Backfill 'Default' for empty zones)
            tasks = frappe.get_all(
                "Design Tracker Task Child Table",
                filters={
                    "parent": doc.name,
                    "task_zone": ["in", [None, ""]] 
                },
                fields=["name"]
            )
            
            if tasks:
                for task in tasks:
                    frappe.db.set_value(
                        "Design Tracker Task Child Table",
                        task.name,
                        "task_zone",
                        "Default",
                        update_modified=False
                    )

            if zones_updated or tasks:
                updated_count += 1
                print(f"Processed Tracker {doc.name}")
            else:
                skipped_count += 1
                skipped_log.append(f"{doc.name}: Already up to date")

        except Exception as e:
            print(f"Error processing Tracker {tracker_ref.name}: {e}")
            skipped_count += 1
            skipped_log.append(f"{tracker_ref.name}: Error - {str(e)}")

    print(f"Stats: Fetched {len(trackers)}, Processed {updated_count}, Skipped {skipped_count}")
    
    if skipped_log:
        print("\nSkipped Items Details:")
        for log in skipped_log:
            print(f"- {log}")
