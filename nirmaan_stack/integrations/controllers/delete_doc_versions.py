import json
import frappe
from frappe.utils import format_datetime, format_date # Import formatters

def generate_versions(doc, method):
    # Determine the doctype and dynamically set fields
    previous_state = None
    data = {"added": [], "changed": [], "data_import": None, "removed": [], "row_changed": [], "updater_reference": None}
    
    # Helper function to convert datetime/date objects in a dictionary to strings
    def serialize_dates(data_dict):
        if not isinstance(data_dict, dict):
            return data_dict
        
        serialized = {}
        for key, value in data_dict.items():
            if hasattr(value, 'isoformat'): # Checks for datetime.date, datetime.datetime
                serialized[key] = value.isoformat()
            elif isinstance(value, dict):
                serialized[key] = serialize_dates(value) # Recursively serialize nested dicts
            elif isinstance(value, list):
                serialized[key] = [serialize_dates(item) for item in value] # Recursively serialize items in lists
            else:
                serialized[key] = value
        return serialized

    # Mapping for handling specific doctypes
    if doc.doctype == "Procurement Requests":
        previous_state = doc.workflow_state
        pr_details = {
            "project": doc.project,
            "work_package": doc.work_package,
            "owner": doc.owner,
            "creation": doc.creation, # This will be handled by serialize_dates
            "modified": doc.modified, # This will be handled by serialize_dates
        }
        # JSON fields are usually already strings or dicts/lists that json.dumps can handle
        # but if they contain nested datetime objects, serialize_dates would catch them too.
        data["changed"].append(["procurement_list", doc.procurement_list, []])
        data["changed"].append(["category_list", doc.category_list, []])
        data["changed"].append(["pr_details", serialize_dates(pr_details), []])
    
    elif doc.doctype == "Project Payments":
        previous_state = doc.status
        payment_details = {
            "project": doc.project,
            "document_type": doc.document_type,
            "document_name": doc.document_name,
            "vendor": doc.vendor,
            "amount": doc.amount,
            "payment_date": doc.payment_date, # Let serialize_dates handle this
            "utr": doc.utr,
            "tds": doc.tds,
            "owner": doc.owner,
            "creation": doc.creation,         # Let serialize_dates handle this
            "modified": doc.modified,       # Let serialize_dates handle this
        }
        data["changed"].append(["payment_details", serialize_dates(payment_details), []])

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
            "creation": doc.creation,       # Let serialize_dates handle this
            "modified": doc.modified,     # Let serialize_dates handle this
        }
        data["changed"].append(["order_list", doc.order_list, []])
        data["changed"].append(["po_details", serialize_dates(po_details), []])

    # ... (similar changes for other doctypes if they include date/datetime fields) ...
    # Example for Service Requests:
    elif doc.doctype == "Service Requests":
        previous_state = doc.status
        data["changed"].append(["service_order_list", doc.service_order_list, []])
        sr_details = {
            "project" : doc.project,
            "vendor" : doc.vendor,
            "notes": doc.notes,
            "gst": doc.gst,
            "owner": doc.owner,
            "creation": doc.creation,    # Let serialize_dates handle this
            "modified": doc.modified,  # Let serialize_dates handle this
        }
        data["changed"].append(["sr_details", serialize_dates(sr_details), []])
        data["changed"].append(["service_category_list", doc.service_category_list, []])

    # Example for Sent Back Category:
    elif doc.doctype == "Sent Back Category":
        previous_state = doc.workflow_state
        sb_details = {
            "project" : doc.project,
            "type" : doc.type,
            "owner": doc.owner,
            "procurement_request": doc.procurement_request,
            "creation": doc.creation,    # Let serialize_dates handle this
            "modified": doc.modified,  # Let serialize_dates handle this
        }
        data["changed"].append(["item_list", doc.item_list, []])
        data["changed"].append(["sb_details", serialize_dates(sb_details), []])
        data["changed"].append(["category_list", doc.category_list, []])
        
    # Ensure Project Estimates also serializes dates if needed
    elif doc.doctype == "Project Estimates":
        previous_state = ""
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
            "creation": doc.creation,    # Let serialize_dates handle this
            "modified": doc.modified,  # Let serialize_dates handle this
        }
        data["changed"].append(["project_estimate", serialize_dates(original_data), []])

    # Ensure Nirmaan Users also serializes dates if needed (e.g., if you add last_login, etc.)
    elif doc.doctype == "Nirmaan Users":
        previous_state = ""
        original_data = {
            "first_name": doc.first_name,
            "last_name": doc.last_name,
            "full_name" : doc.full_name,
            "has_project" : doc.has_project,
            "mobile_no": doc.mobile_no,
            "email": doc.email,
            "role_profile": doc.role_profile,
            "owner": doc.owner,
            "creation": doc.creation,    # Let serialize_dates handle this
            "modified": doc.modified,  # Let serialize_dates handle this
        }
        data["changed"].append(["user_details", serialize_dates(original_data), []])
    
    else:
        # If the doctype is not handled, log it and return early to prevent errors
        # Or, if you want a generic versioning, create a generic data structure
        frappe.log(f"Versioning not specifically handled for doctype: {doc.doctype}. Only basic info will be stored if a generic fallback is added.")
        # Example generic fallback (captures basic fields, but may miss crucial data):
        # generic_details = {
        #     "owner": doc.owner,
        #     "creation": doc.creation,
        #     "modified": doc.modified,
        #     # Add any other common fields you want to capture generically
        # }
        # data["changed"].append([f"{doc.doctype.lower().replace(' ', '_')}_details", serialize_dates(generic_details), []])
        # previous_state = doc.get("status") or doc.get("workflow_state") or "" # Try to get a common status field
        # If you decide not to version unhandled doctypes:
        return


    # Create the new Nirmaan Versions document
    nv = frappe.new_doc("Nirmaan Versions")
    nv.ref_doctype = doc.doctype
    nv.docname = doc.name
    
    # The `data` dictionary itself should now be fully JSON serializable
    # because serialize_dates has converted all datetime objects within the *values* of data["changed"] lists.
    nv.data = json.dumps(data) 
    
    nv.previous_state = previous_state
    nv.new_state = "Deleted" # Since this hook is on_trash or on_cancel
    
    try:
        nv.insert(ignore_permissions=True)
        # frappe.db.commit() # Usually not needed here as on_trash/on_cancel are within a transaction
    except Exception as e:
        frappe.log_error(f"Failed to insert Nirmaan Version for {doc.doctype} {doc.name}: {e}", frappe.get_traceback())
        # Decide if you want to re-raise the error to potentially stop the delete operation
        # raise