import frappe
from frappe.model.document import Document
import json

@frappe.whitelist()
def update_invoice_task_status(task_id: str, new_task_status: str):
    """
    Updates the status of an invoice approval task and the corresponding
    invoice entry status in the parent document's invoice_data JSON field.
    Also updates the assignee details on the task.

    Args:
        task_id (str): The name/ID of the Task document to update.
        new_task_status (str): The new status for the task ("Approved" or "Rejected").

    Returns:
        dict: Success or error message.
    """
    if new_task_status not in ["Approved", "Rejected"]:
        frappe.throw(f"Invalid status provided: {new_task_status}. Must be 'Approved' or 'Rejected'.")

    if not task_id:
        frappe.throw("Task ID is required.")

    # --- Get Current User Info ---
    current_user = frappe.session.user
    if current_user == "Guest":
         frappe.throw("You must be logged in to perform this action.")

    try:
        # Fetch user details (assuming 'Nirmaan Users' DocType and 'role_profile' field exist)
        if current_user == "Administrator":
            assignee_name = None
            assignee_role = None
        else:
          user_doc = frappe.get_doc("Nirmaan Users", current_user)
          assignee_name = user_doc.name # Or user_doc.full_name if preferred
          assignee_role = user_doc.role_profile
    except frappe.DoesNotExistError:
        # Fallback or stricter error handling
        frappe.log_error(f"Task Update Warning", f"Nirmaan Users document not found for user: {current_user}")
        assignee_name = current_user
        assignee_role = "Nirmaan Admin Profile" # Or fetch from standard User doc if applicable
        # frappe.throw(f"User profile 'Nirmaan Users' not found for {current_user}.")

    try:
        # --- Start Transaction ---
        frappe.db.begin()

        # 1. Get the Task document
        task = frappe.get_doc("Task", task_id)

        # Basic validation
        if task.status != "Pending":
            frappe.throw(f"Task {task_id} is not in 'Pending' status. Current status: {task.status}")
        if task.task_type != "po_invoice_approval":
             frappe.throw(f"Task {task_id} is not an invoice approval task.")

        # Extract necessary info from task
        parent_doctype = task.task_doctype
        parent_docname = task.task_docname
        date_key = task.reference_value_1 # Key to find invoice entry in JSON

        if not parent_doctype or not parent_docname or not date_key:
            frappe.throw(f"Task {task_id} is missing necessary reference information (doctype, docname, or date_key).")

        # 2. Get the Parent Document (PO or SR)
        parent_doc = frappe.get_doc(parent_doctype, parent_docname)
        existing_invoice_data = parent_doc.get("invoice_data")

        # Validate and parse invoice_data JSON
        invoice_data_dict = {}
        if isinstance(existing_invoice_data, str):
            try:
                parsed_data = json.loads(existing_invoice_data)
                if isinstance(parsed_data, dict) and "data" in parsed_data and isinstance(parsed_data["data"], dict):
                    invoice_data_dict = parsed_data["data"]
                else:
                    raise ValueError("Parsed JSON lacks 'data' dictionary.")
            except (json.JSONDecodeError, ValueError) as e:
                frappe.log_error(f"Failed to parse invoice_data for {parent_doctype} {parent_docname}", frappe.get_traceback())
                frappe.throw(f"Invalid invoice data format in {parent_docname}.")
        elif isinstance(existing_invoice_data, dict) and "data" in existing_invoice_data and isinstance(existing_invoice_data["data"], dict):
            invoice_data_dict = existing_invoice_data["data"]
        else:
             # Handle case where invoice_data is missing or completely malformed
             frappe.log_error(f"Missing or malformed invoice_data for {parent_doctype} {parent_docname}", frappe.get_traceback())
             frappe.throw(f"Invoice data is missing or incorrectly structured in {parent_docname}.")


        # 3. Find and Update the Specific Invoice Entry in JSON
        if date_key not in invoice_data_dict:
            frappe.throw(f"Invoice entry with key '{date_key}' not found in {parent_docname}'s invoice data.")

        # Update the status within the JSON entry
        invoice_data_dict[date_key]["status"] = new_task_status
        # Optional: Add approved/rejected by info
        # invoice_data_dict[date_key]["processed_by"] = assignee_name
        # invoice_data_dict[date_key]["processed_on"] = frappe.utils.now()

        # Set the modified dictionary back (important!)
        parent_doc.set("invoice_data", {"data": invoice_data_dict}) # Ensure the structure {"data": ...} is maintained

        # 4. Update the Task Document
        task.status = new_task_status
        task.assignee = assignee_name
        task.assignee_role = assignee_role
        # Optional: Add completion timestamp?
        # task.completed_on = frappe.utils.now()

        # 5. Save Both Documents
        parent_doc.save(ignore_permissions=True) # Save PO/SR
        task.save(ignore_permissions=True)       # Save Task

        # --- Commit Transaction ---
        frappe.db.commit()

        return {
            "status": 200,
            "message": f"Task {task_id} status updated to '{new_task_status}' and corresponding invoice entry modified.",
        }

    except Exception as e:
        frappe.db.rollback() # Rollback on any error
        frappe.log_error(title="Invoice Task Status Update Error", message=frappe.get_traceback())
        return {
            "status": 400,
            "message": f"Failed to update task {task_id}. Please contact support.",
            "error": str(e)
        }