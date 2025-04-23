# import frappe
# from frappe.model.document import Document
# from datetime import datetime

# @frappe.whitelist()
# def update_invoice_data(docname: str, invoice_data: dict, invoice_attachment: str = None, isSR: bool = False):
#     """
#     Updates the invoice data for a Procurement Order and optionally adds an invoice attachment.

#     Args:
#         docname (str): Procurement Order ID.
#         invoice_data (dict): Invoice data to append.
#         invoice_attachment (str, optional): URL of uploaded invoice attachment. Defaults to None.
#         isSR (bool, optional): Indicates if the document is a Service Request. Defaults to False.
#     """
#     doctype = "Service Requests" if isSR else "Procurement Orders"
#     try:
#         frappe.db.begin()

#         po = frappe.get_doc(doctype , docname)

#          # Handle invoice attachment
#         if invoice_attachment:
#             attachment = create_attachment_doc(
#                 po,
#                 invoice_attachment,
#                 "po invoice"
#             )
#             if attachment and invoice_data:
#                 invoice_data["invoice_attachment_id"] = attachment.name
#         # Add invoice data
#         add_invoice_history(po, invoice_data)

#         # Save procurement order updates
#         po.save()

#         frappe.db.commit()

#         return {
#             "status": 200,
#             "message": f"Updated invoice data for {docname}",
#         }

#     except Exception as e:
#         frappe.db.rollback()
#         frappe.log_error("Invoice Data Update Error", str(e))
#         return {
#             "status": 400,
#             "message": f"Update failed: {str(e)}",
#             "error": frappe.get_traceback()
#         }

# def add_invoice_history(po, new_data: dict) -> None:
#     """Append new invoice data to existing history"""
#     existing_data = po.get("invoice_data") or {"data": {}}

#     if "data" not in existing_data:
#         existing_data["data"] = {}

#     invoice_date = new_data.get("date")  # Get date from new_data

#     # Remove date field from new_data before merging
#     invoice_data_without_date = {k: v for k, v in new_data.items() if k != "date"}

#     if invoice_date not in existing_data["data"]:
#         existing_data["data"][invoice_date] = invoice_data_without_date
#     else:
#         time_stamp = datetime.now().strftime("%H:%M:%S.%f") # use microseconds to prevent collision.
#         unique_date = f"{invoice_date} {time_stamp}" #combine date and timestamp
#         existing_data["data"][unique_date] = invoice_data_without_date # assign update info with unique date.

#     po.invoice_data = existing_data

# def create_attachment_doc(po, file_url: str, attachment_type: str) -> Document:
#     """Create standardized attachment document"""
#     attachment = frappe.new_doc("Nirmaan Attachments")
#     attachment.update({
#         "project": po.project,
#         "attachment": file_url,
#         "attachment_type": attachment_type,
#         "associated_doctype": po.doctype,
#         "associated_docname": po.name,
#         "attachment_link_doctype": "Vendors",
#         "attachment_link_docname": po.vendor
#     })
#     attachment.insert(ignore_permissions=True)
#     return attachment



import frappe
from frappe.model.document import Document
from datetime import datetime
import json # Import json for cleaner handling if needed, though Frappe often handles it

