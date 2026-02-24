import frappe


def execute():
	"""Backfill NA tasks into handover phase for projects that already generated handover."""
	trackers = frappe.get_all(
		"Project Design Tracker",
		filters={"handover_generated": 1},
		fields=["name"],
	)

	if not trackers:
		return

	for tracker in trackers:
		try:
			doc = frappe.get_doc("Project Design Tracker", tracker.name)

			# Collect onboarding-phase NA tasks
			na_tasks = [
				t for t in doc.design_tracker_task
				if t.task_phase != "Handover" and t.task_status == "Not Applicable"
			]

			if not na_tasks:
				continue

			# Build set of existing handover task keys for dedup
			existing_keys = set()
			for t in doc.design_tracker_task:
				if t.task_phase == "Handover":
					existing_keys.add((t.task_name, t.design_category, t.task_zone or ""))

			appended = 0
			for task in na_tasks:
				key = (task.task_name, task.design_category, task.task_zone or "")
				if key in existing_keys:
					continue

				doc.append("design_tracker_task", {
					"task_phase": "Handover",
					"task_zone": task.task_zone,
					"design_category": task.design_category,
					"task_name": task.task_name,
					"task_type": task.task_type,
					"task_status": "Not Applicable",
					"task_sub_status": "",
					"assigned_designers": task.assigned_designers,
					"deadline": None,
					"file_link": "",
					"last_submitted": None,
					"approval_proof": None,
					"comments": "",
				})
				appended += 1

			if appended:
				doc.save(ignore_permissions=True)
				frappe.log_error(
					title="Backfill Handover NA Tasks",
					message=f"Appended {appended} NA tasks to handover phase for {tracker.name}",
				)

		except Exception:
			frappe.log_error(
				title="Backfill Handover NA Tasks Error",
				message=f"Failed for tracker {tracker.name}: {frappe.get_traceback()}",
			)

	frappe.db.commit()
