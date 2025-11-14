import frappe
from frappe.utils import get_url

# === IMPORTANT: Verify the name of your Child Doctype ===
# This is the name Frappe gives to the child table created by the 'customer_po_details' field.
# You must check your Frappe installation's Doctype list for the exact name (e.g., 'Projects Customer PO Detail').
CHILD_DOCTYPE_NAME = "Customer PO Child Table" 
# =======================================================

@frappe.whitelist()
def add_customer_po_with_validation(project_name, new_po_detail):
    """
    Adds a new Customer PO to the Projects doctype after checking for duplicate PO Numbers
    globally (across all projects/child table records).
    
    :param project_name: The name of the Projects document (parent).
    :param new_po_detail: A dictionary containing the new PO details to add.
    """
    
    # 1. Fetch the existing Project document
    try:
        project_doc = frappe.get_doc("Projects", project_name)
    except frappe.DoesNotExistError:
        frappe.throw(f"Project with name {project_name} not found.", title="Validation Error")
        
    po_number = new_po_detail.get('customer_po_number')
    
    if not po_number:
        frappe.throw("Customer PO Number is mandatory.", title="Validation Error")

    # 2. GLOBAL Validation: Check for duplicate PO Number across ALL child table records
    
    try:
        # Use frappe.get_all with limit=1 to efficiently check for existence
        # We only need the 'name' field, which is the smallest to fetch.
        duplicate_pos = frappe.get_all(
            CHILD_DOCTYPE_NAME, 
            filters={"customer_po_number": po_number},
            fields=["name"], # Fetch only the name field
            limit=1         # Stop after finding the first one
        )
    except Exception as e:
        frappe.log_error(title="PO Detail Doctype Error", message=f"Could not query Doctype '{CHILD_DOCTYPE_NAME}'. Check if the name is correct. Error: {str(e)}")
        frappe.throw(f"Database error during PO number check. (Check server logs)", title="System Error")

    if len(duplicate_pos) > 0:
        return {"status":"Duplicate"}

    # 3. Add the new PO detail to the child table
    # The new_po_detail is a dictionary matching the child doctype fields.
    project_doc.append("customer_po_details", new_po_detail)
    
    # 4. Save the document
    try:
        # Saving the document will also save the new child table entry
        project_doc.save()
        frappe.db.commit() # Commit the transaction
        
        return {"message": "Customer PO added successfully.", "project_doc": project_doc.as_dict()}
    except Exception as e:
        frappe.log_error(title="Project PO Save Error", message=str(e))
        # Throw error to be caught by the client-side
        frappe.throw(f"Failed to save Project document: {str(e)}", title="Database Error")

import frappe
from frappe.utils import cint, flt
from frappe import _

# --- HELPER FUNCTION FOR FRACTIONAL/ERROR RESPONSE ---
def set_error_response(message, status_code=417):
    """Sets the frappe.response object (which is a dict) for an error."""
    frappe.response["message"] = message
    frappe.response["exc_type"] = "Exception"
    frappe.response["_server_messages"] = frappe.message_log or []
    frappe.response["http_status_code"] = status_code
    return frappe.response

# --- HELPER FUNCTION FOR SUCCESS RESPONSE ---
def set_success_response(message_data, status_code=200):
    """Sets the frappe.response object (which is a dict) for a successful return."""
    # Ensure message_data is a dict to be updated/returned
    if isinstance(message_data, str):
        message_data = {"message": message_data}
        
    frappe.response.update(message_data)
    frappe.response["http_status_code"] = status_code
    return frappe.response

