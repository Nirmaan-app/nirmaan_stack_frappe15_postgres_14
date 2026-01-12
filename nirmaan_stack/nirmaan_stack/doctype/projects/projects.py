# Copyright (c) 2024, Abhishek and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.model.naming import getseries
from datetime import datetime, timedelta

from frappe.utils import flt

class Projects(Document):
	def before_save(self):
		self.project_value = sum(flt(d.customer_po_value_exctax) for d in self.get("customer_po_details", []))
		self.project_value_gst = sum(flt(d.customer_po_value_inctax) for d in self.get("customer_po_details", []))		
		#self.project_duration = (datetime.strptime(self.project_end_date, '%Y-%m-%d %H:%M:%S') - datetime.strptime(self.project_start_date, '%Y-%m-%d %H:%M:%S')).days or 0
		# self.project_city = self.get_project_address()["city"] or ""
		# self.project_state = self.get_project_address()["state"] or ""
		pass
	def autoname(self):
		city = f"{self.project_city}".replace(" ", "_")
		prefix = "PROJ-"
		self.name = f"{city}-{prefix}{getseries(prefix, 5)}"
	
def generateUserPermissions(project, method=None):
	user_permissions = set()
	current_user = frappe.session.user
	user = None
	if current_user != "Administrator":
		user = frappe.get_doc("Nirmaan Users", current_user)
	if project.project_lead:
		user_permissions.add(project.project_lead)
	if user and user.role_profile != "Nirmaan Admin Profile" and (not project.project_lead or (project.project_lead and project.project_lead != current_user)):
		user_permissions.add(current_user)

	if project.procurement_lead:
		user_permissions.add(project.procurement_lead)
	if project.design_lead:
		user_permissions.add(project.design_lead)
	if project.project_manager:
		user_permissions.add(project.project_manager)
	if project.estimates_exec:
		user_permissions.add(project.estimates_exec)
	if project.accountant:
		user_permissions.add(project.accountant)
	if len(user_permissions) != 0:
		for user in user_permissions:
			doc = frappe.new_doc("User Permission")
			doc.user = user
			doc.allow = "Projects"
			doc.for_value = project.name
			doc.insert(ignore_permissions=True)


def on_update(doc, method=None):
	old_doc = doc.get_doc_before_save()

	# Handle customer change - propagate to related documents
	if doc and doc.customer and old_doc and old_doc.customer and doc.customer != old_doc.customer:
		inflow_payments = frappe.db.get_all("Project Inflows", filters={"project": doc.name}, fields={"name", "customer"})
		for inflow in inflow_payments:
			inflow_doc = frappe.get_doc("Project Inflows", inflow.name)
			inflow_doc.customer = doc.customer
			inflow_doc.save(ignore_permissions=True)
		project_invoices = frappe.db.get_all("Project Invoices", filters={"project": doc.name}, fields={"name", "customer"})
		for inflow in project_invoices:
			inflow_doc = frappe.get_doc("Project Invoices", inflow.name)
			inflow_doc.customer = doc.customer
			inflow_doc.save(ignore_permissions=True)

	# Handle project_start_date change - recalculate Critical PO Task deadlines
	if doc.has_value_changed('project_start_date') and doc.project_start_date:
		recalculate_critical_po_deadlines(doc.name, doc.project_start_date)


def recalculate_critical_po_deadlines(project_name, project_start_date):
	"""
	Recalculates po_release_date for all Critical PO Tasks when project_start_date changes.

	Formula: po_release_date = project_start_date + release_timeline_offset (days)

	The release_timeline_offset is fetched from the matching Critical PO Items master record
	by matching critical_po_category, item_name, and sub_category.
	"""
	# Parse project_start_date (handles both date and datetime formats)
	if isinstance(project_start_date, str):
		try:
			start_date = datetime.strptime(project_start_date, "%Y-%m-%d %H:%M:%S").date()
		except ValueError:
			start_date = datetime.strptime(project_start_date, "%Y-%m-%d").date()
	else:
		start_date = project_start_date

	# Get all Critical PO Tasks for this project
	critical_po_tasks = frappe.db.get_all(
		"Critical PO Tasks",
		filters={"project": project_name},
		fields=["name", "critical_po_category", "item_name", "sub_category"]
	)

	if not critical_po_tasks:
		return

	# Build a lookup map from Critical PO Items master for efficient matching
	critical_po_items = frappe.db.get_all(
		"Critical PO Items",
		fields=["critical_po_category", "item_name", "sub_category", "release_timeline_offset"]
	)

	# Create lookup key: (category, item_name, sub_category) -> offset
	offset_map = {}
	for item in critical_po_items:
		key = (
			item.get("critical_po_category") or "",
			item.get("item_name") or "",
			item.get("sub_category") or ""
		)
		offset_map[key] = item.get("release_timeline_offset") or 0

	# Update each Critical PO Task
	updated_count = 0
	for task in critical_po_tasks:
		key = (
			task.get("critical_po_category") or "",
			task.get("item_name") or "",
			task.get("sub_category") or ""
		)

		offset_days = offset_map.get(key)

		if offset_days is not None:
			new_release_date = start_date + timedelta(days=offset_days)

			frappe.db.set_value(
				"Critical PO Tasks",
				task["name"],
				"po_release_date",
				new_release_date.strftime("%Y-%m-%d"),
				update_modified=False
			)
			updated_count += 1

	if updated_count > 0:
		frappe.db.commit()
		frappe.msgprint(
			f"Updated PO Release Deadline for {updated_count} Critical PO Task(s) based on new project start date.",
			alert=True
		)


		
