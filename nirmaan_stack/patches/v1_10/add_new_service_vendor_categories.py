import frappe
import json

def execute():
   """
    Add new service categories to all existing service vendors.
   """ 
   vendors = frappe.get_all("Vendors", filters={
       'vendor_type': 'Service'
   })
   for vendor in vendors:
         doc = frappe.get_doc("Vendors", vendor.name)
         vc = doc.vendor_category
         vc['categories'].append("Painting Services")
         vc['categories'].append("Carpentry Services")
         vc['categories'].append("POP Services")
         doc.vendor_category = vc
         doc.save(ignore_permissions=True)