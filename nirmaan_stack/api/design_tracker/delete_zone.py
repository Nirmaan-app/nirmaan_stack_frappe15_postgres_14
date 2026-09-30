import frappe

from nirmaan_stack.api.sr_finalize import get_user_role_profile


@frappe.whitelist()
def delete_zone(tracker_id, zone_name):
    """
    Deletes a zone from 'Project Design Tracker' (Admin only).
    1. Removes the row from the 'zone' child table.
    2. Removes every 'design_tracker_task' row in that zone (all phases).
    """
    if get_user_role_profile(frappe.session.user) != "Nirmaan Admin Profile":
        frappe.throw("Only Admin users can delete a zone.", frappe.PermissionError)

    doc = frappe.get_doc("Project Design Tracker", tracker_id)

    zones = [z.tracker_zone for z in doc.zone] or list({t.task_zone for t in doc.design_tracker_task if t.task_zone})
    if zone_name not in zones:
        frappe.throw(f"Zone '{zone_name}' not found in this tracker.")
    if len(zones) <= 1:
        frappe.throw("Cannot delete the only zone of a tracker.")

    doc.zone = [z for z in doc.zone if z.tracker_zone != zone_name]
    kept_tasks = [t for t in doc.design_tracker_task if t.task_zone != zone_name]
    removed_count = len(doc.design_tracker_task) - len(kept_tasks)
    doc.design_tracker_task = kept_tasks

    doc.flags.ignore_permissions = True
    doc.save()
    return {"status": "success", "removed_tasks": removed_count}
