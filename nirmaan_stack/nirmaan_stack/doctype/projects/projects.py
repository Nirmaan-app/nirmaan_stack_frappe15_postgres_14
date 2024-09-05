# Copyright (c) 2024, Abhishek and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.model.naming import getseries


class Projects(Document):
	def before_save(self):
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
	user_permissions = {project.project_lead, project.procurement_lead, project.design_lead, project.project_manager}
	for user in user_permissions:
		doc = frappe.new_doc("User Permission")
		doc.user = user
		doc.allow = "Projects"
		doc.for_value = project.name
		doc.insert(ignore_permissions=True)
		
