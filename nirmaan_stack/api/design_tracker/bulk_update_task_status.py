import frappe


ADMIN_ROLE = "Nirmaan Admin Profile"

# Statuses that have a mapped sub_status per SUB_STATUS_MAP in the frontend.
# For any other status, sub_status must be cleared.
STATUSES_WITH_SUB_STATUS = {"Clarification Awaiting", "Revision Pending"}


@frappe.whitelist()
def bulk_update_task_status(tracker_id, task_names, task_status, task_sub_status=None):
    user = frappe.session.user
    roles = frappe.get_roles(user)
    if ADMIN_ROLE not in roles and user != "Administrator":
        frappe.throw("Only Admin can perform bulk status updates.", frappe.PermissionError)

    task_names = frappe.parse_json(task_names) or []
    if not task_names:
        frappe.throw("No tasks selected.")

    doc = frappe.get_doc("Project Design Tracker", tracker_id)
    # Skip file_link / approval_proof validators for this save only
    doc.flags.ignore_design_tracker_status_validation = True

    target = set(task_names)
    updated = 0
    for task in doc.design_tracker_task:
        if task.name not in target:
            continue

        task.task_status = task_status

        if task_status in STATUSES_WITH_SUB_STATUS:
            task.task_sub_status = task_sub_status or ""
        else:
            task.task_sub_status = ""

        if task_status == "Not Applicable":
            task.deadline = None

        updated += 1

    doc.save()
    frappe.db.commit()

    return {"status": "success", "updated": updated}