# --- THE MAIN FUNCTION ---
@frappe.whitelist()
def update_customer_po_with_validation(project_name, updated_po_detail):
    
    # ------------------ START VALIDATION AND INITIAL CHECKS ------------------
    
    # Check 2: Input Existence and Format
    if not updated_po_detail or not isinstance(updated_po_detail, dict):
        return set_error_response(_("Invalid or missing PO detail data."))
        
    current_row_name = updated_po_detail.get('name')
    if not current_row_name:
        return set_error_response(_("Child row name is missing for update operation."))
        
    # Check 3: Business Logic / Field Validation
    po_number = updated_po_detail.get('customer_po_number')
    po_incl_tax = flt(updated_po_detail.get('customer_po_value_inctax', 0))
    po_creation_date = updated_po_detail.get('customer_po_creation_date')

    if not po_number or not str(po_number).strip():
        return set_error_response(_("PO Number is a required field."))
    if not po_creation_date:
        return set_error_response(_("PO Date is a required field."))
    if po_incl_tax <= 0:
        return set_error_response(_("PO Value (Incl. Tax) must be greater than zero."))

    po_link = updated_po_detail.get('customer_po_link')
    po_attachment = updated_po_detail.get('customer_po_attachment')
    if not po_link and not po_attachment:
        return set_error_response(_("Either a PO Link or a PO Attachment must be provided."))
        
    # ------------------- END VALIDATION AND INITIAL CHECKS -------------------

    try:
        # 1. Fetch the parent DocType (frappe.get_doc also does the permission check implicitly)
        project = frappe.get_doc("Projects", project_name)
        
        # 2. PERFORM UNIQUENESS CHECK WITHOUT SQL
        # Check if the updated PO Number already exists in the list (excluding the current row)
        for row in project.customer_po_details:
            # We check for a match AND ensure the row found is NOT the one we are currently updating
            if row.customer_po_number == po_number and row.name != current_row_name:
                 return set_success_response({"status": "Duplicate"}) # Use your custom status
        
        
        # 3. Get the specific child row document using the correct list comprehension (FIX for AttributeError)
        # We iterate over the child list to find the element by its 'name'
        updated_row = next((row for row in project.customer_po_details if row.name == current_row_name), None)
        
        if not updated_row:
             return set_error_response(_("Customer PO row not found for the given ID."))

        # 4. Update ONLY the incoming values
        for key, value in updated_po_detail.items():
            # Exclude control fields
            if key not in ["name", "idx", "parent", "parentfield", "doctype"]: 
                 setattr(updated_row, key, value)
        
        # 5. Save the parent document, committing the child row changes
        # This will also trigger the DocType's validate method
        project.save()
        frappe.db.commit()

        # Success Response
        return set_success_response({"status": "Success"})

    except frappe.exceptions.DuplicateEntryError:
        # Fallback in case DocType validation catches a different duplicate scenario
        return set_success_response({"status": "Duplicate"})
        
    except Exception as e:
        # --- Error Handling (Fixed) ---
        traceback_message = frappe.get_traceback()
        frappe.log_error(title="Customer PO Update Error", message=traceback_message)
        print(f"--- Customer PO Update Error Traceback ---\n{traceback_message}\n------------------------------------------")
        
        return set_error_response(f"An unexpected error occurred during PO update: {e}")





@frappe.whitelist()
def delete_customer_po(project_name, po_doc_name):
    """
    Deletes a specific child row (Customer PO Detail) from the parent Project document.

    :param project_name: The name of the parent 'Projects' document.
    :param po_doc_name: The 'name' (ID) of the child row to delete.
    """
    
    # 1. Validation and Security Checks (RETAINED)
    if not project_name or not po_doc_name:
        frappe.throw(_("Project Name and Customer PO ID are required for deletion."), title=_("Missing Data"))

    if not frappe.has_permission("Projects", "write", project_name):
        frappe.throw(_("You do not have permission to delete Customer POs from this project."), title=_("Permission Error"))

    try:
        # 2. Fetch the parent Project document
        project = frappe.get_doc("Projects", project_name)
        
        # 3. Find the child row document object in the list (FIX for AttributeError)
        # Use a generator expression with next() to find the row by its 'name'
        item_to_remove = next((item for item in project.customer_po_details if item.name == po_doc_name), None)
        
        if not item_to_remove:
            frappe.throw(_("Customer PO with ID {0} not found in project {1}.").format(po_doc_name, project_name), title=_("Not Found"))

        # 4. Remove the found item from the parent DocType
        # The project.remove() method takes the actual object to remove
        project.remove(item_to_remove)
        
        # 5. Save the parent document to commit the change
        project.save()
        frappe.db.commit()

        # 6. Success Response
        return {"message": f"Customer PO {po_doc_name} successfully deleted.", "status": "Success"}

    except frappe.DoesNotExistError:
        frappe.throw(_("Project not found."), title=_("Not Found"))
    
    except Exception as e:
        # Log the error and return a generic message (as per original logic)
        traceback_message = frappe.get_traceback()
        frappe.log_error(title="Customer PO Deletion Failed", message=traceback_message)
        
        # Re-raising the Validation Error as requested in the traceback
        frappe.throw(_("Failed to delete Customer PO due to an unexpected error."), title=_("Deletion Error"))