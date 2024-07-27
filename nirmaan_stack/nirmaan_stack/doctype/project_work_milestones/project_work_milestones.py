# Copyright (c) 2024, Abhishek and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from datetime import datetime,timedelta


class ProjectWorkMilestones(Document):
	pass

def generate_pwm(project, method=None):
	project_start_datetime = datetime.strptime(project.project_start_date, "%Y-%m-%d %H:%M:%S")
	project_start_date = project_start_datetime.date()

	project_end_datetime = datetime.strptime(project.project_end_date, "%Y-%m-%d %H:%M:%S")
	project_end_date = project_end_datetime.date()
	project_duration_days = (project_end_date - project_start_date).days

	divisions = int(project.subdivisions)

	scopes = project.project_scopes["scopes"]
	for values in scopes:
		milestones = frappe.db.get_list("Milestones",
								  filters={ "scope_of_work" : values["scope_of_work_name"]},
								  fields=["scope_of_work", "milestone_name","start_day","end_day"]
								  )
		for m in milestones:
			doc = frappe.new_doc("Project Work Milestones")
			doc.project=project.name
			doc.work_package=values["work_package"]
			doc.scope_of_work=m.scope_of_work
			doc.milestone=m.milestone_name
			start_day = int(m.start_day)
			end_day = int(m.end_day)
			doc.start_date = project_start_date + timedelta(days=((start_day * project_duration_days) / 60))
			doc.end_date = project_start_date + timedelta(days=((end_day * project_duration_days) / 60))
			status_list = project.subdivision_list
			# for i in range(1, divisions+1):
			# 	status_list[i] = "Pending"
			doc.status_list = status_list
			doc.insert(ignore_permissions=True)
