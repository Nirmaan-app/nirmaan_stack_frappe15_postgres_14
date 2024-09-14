import frappe
import json

def execute():
   """
    Add status as generated for every PO in the system    
   """ 
   pos = frappe.get_all("Procurement Orders")
   for po in pos:
         doc = frappe.get_doc("Procurement Orders", po)
         if(not doc.status):
            frappe.db.set_value("Procurement Orders", po, "status", "Generated")
   frappe.db.commit()