import frappe
import json

def execute():
   """
    Adds makes to each empty quotation requests
   """ 
   qrs = frappe.get_all("Quotation Requests")
   for qr in qrs:
         doc = frappe.get_doc("Quotation Requests", qr.name)
         doc.makes = {'list' : []}
         doc.save(ignore_permissions=True)