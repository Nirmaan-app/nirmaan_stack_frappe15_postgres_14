import frappe
import json

def execute():
   """
    Copy Work Packages to Project Work packages field
   """ 
   pos = frappe.get_all("Projects")
   for po in pos:
         doc = frappe.get_doc("Projects", po)
         value = doc.project_work_milestones
         frappe.db.set_value("Projects", po, "project_work_packages", json.dumps(value))
   frappe.db.commit()