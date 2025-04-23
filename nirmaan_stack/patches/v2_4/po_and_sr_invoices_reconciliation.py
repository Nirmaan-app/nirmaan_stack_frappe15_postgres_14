# -*- coding: utf-8 -*-
# Frappe Patch: Update Existing Invoice Data (PO & SR) and Create Historical Tasks
# Run this using: bench --site [your.site.name] execute [path.to.this.file]

import frappe
from frappe.utils import now
import json

def execute():
    """
    Patch script to:
    1. Iterate through Procurement Orders and Service Requests with existing `invoice_data`.
    2. Update each entry within `invoice_data.data` to include a `status` of "Approved".
    3. Create a corresponding 'Task' document for each historical invoice entry,
       also marked as "Approved", assigned to admins@nirmaan.app.
    """
    frappe.db.auto_commit_on_many_writes = 1 # Optimize for many writes

    # --- Configuration ---
    DOCTYPES_TO_PROCESS = ["Procurement Orders", "Service Requests"]
    DEFAULT_ASSIGNEE = "admins@nirmaan.app"
    DEFAULT_ASSIGNEE_ROLE = "Nirmaan Admin Profile"
    # Assuming the same task type for both PO and SR invoices.
    # If different, you might need logic inside the loop based on current_doctype.
    TASK_TYPE = "po_invoice_approval"
    APPROVED_STATUS = "Approved"
    # Unique ID for this combined patch
    PATCH_ID = "PATCH-2024-07-29-5-UpdateInvoiceHistoryAndTasks-PO-SR"

    # Check if patch has already run
    if frappe.db.exists("Patch Log", PATCH_ID):
        frappe.msgprint(f"Patch '{PATCH_ID}' already applied. Skipping.")
        return

    frappe.msgprint(f"Starting Patch: {PATCH_ID}")
    frappe.msgprint(f"Processing Doctypes: {', '.join(DOCTYPES_TO_PROCESS)}")

    # --- Aggregated Statistics ---
    total_docs_checked_all = 0
    total_processed_docs_all = 0
    total_updated_invoices_all = 0
    total_created_tasks_all = 0
    total_skipped_docs_all = 0
    total_error_docs_list = [] # List to hold errors from all doctypes

    # --- Loop through specified Doctypes ---
    for current_doctype in DOCTYPES_TO_PROCESS:
        frappe.msgprint("-" * 20)
        frappe.msgprint(f"Processing Doctype: {current_doctype}")
        frappe.msgprint("-" * 20)

        # Reset counters for the current doctype
        processed_docs_current = 0
        updated_invoices_current = 0
        created_tasks_current = 0
        skipped_docs_current = 0
        error_docs_current = [] # Errors specific to this doctype run


        # Fetch documents for the current doctype with non-empty invoice_data
        docs_with_invoices = frappe.get_all(
            current_doctype,
            # filters=[
            #     ["invoice_data", "is not", None]
            #     # Add other filters if needed
            # ],
            # Fetch fields common/needed for processing and task creation
            fields=["name", "invoice_data", "project"]
            # Note: 'vendor' is specific to PO, fetch conditionally if needed later
        )

        print(f"docs_with_invoices: {docs_with_invoices}")

        total_docs_current = len(docs_with_invoices)
        total_docs_checked_all += total_docs_current
        frappe.msgprint(f"Found {total_docs_current} documents with invoice data.")

        if not total_docs_current:
            frappe.msgprint(f"No documents found for {current_doctype}. Moving to next.")
            continue

        for doc_data in docs_with_invoices:
            doc_name = doc_data.get("name")
            invoice_data_json = doc_data.get("invoice_data")
            if not invoice_data_json:
                continue
            # invoice_data_json = doc.invoice_data
            print(f'invoice_data_json', invoice_data_json)
            # project = doc_data.get("project") # Needed for Task

            # --- Data Validation and Parsing ---
            try:
                if not invoice_data_json:
                    frappe.msgprint(f"Skipping {current_doctype} {doc_name}: invoice_data field is empty.")
                    skipped_docs_current += 1
                    continue

                try:
                    invoice_data = isinstance(invoice_data_json, str) and json.loads(invoice_data_json) or invoice_data_json
                except json.JSONDecodeError:
                    frappe.msgprint(f"Skipping {current_doctype} {doc_name}: Error decoding JSON - '{invoice_data_json}'")
                    skipped_docs_current += 1
                    error_docs_current.append({"doctype": current_doctype, "name": doc_name, "error": "JSON Decode Error", "data": invoice_data_json})
                    continue

                if not isinstance(invoice_data, dict) or "data" not in invoice_data or not isinstance(invoice_data.get("data"), dict):
                    frappe.msgprint(f"Skipping {current_doctype} {doc_name}: Invalid structure. Expected {{'data': {{...}} }}")
                    skipped_docs_current += 1
                    error_docs_current.append({"doctype": current_doctype, "name": doc_name, "error": "Invalid Structure", "data": invoice_data_json})
                    continue

                if not invoice_data["data"]:
                    frappe.msgprint(f"Skipping {current_doctype} {doc_name}: 'data' dictionary is empty.")
                    skipped_docs_current += 1
                    continue

                needs_update = False # Flag to check if the document needs saving

                # --- Iterate through invoice entries ---
                for date_key, entry_data in list(invoice_data["data"].items()): # Use list() for safe iteration if modifying dict
                    if not isinstance(entry_data, dict):
                        frappe.msgprint(f"Skipping entry '{date_key}' in {current_doctype} {doc_name}: Entry data is not a dictionary.")
                        continue

                    if entry_data.get("status") == APPROVED_STATUS and entry_data.get("_patch_id") == PATCH_ID:
                        continue # Already processed

                    entry_data["status"] = APPROVED_STATUS
                    entry_data["_patch_id"] = PATCH_ID
                    needs_update = True
                    updated_invoices_current += 1

                    # --- Create Corresponding Task ---
                    try:
                        task = frappe.new_doc("Task")
                        task.update({
                            "task_doctype": current_doctype, # Use the current doctype
                            "task_docname": doc_name,
                            # "subject": f"Invoice Approval Task for {current_doctype.rstrip('s')} {doc_name} - Inv# {entry_data.get('invoice_no', 'N/A')}",
                            # "project": project,
                            "assignee": DEFAULT_ASSIGNEE,
                            "assignee_role": DEFAULT_ASSIGNEE_ROLE,
                            "status": APPROVED_STATUS,
                            # "completed_by": DEFAULT_ASSIGNEE,
                            # "completion_date": now(),
                            "task_type": TASK_TYPE,
                            "reference_name_1": "invoice_date_key",
                            "reference_value_1": date_key,
                            "reference_name_2": "invoice_no",
                            "reference_value_2": entry_data.get("invoice_no"),
                            "reference_name_3": "invoice_amount",
                            "reference_value_3": entry_data.get("amount"),
                        })
                        task.insert(ignore_permissions=True, ignore_mandatory=True)
                        created_tasks_current += 1

                    except Exception as task_error:
                        frappe.log_error(
                            title=f"Patch Error: Failed to create task for {current_doctype} {doc_name}, entry key '{date_key}'",
                            message=frappe.get_traceback()
                        )
                        error_docs_current.append({"doctype": current_doctype, "name": doc_name, "error": f"Task Creation Error for key '{date_key}'", "detail": str(task_error)})


                # --- Update the Parent Document ---
                if needs_update:
                    try:
                        frappe.db.set_value(current_doctype, doc_name, "invoice_data", json.dumps(invoice_data), update_modified=False)
                    except Exception as update_error:
                        frappe.log_error(
                            title=f"Patch Error: Failed to update {current_doctype} {doc_name}",
                            message=frappe.get_traceback()
                        )
                        error_docs_current.append({"doctype": current_doctype, "name": doc_name, "error": "Document Update Error", "detail": str(update_error)})

                processed_docs_current += 1
                if processed_docs_current % 100 == 0:
                    frappe.msgprint(f"Processed {processed_docs_current}/{total_docs_current} {current_doctype} documents...")

            except Exception as e:
                frappe.log_error(
                    title=f"Patch Error: Unhandled exception processing {current_doctype} {doc_name}",
                    message=frappe.get_traceback()
                )
                error_docs_current.append({"doctype": current_doctype, "name": doc_name, "error": "Unhandled Exception", "detail": str(e)})

        # --- Update Aggregated Statistics ---
        total_processed_docs_all += processed_docs_current
        total_updated_invoices_all += updated_invoices_current
        total_created_tasks_all += created_tasks_current
        total_skipped_docs_all += skipped_docs_current
        total_error_docs_list.extend(error_docs_current)

        frappe.msgprint(f"\nFinished processing {current_doctype}.")
        frappe.msgprint(f"  Processed: {processed_docs_current}/{total_docs_current}")
        frappe.msgprint(f"  Skipped: {skipped_docs_current}")
        frappe.msgprint(f"  Invoice Entries Updated: {updated_invoices_current}")
        frappe.msgprint(f"  Tasks Created: {created_tasks_current}")
        frappe.msgprint(f"  Errors for this doctype: {len(error_docs_current)}")


    # --- Final Overall Summary ---
    frappe.msgprint("=" * 40)
    frappe.msgprint("Overall Patch Execution Summary:")
    frappe.msgprint(f"Total documents checked (all types): {total_docs_checked_all}")
    frappe.msgprint(f"Total documents processed (all types): {total_processed_docs_all}")
    frappe.msgprint(f"Total documents skipped (all types): {total_skipped_docs_all}")
    frappe.msgprint(f"Total invoice entries updated (all types): {total_updated_invoices_all}")
    frappe.msgprint(f"Total historical tasks created (all types): {total_created_tasks_all}")
    frappe.msgprint(f"Total documents with errors (all types): {len(total_error_docs_list)}")

    if total_error_docs_list:
        frappe.msgprint("\n--- Documents with Errors (All Types) ---")
        for err in total_error_docs_list:
            frappe.msgprint(f"  - {err['doctype']} {err['name']}: {err['error']} (Details logged)")
        frappe.msgprint("\nPlease review the Error Log for detailed tracebacks.")
        # Decide if errors should prevent marking the patch as complete
        frappe.msgprint("\nPatch completed with errors.")
        # Consider NOT inserting the Patch Log entry or committing if critical errors occurred
        # frappe.throw("Patch completed with errors. Manual review required.")
    else:
        # Log successful patch completion only if no errors occurred across all doctypes
        frappe.get_doc({"doctype": "Patch Log", "patch": PATCH_ID}).insert(ignore_permissions=True)
        frappe.db.commit() # Commit explicitly after successful run
        frappe.msgprint(f"\nPatch '{PATCH_ID}' completed successfully for all specified doctypes.")

    # frappe.db.auto_commit_on_many_writes = 0 # Optional: Reset if needed

# Reminder: Backup database before running. Test on staging first.
# Run using: bench --site [your.site.name] execute [path.to.this.script.execute]