# Copyright (c) 2025, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from datetime import datetime, timedelta
import json


class CriticalPOItems(Document):
	pass


def after_insert(doc, method=None):
	"""
	When a new Critical PO Item is added to the master,
	automatically create a Critical PO Task for all projects
	that have this category enabled (i.e., have existing tasks with this category).

	The new task will have:
	- po_release_date = project_start_date + release_timeline_offset
	- status = "Not Applicable" (since it was added after initial setup)
	"""
	propagate_new_item_to_projects(doc)


def propagate_new_item_to_projects(item_doc):
	"""
	Find all projects with this category enabled and create
	a Critical PO Task for each.

	A category is considered "enabled" for a project if there exists
	at least one Critical PO Task with that category linked to the project.
	"""
	category = item_doc.critical_po_category

	if not category:
		return

	# Find distinct projects that have this category enabled
	# Only include projects with a valid project_start_date
	projects_with_category = frappe.db.sql("""
		SELECT DISTINCT cpt.project, p.project_name, p.project_start_date
		FROM `tabCritical PO Tasks` cpt
		INNER JOIN `tabProjects` p ON cpt.project = p.name
		WHERE cpt.critical_po_category = %s
		AND p.project_start_date IS NOT NULL
	""", (category,), as_dict=True)

	if not projects_with_category:
		return

	created_count = 0
	skipped_projects = []

	for project in projects_with_category:
		# Check for duplicate (same category, item_name, sub_category)
		existing = frappe.db.exists("Critical PO Tasks", {
			"project": project.project,
			"critical_po_category": category,
			"item_name": item_doc.item_name,
			"sub_category": item_doc.sub_category or ""
		})

		if existing:
			skipped_projects.append(project.project_name)
			continue

		# Parse project_start_date
		start_date = project.project_start_date
		if isinstance(start_date, str):
			try:
				start_date = datetime.strptime(start_date, "%Y-%m-%d %H:%M:%S").date()
			except ValueError:
				start_date = datetime.strptime(start_date, "%Y-%m-%d").date()

		# Calculate po_release_date
		offset_days = item_doc.release_timeline_offset or 0
		po_release_date = start_date + timedelta(days=offset_days)

		# Create new Critical PO Task
		task = frappe.new_doc("Critical PO Tasks")
		task.project = project.project
		task.project_name = project.project_name
		task.critical_po_category = category
		task.item_name = item_doc.item_name
		task.sub_category = item_doc.sub_category or ""
		task.po_release_date = po_release_date
		task.status = "Not Applicable"
		task.associated_pos = json.dumps({"pos": []})
		task.insert(ignore_permissions=True)
		created_count += 1

	if created_count > 0:
		frappe.msgprint(
			f"Added '{item_doc.item_name}' to {created_count} project(s) with status 'Not Applicable'.",
			alert=True
		)
