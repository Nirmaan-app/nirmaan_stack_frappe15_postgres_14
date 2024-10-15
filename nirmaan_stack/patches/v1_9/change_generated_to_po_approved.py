import frappe
import json

def execute():
   """
    Change status from generated to PO Approved for every approved PO in the system    
   """ 
   pos = frappe.get_all("Procurement Orders", filters={
       'status': 'Generated'
   })
   for po in pos:
         doc = frappe.get_doc("Procurement Orders", po)
         frappe.db.set_value("Procurement Orders", po, "status", "PO Approved")
   frappe.db.commit()