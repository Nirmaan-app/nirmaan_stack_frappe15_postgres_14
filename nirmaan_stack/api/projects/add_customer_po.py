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