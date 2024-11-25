import frappe
import json

def execute():
   """
    Set Sent POs to Dispatched POs
   """ 
   pos = frappe.get_all("Procurement Orders", filters={
       'status': 'PO Sent'
   })
   for po in pos:
         doc = frappe.get_doc("Procurement Orders", po.name)
         doc.status = "Dispatched"
         doc.save(ignore_permissions=True)