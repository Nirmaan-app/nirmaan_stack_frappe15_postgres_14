import frappe

def execute():
   """
   Adding default subdivision field to projects
   """ 
   projects = frappe.get_all("Projects")

   for project in projects:
      frappe.db.set_value("Projects", project, "subdivisions", "1")
      frappe.db.set_value("Projects", project, "subdivision_list", '{"list" : [{"name": "Area 1", "status": "Pending"}] }')
   frappe.db.commit() 