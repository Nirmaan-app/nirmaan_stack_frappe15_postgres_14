import frappe
import json

def execute():
   """
   Adding category and tax to PO's order list
   """ 
   pos = frappe.get_all("Procurement Orders")
   for po in pos:
         doc = frappe.get_doc("Procurement Orders", po)
         new_list = {'list': []}
         for item in doc.order_list['list']:
              it = frappe.get_doc('Items', item['name'])
              cat = frappe.get_doc('Category', it.category)
              obj = item
              obj['category']=cat.name
              obj['tax'] = int(cat.tax)
              new_list['list'].append(obj)
         frappe.db.set_value("Procurement Orders", po, "order_list", json.dumps(new_list))
   frappe.db.commit()