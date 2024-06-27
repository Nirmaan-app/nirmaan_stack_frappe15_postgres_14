# Copyright (c) 2024, Abhishek and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class Projects(Document):
	def before_save(self):
		#self.project_duration = (datetime.strptime(self.project_end_date, '%Y-%m-%d %H:%M:%S') - datetime.strptime(self.project_start_date, '%Y-%m-%d %H:%M:%S')).days or 0
		# self.project_city = self.get_project_address()["city"] or ""
		# self.project_state = self.get_project_address()["state"] or ""
		pass
	def get_project_address(self):
		address = frappe.get_doc("Address", self.project_address)
		return {
			"city":address.city,
			"state":address.state
		  }
	
def generateUserPermissions(project, method=None):
	doc = frappe.new_doc("User Permission")
	doc.user = project.project_lead
	doc.allow = "Projects"
	doc.for_value = project.name
	doc.insert(ignore_permissions=True)
	
	doc = frappe.new_doc("User Permission")
	doc.user = project.procurement_lead
	doc.allow = "Projects"
	doc.for_value = project.name
	doc.insert(ignore_permissions=True)

	doc = frappe.new_doc("User Permission")
	doc.user = project.design_lead
	doc.allow = "Projects"
	doc.for_value = project.name
	doc.insert(ignore_permissions=True)

	doc = frappe.new_doc("User Permission")
	doc.user = project.project_manager
	doc.allow = "Projects"
	doc.for_value = project.name
	doc.insert(ignore_permissions=True)
