import frappe
import json

def generate_amend_version(doc, method):
    data = json.loads(doc.data)
    status_change = next((change for change in data['changed'] if change[0] == 'status'), None)
    if status_change:
        if status_change[1] == "PO Approved" and status_change[2] == "PO Amendment":
            nv = frappe.new_doc("Nirmaan Versions")
            nv.ref_doctype = doc.ref_doctype
            nv.docname =  doc.docname
            nv.data = json.dumps(doc.data)
            nv.previous_state = status_change[1]
            nv.new_state  = status_change[2]
            nv.insert(ignore_permissions=True)
        else:
            pass
    else:
        pass

    

def remove_amend_version(doc, method):
   data = json.loads(doc.data)
   status_change = next((change for change in data['changed'] if change[0] == 'status'), None)
   if status_change:
        if status_change[1] == "PO Amendment" and status_change[2] == "PO Approved":
            nvs = frappe.db.get_list("Nirmaan Versions",
                                     filters={
                                         "ref_doctype": doc.ref_doctype,
                                         "docname": doc.docname,
                                         "previous_state":"PO Approved",
                                         "new_state": "PO Amendment"
                                     },
                                     order_by= "creation desc")
            if len(nvs)>=1:
                frappe.delete_doc("Nirmaan Versions", nvs[0].name)
            else:
                pass
        else:
            pass
   else:
       pass

