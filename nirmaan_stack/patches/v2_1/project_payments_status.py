import frappe
import json

def execute():
   """
    Adds status as "Paid" to each past project payment entry
   """ 
   pays = frappe.get_all("Project Payments")
   for pay in pays:
         doc = frappe.get_doc("Project Payments", pay.name)
         if not doc.status:
            doc.status = "Paid"
            doc.save(ignore_permissions=True)