import frappe
import json

def execute():
   """
    Change PR workflow state from Rejected to Delayed 
   """ 
   prs = frappe.get_all(doctype = "Procurement Requests", filters={ 'workflow_state': ['=', 'Rejected']})
   for pr in prs:
         doc = frappe.get_doc("Procurement Requests", pr)
         order_list = doc.procurement_list
         new_list = {}
         new_list['list'] = []
         for item in order_list['list']:
            if 'status' not in item:
                obj = item
                obj['status'] = 'Delayed'
                new_list['list'].append(obj)
            else:
                new_list['list'].append(item)
         frappe.db.set_value("Procurement Requests", pr, "procurement_list", json.dumps(new_list))
         frappe.db.set_value("Procurement Requests", pr, "workflow_state", "Delayed")
   frappe.db.commit()