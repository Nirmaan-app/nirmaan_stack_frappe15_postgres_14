import frappe
import json

def execute():
   """
    Add/change existing project's status to WIP
   """ 
   projects = frappe.get_all("Projects", filters={
       'status': ''
   })
   for project in projects:
         frappe.db.set_value("Projects", project, "status", "WIP")
   frappe.db.commit()