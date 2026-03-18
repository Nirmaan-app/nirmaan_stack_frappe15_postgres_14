import frappe

@frappe.whitelist()
def rename_zone(tracker_id, old_zone_name, new_zone_name):
    """
    Renames a zone in 'Project Commission Report'.
    1. Updates 'zone' child table: 'tracker_zone' field.
    2. Updates 'commission_report_task' child table: 'task_zone' field.
    """
    doc = frappe.get_doc("Project Commission Report", tracker_id)
    
    updated = False
    
    for z in doc.zone:
        if z.tracker_zone == new_zone_name:
            frappe.throw(f"This project already has '{new_zone_name}' as a zone name.")
    
    for z in doc.zone:
        if z.tracker_zone == old_zone_name:
            z.tracker_zone = new_zone_name
            updated = True
            
    if doc.commission_report_task:
        for task in doc.commission_report_task:
            if task.task_zone == old_zone_name:
                task.task_zone = new_zone_name
                updated = True
    
    if updated:
        doc.flags.ignore_permissions = True
        doc.save()
        return {"status": "success", "message": f"Zone renamed to {new_zone_name}"}
    else:
         return {"status": "skipped", "message": "No matching zone or tasks found."}
