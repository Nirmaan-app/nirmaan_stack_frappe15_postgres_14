# Copyright (c) 2024, Abhishek and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class ProjectWorkMilestones(Document):
	pass

def generate_pwm(project, method=None):
	scopes = project.project_scopes["scopes"]
	for values in scopes:
		milestones = frappe.db.get_list("Milestones",
								  filters={ "scope_of_work" : values["scope_of_work_name"]},
								  fields=["scope_of_work", "milestone_name"]
								  )
		for m in milestones:
			doc = frappe.new_doc("Project Work Milestones")
			doc.project=project.name
			doc.work_package=values["work_package"]
			doc.scope_of_work=m.scope_of_work
			doc.milestone=m.milestone_name
			doc.insert(ignore_permissions=True)