import frappe
import json

def execute():
   """
    Adds makes to each category for PRs
   """ 
   prs = frappe.get_all("Procurement Requests")
   for pr in prs:
         doc = frappe.get_doc("Procurement Requests", pr.name)
         new_cl = {'list' : []}
         for cat in doc.category_list['list']:
            obj = {'name': cat['name'], 'makes': []}
            new_cl['list'].append(obj)
         doc.category_list = new_cl
         doc.save(ignore_permissions=True)