@frappe.whitelist()
def update_invoice_data(docname: str, invoice_data: str, invoice_attachment: str = None, isSR: bool = False):
    """
    Updates the invoice data for a document (PO or SR), creates an attachment record,
    and generates a corresponding task.

    Args:
        docname (str): The name of the Procurement Order or Service Request document.
        invoice_data (str): JSON string containing the new invoice details (invoice_no, amount, date).
        invoice_attachment (str, optional): URL of the uploaded invoice attachment. Defaults to None.
        isSR (bool, optional): True if the document is a Service Request, False for Procurement Order.
    """
    doctype = "Service Requests" if isSR else "Procurement Orders"

    try:
        # Parse incoming invoice data string
        try:
            new_invoice_entry_data = json.loads(invoice_data)
            if not isinstance(new_invoice_entry_data, dict):
                raise ValueError("invoice_data must be a JSON object string.")
            if not all(k in new_invoice_entry_data for k in ["invoice_no", "amount", "date"]):
                 raise ValueError("Missing required fields in invoice_data (invoice_no, amount, date).")
        except json.JSONDecodeError:
            frappe.throw(f"Invalid JSON format provided for invoice_data: {invoice_data}")
        except ValueError as ve:
            frappe.throw(str(ve))


        # --- Start Transaction ---
        frappe.db.begin()

        doc = frappe.get_doc(doctype, docname)
        attachment_id = None # Initialize attachment_id

        # 1. Handle invoice attachment (if provided)
        if invoice_attachment:
            try:
                attachment = create_attachment_doc(
                    doc,
                    invoice_attachment,
                    # f"{doctype.rstrip('s').lower()} invoice" # e.g., "procurement order invoice" or "service request invoice"
                    "po invoice"
                )
                attachment_id = attachment.name
            except Exception as attach_err:
                frappe.log_error(f"Failed to create attachment for {doctype} {docname}", str(attach_err))
                # Decide if this is critical - perhaps proceed without attachment? For now, we'll throw.
                frappe.throw(f"Failed to process invoice attachment: {str(attach_err)}")

        # 2. Add invoice data to the document's JSON field (including status)
        # Pass the attachment_id to be included in the stored data
        date_key_used = add_invoice_history(doc, new_invoice_entry_data, attachment_id)

        # 3. Create the associated Task
        try:
            create_invoice_task(doc, new_invoice_entry_data, date_key_used)
        except Exception as task_err:
            frappe.log_error(f"Failed to create task for {doctype} {docname}, invoice {new_invoice_entry_data.get('invoice_no')}", str(task_err))
            # Decide if this is critical. For now, we'll throw to ensure consistency.
            frappe.throw(f"Failed to create associated task: {str(task_err)}")


        # 4. Save the main document (PO or SR)
        doc.save(ignore_permissions=True) # Consider permissions if needed

        # --- Commit Transaction ---
        frappe.db.commit()

        return {
            "status": 200,
            "message": f"Successfully updated invoice data and created task for {docname}",
        }

    except Exception as e:
        frappe.db.rollback() # Rollback on any error during the process
        frappe.log_error(title="Invoice Data Update Error", message=frappe.get_traceback())
        # Return a less revealing error message to the frontend
        return {
            "status": 400,
            "message": f"Invoice update failed for {docname}. Please contact support.",
            "error": str(e) # Keep original error for server logs but maybe not return detailed traceback
        }

def add_invoice_history(doc: Document, invoice_entry_data: dict, attachment_id: str = None) -> str:
    """
    Appends new invoice data (with status) to the 'invoice_data' JSON field.
    Returns the actual date key used in the JSON.
    """
    existing_invoice_data = doc.get("invoice_data") or {"data": {}}

    # Ensure the 'data' key exists
    if not isinstance(existing_invoice_data, dict) or "data" not in existing_invoice_data:
         # Attempt to parse if it's a string, otherwise reset
        if isinstance(existing_invoice_data, str):
            try:
                existing_invoice_data = json.loads(existing_invoice_data)
                if "data" not in existing_invoice_data:
                     existing_invoice_data = {"data": {}}
            except json.JSONDecodeError:
                 existing_invoice_data = {"data": {}}
        else:
             existing_invoice_data = {"data": {}}


    invoice_date = invoice_entry_data.get("date")
    if not invoice_date:
        raise ValueError("Date is missing in the provided invoice data.")

    # Prepare the data to be stored in the JSON value field
    data_to_store = {
        "invoice_no": invoice_entry_data.get("invoice_no"),
        "amount": invoice_entry_data.get("amount"),
        "updated_by": invoice_entry_data.get("updated_by", frappe.session.user), # Get user if not passed
        "status": "Pending", # <-- Set default status here
        "invoice_attachment_id": attachment_id # Store the attachment ID
    }
    # Clean up None values if desired
    data_to_store = {k: v for k, v in data_to_store.items() if v is not None}


    # Determine the key, handling potential collisions
    date_key_to_use = invoice_date
    if invoice_date in existing_invoice_data["data"]:
        # Same-day entry collision: Append timestamp for uniqueness
        time_stamp = datetime.now().strftime("%H:%M:%S.%f")
        date_key_to_use = f"{invoice_date}_{time_stamp}" # Use underscore for better readability?

    existing_invoice_data["data"][date_key_to_use] = data_to_store

    # Update the document field (Frappe handles JSON serialization on save)
    doc.set("invoice_data", existing_invoice_data)

    return date_key_to_use # Return the key that was used


