# import frappe
# from frappe.utils import flt

# from nirmaan_stack.integrations.controllers.project_cashflow_hold_update import update_projects_cashflow_hold


# def execute():
# 	"""
# 	Seed cashflow_gap_limit = 20% of project_value for every project that is
# 	not Completed and has a non-zero project_value. Skips projects that already
# 	carry a non-zero cashflow_gap_limit so re-running is safe.

# 	Uses frappe.db.set_value(..., update_modified=False) so the project's
# 	`modified` timestamp is not bumped.

# 	After the backfill, immediately runs the cashflow-hold cron once so any
# 	project whose current gap already exceeds its freshly-seeded limit is
# 	flipped to CEO Hold without waiting for the next scheduled tick.
# 	"""
# 	projects = frappe.get_all(
# 		"Projects",
# 		filters=[
# 			["status", "!=", "Completed"],
# 			["project_value", "is", "set"],
# 			["project_value", "!=", "0"],
# 		],
# 		fields=["name", "project_value_gst", "cashflow_gap_limit"],
# 	)

# 	updated = 0
# 	for p in projects:
# 		if flt(p.cashflow_gap_limit) > 0:
# 			continue

# 		project_value_gst = flt(p.project_value_gst)
# 		if project_value_gst <= 0:
# 			continue

# 		new_limit = project_value_gst * 0.20
# 		frappe.db.set_value(
# 			"Projects",
# 			p.name,
# 			"cashflow_gap_limit",
# 			new_limit,
# 			update_modified=False,
# 		)
# 		updated += 1

# 	if updated:
# 		frappe.db.commit()

# 	# Run the cashflow-hold cron once now so projects whose current gap
# 	# already exceeds the freshly-seeded limit are flipped to CEO Hold
# 	# immediately, instead of waiting for the next scheduled tick.
# 	update_projects_cashflow_hold()
