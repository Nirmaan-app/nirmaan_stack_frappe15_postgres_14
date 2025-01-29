import frappe
import json

def execute():
   """
    Adds payment date to each project payment entry
   """ 
   pays = frappe.get_all("Project Payments")
   for pay in pays:
         doc = frappe.get_doc("Project Payments", pay.name)
         if not doc.payment_date:
            doc.payment_date = doc.creation
            doc.save(ignore_permissions=True)