def create_attachment_doc(parent_doc: Document, file_url: str, attachment_type: str) -> Document:
    """Creates and inserts a 'Nirmaan Attachments' document."""
    attachment = frappe.new_doc("Nirmaan Attachments")
    attachment.update({
        "project": parent_doc.get("project"), # Get project from parent
        "attachment": file_url,
        "attachment_type": attachment_type,
        "associated_doctype": parent_doc.doctype,
        "associated_docname": parent_doc.name,
        # Link vendor only if it exists on the parent (PO has it, SR might not)
        "attachment_link_doctype": "Vendors" if parent_doc.get("vendor") else None,
        "attachment_link_docname": parent_doc.get("vendor") if parent_doc.get("vendor") else None
    })
    attachment.insert(ignore_permissions=True) # Consider permission model
    return attachment # Return the created document


def create_invoice_task(parent_doc: Document, invoice_entry_data: dict, date_key: str) -> None:
    """Creates a 'Task' document associated with the new invoice entry."""
    task = frappe.new_doc("Task")
    task.update({
        "task_doctype": parent_doc.doctype,
        "task_docname": parent_doc.name,
        "assignee": None, # Assign later based on workflow or manually
        "assignee_role": None,
        "status": "Pending", # Initial status of the Task itself
        # Reference fields linking back to the specific invoice entry
        "reference_name_1": "invoice_date_key", # Name of the key in the JSON
        "reference_value_1": date_key,          # The actual key used (e.g., "2024-01-15" or "2024-01-15_10:30:05.123456")
        "task_type": 'po_invoice_approval',
        "reference_name_2": "invoice_no",
        "reference_value_2": invoice_entry_data.get("invoice_no"),

        # Add amount as reference 3 for easier display in reconciliation table
        "reference_name_3": "invoice_amount",
        "reference_value_3": invoice_entry_data.get("amount")
        # Add more references if needed (e.g., amount, status from invoice_entry_data)
    })
    task.insert(ignore_permissions=True) # Consider permissions
    frappe.msgprint(f"Created Task for Invoice {invoice_entry_data.get('invoice_no')}", indicator="green", alert=True) # Optional: confirmation message


# Assuming other functions like create_attachment_doc, create_invoice_task exist

