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
	current_user = frappe.session.user
	user = None
	if current_user != "Administrator":
		user = frappe.get_doc("Nirmaan Users", current_user)
	if(project.project_lead!=""):
		user_permissions.add(project.project_lead)
	if user and user.role_profile != "Nirmaan Admin Profile"  and (not project.project_lead or (project.project_lead and project.project_lead != current_user)):
		user_permissions.add(current_user)

	if(project.procurement_lead!=""):
		user_permissions.add(project.procurement_lead)
	if(project.design_lead!=""):
		user_permissions.add(project.design_lead)
	if(project.project_manager!=""):	
		user_permissions.add(project.project_manager)
	if(project.estimates_exec!=""):	
		user_permissions.add(project.estimates_exec)
	if(project.accountant!=""):	
		user_permissions.add(project.accountant)	
	if(len(user_permissions)!=0):
		for user in user_permissions:
			doc = frappe.new_doc("User Permission")
			doc.user = user
			doc.allow = "Projects"
			doc.for_value = project.name
			doc.insert(ignore_permissions=True)


def on_update(doc, method=None):
	old_doc = doc.get_doc_before_save()
	if doc and doc.customer and old_doc and old_doc.customer and doc.customer != old_doc.customer:
		inflow_payments = frappe.db.get_all("Project Inflows", 
																			 filters={"project": doc.name},
																			 fields={"name", "customer"}
																		 )
		for inflow in inflow_payments:
			inflow_doc = frappe.get_doc("Project Inflows", inflow.name)
			inflow_doc.customer = doc.customer
			inflow_doc.save(ignore_permissions=True)


		
