import json
import frappe

def generate_versions(doc, method):
    # Determine the doctype and dynamically set fields
    previous_state = None
    data = {"added": [], "changed": [], "data_import": None, "removed": [], "row_changed": [], "updater_reference": None}
    
    # Mapping for handling specific doctypes
    if doc.doctype == "Procurement Requests":
        previous_state = doc.workflow_state

        pr_details = {
            "project": doc.project,
            "work_package": doc.work_package,
            "owner": doc.owner,
        }

        data["changed"].append(["procurement_list", doc.procurement_list, []])

        data["changed"].append(["category_list", doc.category_list, []])

        data["changed"].append(["pr_details", pr_details, []])
    
    elif doc.doctype == "Project Payments":
        previous_state = doc.status

        payment_details = {
            "project": doc.project,
            "document_type": doc.document_type,
            "document_name": doc.document_name,
            "vendor": doc.vendor,
            "amount": doc.amount,
            "payment_date": doc.payment_date,
            "utr": doc.utr,
            "tds": doc.tds,
            "owner": doc.owner,
        }

        data["changed"].append(["payment_details", payment_details, []])

    elif doc.doctype == "Procurement Orders":
        previous_state = doc.status

        po_details = {
            "procurement_request": doc.procurement_request,
            "project": doc.project,
            "project_name": doc.project_name,
            "project_address": doc.project_address,
            "vendor": doc.vendor,
            "vendor_name": doc.vendor_name,
            "vendor_address": doc.vendor_address,
            "vendor_gst": doc.vendor_gst,
            "merged": doc.merged,
            "advance": doc.advance,
            "loading_charges": doc.loading_charges,
            "freight_charges": doc.freight_charges,
            "notes": doc.notes,
            "owner": doc.owner,
        }

        data["changed"].append(["order_list", doc.order_list, []])

        data["changed"].append(["po_details", po_details, []])

    elif doc.doctype == "Service Requests":
        previous_state = doc.status

        data["changed"].append(["service_order_list", doc.service_order_list, []])

        sr_details = {
            "project" : doc.project,
            "vendor" : doc.vendor,
            "notes": doc.notes,
            "gst": doc.gst,
            "owner": doc.owner,
        }

        data["changed"].append(["sr_details", sr_details, []])

        data["changed"].append(["service_category_list", doc.service_category_list, []])

    elif doc.doctype == "Sent Back Category":
        previous_state = doc.workflow_state

        sb_details = {
            "project" : doc.project,
            "type" : doc.type,
            "owner": doc.owner,
            "procurement_request": doc.procurement_request,
        }

        data["changed"].append(["item_list", doc.item_list, []])

        data["changed"].append(["sb_details", sb_details, []])

        data["changed"].append(["category_list", doc.category_list, []])

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
            "owner": doc.owner,
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
            "owner": doc.owner,
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