@frappe.whitelist()
def delete_invoice_entry(docname: str, date_key: str, isSR: bool = False):
    """
    Deletes a specific invoice entry from the invoice_data JSON field,
    the associated 'Nirmaan Attachments' document (if linked),
    and the corresponding 'Task' document.

    Args:
        docname (str): The name of the Procurement Order or Service Request document.
        date_key (str): The exact key (date or date_timestamp) of the invoice entry to delete.
        isSR (bool, optional): True if the document is a Service Request, False for Procurement Order.
    """
    doctype = "Service Requests" if isSR else "Procurement Orders"

    if not docname or not date_key:
        frappe.throw("Document Name and Date Key are required.")

    try:
        # --- Start Transaction ---
        frappe.db.begin()

        doc = frappe.get_doc(doctype, docname)
        existing_invoice_data = doc.get("invoice_data")

        # Validate invoice_data structure
        if not isinstance(existing_invoice_data, dict) or "data" not in existing_invoice_data or not isinstance(existing_invoice_data.get("data"), dict):
             # Attempt to parse if string
             if isinstance(existing_invoice_data, str):
                 try:
                     existing_invoice_data = json.loads(existing_invoice_data)
                     if not isinstance(existing_invoice_data, dict) or "data" not in existing_invoice_data or not isinstance(existing_invoice_data.get("data"), dict):
                          raise ValueError("Invalid structure after parsing.")
                 except (json.JSONDecodeError, ValueError):
                      frappe.log_error(f"Invalid or missing invoice_data structure for {doctype} {docname}", frappe.get_traceback())
                      frappe.throw(f"Invoice data format is incorrect for {docname}.")
             else:
                  frappe.log_error(f"Invalid or missing invoice_data structure for {doctype} {docname}", frappe.get_traceback())
                  frappe.throw(f"Invoice data format is incorrect for {docname}.")


        invoice_data_dict = existing_invoice_data["data"]

        # Check if the entry exists
        if date_key not in invoice_data_dict:
            frappe.throw(f"Invoice entry with key '{date_key}' not found in {docname}.")

        # Get entry details before deleting it
        entry_to_delete = invoice_data_dict[date_key]
        attachment_id_to_delete = entry_to_delete.get("invoice_attachment_id")
        invoice_no_deleted = entry_to_delete.get("invoice_no", "N/A") # For logging/messaging

        # 1. Delete the associated 'Nirmaan Attachments' document (if exists)
        if attachment_id_to_delete:
            try:
                frappe.delete_doc("Nirmaan Attachments", attachment_id_to_delete, ignore_permissions=True, force=True)
                frappe.msgprint(f"Deleted attachment: {attachment_id_to_delete}", indicator="gray", alert=True) # Optional debug msg
            except frappe.DoesNotExistError:
                frappe.log_error(title="Attachment Deletion Warning", message=f"Attachment {attachment_id_to_delete} linked in invoice data for {docname} not found.")
            except Exception as e:
                frappe.log_error(f"Failed to delete attachment {attachment_id_to_delete}", frappe.get_traceback())
                # Decide if this is critical. Let's throw for now to maintain consistency.
                frappe.throw(f"Failed to delete associated attachment: {str(e)}")


        # 2. Delete the associated 'Task' document
        #    Find task using the reference fields we set during creation
        try:
            task_names = frappe.get_all("Task", filters={
                "task_doctype": doctype,
                "task_docname": docname,
                "reference_name_1": "invoice_date_key",
                "reference_value_1": date_key
            }, pluck="name")

            if task_names:
                for task_name in task_names:
                    frappe.delete_doc("Task", task_name, ignore_permissions=True, force=True)
                    frappe.msgprint(f"Deleted associated task: {task_name}", indicator="gray", alert=True) # Optional debug msg
            else:
                frappe.log_error(f"Task Deletion Warning", f"No associated task found for {doctype} {docname} with date key {date_key}.")

        except Exception as e:
            frappe.log_error(f"Failed to delete associated task for invoice key {date_key}", frappe.get_traceback())
            # Decide if this is critical. Let's throw for now.
            frappe.throw(f"Failed to delete associated task: {str(e)}")

        # 3. Delete the invoice entry from the dictionary
        del invoice_data_dict[date_key]

        # 4. Update the field on the document
        #    Important: Use doc.set() which marks the document as dirty
        doc.set("invoice_data", existing_invoice_data)

        # 5. Save the parent document
        doc.save(ignore_permissions=True) # Save changes to PO/SR

        # --- Commit Transaction ---
        frappe.db.commit()

        return {
            "status": 200,
            "message": f"Successfully deleted invoice entry (Inv No: {invoice_no_deleted}) and associated records for {docname}",
        }

    except Exception as e:
        frappe.db.rollback() # Rollback on any error
        frappe.log_error(title="Invoice Entry Deletion Error", message=frappe.get_traceback())
        return {
            "status": 400,
            "message": f"Invoice entry deletion failed for {docname}. Please contact support.",
            "error": str(e) # Keep original error for server logs
        }