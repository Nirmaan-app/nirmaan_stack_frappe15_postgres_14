import json
import frappe

def generate_versions(doc, method):
    # Determine the doctype and dynamically set fields
    previous_state = None
    data = {"added": [], "changed": [], "data_import": None, "removed": [], "row_changed": [], "updater_reference": None}
    
    # Mapping for handling specific doctypes
    if doc.doctype == "Procurement Requests":
        previous_state = doc.workflow_state

        data["changed"].append(["procurement_list", doc.procurement_list, []])  # Empty new data since it's a delete operation

    elif doc.doctype == "Service Requests":
        previous_state = doc.status

        data["changed"].append(["service_order_list", doc.service_order_list, []])

    elif doc.doctype == "Project Estimates":
        previous_state = ""
        # Format the fields explicitly for Project Estimates
        original_data = {
            "project": doc.project,
            "work_package": doc.work_package,
            "category": doc.category,
            "item": doc.item,
            "item_name": doc.item_name,
            "uom": doc.uom,
            "quantity_estimate": doc.quantity_estimate,
            "rate_estimate": doc.rate_estimate,
            "item_tax": doc.item_tax,
        }
        data["changed"].append(["project_estimate", original_data, []])

    # elif doc.doctype == "Nirmaan User Permissions":
    #     previous_state = ""
    #     # Extract relevant fields for Nirmaan User Permissions
    #     original_data = {
    #         "user": doc.user,
    #         "allow": doc.allow,
    #         "for_value": doc.for_value,
    #     }
    #     data["changed"].append(["user_permissions", original_data, []])

    elif doc.doctype == "Nirmaan Users":
        previous_state = ""
        # Extract relevant fields for Nirmaan Users
        original_data = {
            "first_name": doc.first_name,
            "last_name": doc.last_name,
            "full_name" : doc.full_name,
            "has_project" : doc.has_project,
            "mobile_no": doc.mobile_no,
            "email": doc.email,
            "role_profile": doc.role_profile,
        }
        data["changed"].append(["user_details", original_data, []])

    # If the doctype is not handled, return early
    else:
        return

    # Create the new Nirmaan Versions document
    nv = frappe.new_doc("Nirmaan Versions")
    nv.ref_doctype = doc.doctype
    nv.docname = doc.name
    nv.data = json.dumps(data)  # Ensure data is JSON serializable
    nv.previous_state = previous_state
    nv.new_state = "Deleted"
    nv.insert(ignore_permissions=True)
