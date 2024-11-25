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

	# divisions = int(project.subdivisions)

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

def edit_pwm(project, method=None):
	# doc = project.get_doc_before_save()
	# print("doc before save", doc)
    if project.has_value_changed('project_scopes'):
        # print(f"running scopes changes")
        scopes_map = {
            scope["scope_of_work_name"]: scope["work_package"] 
            for scope in project.project_scopes["scopes"]
        }
        
        updated_scopes = {scope["scope_of_work_name"] for scope in project.project_scopes["scopes"]}

        cur_pwms = frappe.db.get_list(
            "Project Work Milestones",
            filters={"project": project.name},
            fields=["name", "scope_of_work", "milestone"]
        )

        existing_scopes = {pwm["scope_of_work"] for pwm in cur_pwms}
        scopes_to_delete = [pwm for pwm in cur_pwms if pwm["scope_of_work"] not in updated_scopes]
        scopes_to_add = updated_scopes - existing_scopes

        for pwm in scopes_to_delete:
            frappe.delete_doc("Project Work Milestones", pwm["name"], ignore_permissions=True)
            frappe.db.commit()

        for scope in scopes_to_add:
            work_package = scopes_map[scope]
            milestones = frappe.db.get_list(
                "Milestones",
                filters={"scope_of_work": scope},
                fields=["milestone_name", "start_day", "end_day"]
            )

            project_start_datetime = datetime.strptime(project.project_start_date, "%Y-%m-%d %H:%M:%S")
            project_start_date = project_start_datetime.date()
            project_end_datetime = datetime.strptime(project.project_end_date, "%Y-%m-%d %H:%M:%S")
            project_end_date = project_end_datetime.date()
            project_duration_days = (project_end_date - project_start_date).days

            for milestone in milestones:
                start_day = int(milestone["start_day"])
                end_day = int(milestone["end_day"])

                frappe.get_doc({
                    "doctype": "Project Work Milestones",
                    "project": project.name,
                    "scope_of_work": scope,
                    "milestone": milestone["milestone_name"],
					"work_package": work_package,
					"status_list" : project.subdivision_list,
                    "start_date": project_start_date + timedelta(days=((start_day * project_duration_days) / 60)),
                    "end_date": project_start_date + timedelta(days=((end_day * project_duration_days) / 60)),
                }).insert(ignore_permissions=True)
                frappe.db.commit()

    if project.has_value_changed("project_start_date") or project.has_value_changed("project_end_date"):
        # print(f"running project end date chage")
        project_start_datetime = datetime.strptime(project.project_start_date, "%Y-%m-%d %H:%M:%S")
        project_start_date = project_start_datetime.date()
        project_end_datetime = datetime.strptime(project.project_end_date, "%Y-%m-%d %H:%M:%S")
        project_end_date = project_end_datetime.date()
        project_duration_days = (project_end_date - project_start_date).days
        scopes = project.project_scopes["scopes"]

        for values in scopes:
            milestones = frappe.db.get_list(
                "Milestones",
                filters={"scope_of_work": values["scope_of_work_name"]},
                fields=["scope_of_work", "milestone_name", "start_day", "end_day"]
            )

            pwm = frappe.db.get_list(
                "Project Work Milestones",
                filters={"project": project.name, "scope_of_work": values["scope_of_work_name"]},
                fields=["name", "project", "start_date", "end_date", "scope_of_work", "milestone"]
            )

            for m in pwm:
                new_pwm = frappe.get_doc("Project Work Milestones", m["name"])
                md = [mile for mile in milestones if mile["milestone_name"] == m["milestone"]]
                if md:
                    start_day = int(md[0]["start_day"])
                    end_day = int(md[0]["end_day"])
                    new_pwm.start_date = project_start_date + timedelta(days=((start_day * project_duration_days) / 60))
                    new_pwm.end_date = project_start_date + timedelta(days=((end_day * project_duration_days) / 60))
                    new_pwm.save(ignore_permissions=True)
