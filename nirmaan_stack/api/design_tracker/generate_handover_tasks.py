import frappe
from frappe.utils import add_days, today


@frappe.whitelist()
def generate_handover_tasks(project_id):
	"""
	Generate handover copies of all applicable design tracker tasks for a project.

	Copies tasks where task_status != 'Not Applicable', resets status fields,
	sets task_phase='Handover' and deadline=today+7 days.

	Idempotent: returns early if handover_generated is already set.
	"""
	if not project_id:
		return {"status": "error", "message": "project_id is required"}

	trackers = frappe.get_all(
		"Project Design Tracker",
		filters={"project": project_id},
		fields=["name"]
	)

	if not trackers:
		return {"status": "error", "message": "No Design Tracker found for this project"}

	tracker_name = trackers[0].name
	doc = frappe.get_doc("Project Design Tracker", tracker_name)

	if doc.handover_generated:
		return {"status": "already_generated", "message": "Handover tasks have already been generated"}

	applicable_tasks = [
		t for t in doc.design_tracker_task
		if t.task_status != "Not Applicable" and t.task_phase != "Handover"
	]

	if not applicable_tasks:
		return {"status": "error", "message": "No applicable tasks to copy for handover"}

	handover_deadline = add_days(today(), 7)

	for task in applicable_tasks:
		doc.append("design_tracker_task", {
			"task_phase": "Handover",
			"task_zone": task.task_zone,
			"design_category": task.design_category,
			"task_name": task.task_name,
			"task_type": task.task_type,
			"deadline": handover_deadline,
			"task_status": "Not Started",
			"task_sub_status": "",
			"assigned_designers": task.assigned_designers,
			"file_link": "",
			"last_submitted": None,
			"approval_proof": None,
			"comments": "",
		})

	doc.handover_generated = 1
	doc.save(ignore_permissions=True)
	frappe.db.commit()

	return {
		"status": "success",
		"message": f"Generated {len(applicable_tasks)} handover tasks",
		"task_count": len(applicable_tasks)
	}
