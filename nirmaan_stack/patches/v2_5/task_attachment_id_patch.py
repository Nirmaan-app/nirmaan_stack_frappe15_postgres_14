import frappe
from frappe.utils import cint, cstr # Use Frappe utils for safe type conversion if needed
import json

# --- Configuration ---
TASK_DOCTYPE = "Task"
PO_DOCTYPE = "Procurement Orders"
SR_DOCTYPE = "Service Requests"
TARGET_TASK_TYPE = "po_invoice_approval" # The specific task type to process
REF_NAME_4_VALUE = "invoice_attachment_id"
BATCH_SIZE = 50  # Commit after processing this many tasks

def execute():
    """
    Patch Task documents of type 'po_invoice_approval' to populate
    reference_name_4 and reference_value_4 with invoice attachment details.
    """
    frappe.log_error(title="Task Invoice Attachment Patch", message="Starting patch execution.")

    processed_tasks = 0
    updated_tasks = 0
    skipped_missing_ref_key = 0
    skipped_doc_not_found = 0
    skipped_no_invoice_data = 0
    skipped_invoice_key_not_found = 0
    skipped_no_attachment_id = 0
    error_tasks = 0

    # Fetch Tasks that need updating:
    # - Must be the correct task_type
    # - reference_value_4 should be empty/null (makes the patch idempotent)
    # - Must have a reference_value_1 (invoice date key)
    tasks_to_process = frappe.get_all(
        TASK_DOCTYPE,
        filters={
            "task_type": TARGET_TASK_TYPE,
            "reference_value_1": ["is", "set"],
            "reference_value_4": ["is", "not set"], # Ensures idempotency
        },
        fields=[
            "name",
            "task_doctype",
            "task_docname",
            "reference_value_1", # This is the invoice date key
            "reference_name_4",  # Check if name is also unset (optional)
        ]
    )

    total_tasks_to_process = len(tasks_to_process)
    frappe.log_error(title="Task Invoice Attachment Patch", message=f"Found {total_tasks_to_process} tasks potentially needing update.")

    for task in tasks_to_process:
        processed_tasks += 1
        task_name = task.get("name")
        task_doctype = task.get("task_doctype")
        task_docname = task.get("task_docname")
        invoice_date_key = task.get("reference_value_1") # Key to lookup in invoice_data

        try:
            # --- Basic Sanity Checks ---
            if not task_doctype or task_doctype not in [PO_DOCTYPE, SR_DOCTYPE]:
                frappe.log_error(title="Task Patch Skip", message=f"Task {task_name}: Invalid task_doctype '{task_doctype}'.")
                skipped_missing_ref_key += 1 # Reusing counter, adjust if needed
                continue

            if not task_docname:
                frappe.log_error(title="Task Patch Skip", message=f"Task {task_name}: Missing task_docname.")
                skipped_missing_ref_key += 1
                continue

            if not invoice_date_key:
                # This shouldn't happen due to the filter, but good practice to check
                frappe.log_error(title="Task Patch Skip", message=f"Task {task_name}: Missing reference_value_1 (invoice date key).")
                skipped_missing_ref_key += 1
                continue

            # --- Fetch Related Document (PO or SR) ---
            try:
                related_doc = frappe.get_doc(task_doctype, task_docname)
                invoice_data_json = related_doc.get("invoice_data")
            except frappe.DoesNotExistError:
                frappe.log_error(title="Task Patch Skip", message=f"Task {task_name}: Related document {task_doctype}/{task_docname} not found.")
                skipped_doc_not_found += 1
                continue
            except Exception as e:
                 frappe.log_error(title="Task Patch Error", message=f"Task {task_name}: Error fetching related doc {task_doctype}/{task_docname}. Error: {e}")
                 error_tasks += 1
                 continue


            # --- Process Invoice Data ---
            if not invoice_data_json:
                # frappe.log_error(title="Task Patch Info", message=f"Task {task_name}: No invoice_data found in {task_doctype}/{task_docname}.")
                skipped_no_invoice_data += 1
                continue

            try:
                # invoice_data field is often stored as a JSON string containing another object with a "data" key
                invoice_data_outer = frappe.parse_json(invoice_data_json)
                # Ensure the expected structure { "data": { ... } } exists
                invoice_data_inner = invoice_data_outer.get("data") if isinstance(invoice_data_outer, dict) else None
            except (json.JSONDecodeError, TypeError) as e:
                frappe.log_error(title="Task Patch Error", message=f"Task {task_name}: Failed to parse invoice_data JSON for {task_doctype}/{task_docname}. Error: {e}. Data: {invoice_data_json}")
                error_tasks += 1
                continue

            if not invoice_data_inner or not isinstance(invoice_data_inner, dict):
                # frappe.log_error(title="Task Patch Info", message=f"Task {task_name}: Parsed invoice_data is missing 'data' key or is not a dict in {task_doctype}/{task_docname}.")
                skipped_no_invoice_data += 1
                continue

            # --- Find the Specific Invoice by Date Key ---
            invoice_details = invoice_data_inner.get(invoice_date_key)

            if not invoice_details or not isinstance(invoice_details, dict):
                # frappe.log_error(title="Task Patch Info", message=f"Task {task_name}: Invoice details not found for key '{invoice_date_key}' in {task_doctype}/{task_docname}.")
                skipped_invoice_key_not_found += 1
                continue

            # --- Extract Attachment ID ---
            invoice_attachment_id = invoice_details.get("invoice_attachment_id")

            if not invoice_attachment_id:
                # frappe.log_error(title="Task Patch Info", message=f"Task {task_name}: 'invoice_attachment_id' not found within invoice details for key '{invoice_date_key}' in {task_doctype}/{task_docname}.")
                skipped_no_attachment_id += 1
                continue

            # --- Update the Task Document ---
            # Use frappe.db.set_value for efficiency when updating few fields
            update_values = {
                "reference_name_4": REF_NAME_4_VALUE,
                "reference_value_4": cstr(invoice_attachment_id) # Ensure it's a string
            }
            frappe.db.set_value(TASK_DOCTYPE, task_name, update_values)
            updated_tasks += 1

            # Commit periodically to avoid large transactions and release locks
            if updated_tasks % BATCH_SIZE == 0:
                frappe.db.commit()
                frappe.log_error(title="Task Invoice Attachment Patch", message=f"Committed batch, {updated_tasks}/{total_tasks_to_process} tasks potentially updated.")

        except Exception as e:
            error_tasks += 1
            frappe.log_error(
                message=f"Failed processing Task {task_name}: {frappe.get_traceback()}",
                title="Task Invoice Attachment Patch Error"
            )
            # Optionally rollback if you added task-specific transaction handling
            # frappe.db.rollback()

    # Final commit for any remaining updates
    frappe.db.commit()

    # --- Log Summary ---
    summary_message = (
        f"Patch finished. Processed: {processed_tasks}. "
        f"Updated: {updated_tasks}. "
        f"Skipped (Missing Ref/Doc): {skipped_missing_ref_key + skipped_doc_not_found}. "
        f"Skipped (No Invoice Data/Key): {skipped_no_invoice_data + skipped_invoice_key_not_found}. "
        f"Skipped (No Attach ID): {skipped_no_attachment_id}. "
        f"Errors: {error_tasks}."
    )
    frappe.log_error(title="Task Invoice Attachment Patch Summary", message=summary_message)

# To run this patch:
# 1. Save it as a .py file (e.g., `update_task_invoice_refs.py`) within an app's `patches` directory (e.g., `your_app/patches/v1_0/update_task_invoice_refs.py`). Add an entry in `patches.txt`.
#    OR
# 2. Run it directly using the bench: `bench --site your_site_name execute path.to.your.script.execute`