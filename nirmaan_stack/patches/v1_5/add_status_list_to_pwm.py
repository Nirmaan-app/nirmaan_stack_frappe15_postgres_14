import frappe

def execute():
   """
   Adding status list to project work milestones
   """ 
   milestones = frappe.get_all("Project Work Milestones")
   for milestone in milestones:
         frappe.db.set_value("Project Work Milestones", milestone, "status_list", '{"list" : [{"name": "Area 1", "status": "Pending"}] }')
   frappe.db.commit() 