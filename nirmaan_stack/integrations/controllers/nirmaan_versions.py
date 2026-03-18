import json
import frappe

def generate_sr_amend_version(doc, method):
    if doc.ref_doctype != "Service Requests":
        return
    data = json.loads(doc.data)
    print(f"amend version: {data}")

    # Check if the status changed from "Approved" to "Amendment"
    status_change = next((change for change in data['changed'] if change[0] == 'status'), None)
    if status_change and status_change[1] == "Approved" and status_change[2] == "Amendment":
        # Create a new Nirmaan Versions document
        nv = frappe.new_doc("Nirmaan Versions")
        nv.ref_doctype = doc.ref_doctype
        nv.docname = doc.docname
        nv.data = json.dumps(doc.data)
        nv.previous_state = status_change[1]
        nv.new_state = status_change[2]
        nv.insert(ignore_permissions=True)
    else:
        pass
