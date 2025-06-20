# your_app_name/patches/v1_0/set_dispatch_date_for_procurement_orders_v2.py # Renamed for clarity
import frappe
import json
from frappe.utils import now_datetime # For type comparison if needed, though direct comparison usually works

def execute():
    frappe.db.auto_commit_on_many_writes = True # Good for patches doing many small writes

    procurement_orders_to_check = frappe.get_all(
        "Procurement Orders",
        filters={
            "status": ["in", ["Dispatched", "Partially Delivered", "Delivered"]]
        },
        fields=["name", "status", "creation"] # Added "creation" field of the PO itself
    )

    updated_via_version_count = 0
    updated_via_creation_fallback_count = 0
    already_had_correct_date_count = 0
    skipped_no_relevant_change_and_no_fallback_needed = 0 # if dispatch_date already matched creation date

    frappe.log(f"Found {len(procurement_orders_to_check)} Procurement Orders to check for dispatch_date.")

    for po in procurement_orders_to_check:
        po_name = po.name
        po_creation_date = po.creation # Store PO's creation date
        current_po_dispatch_date = frappe.db.get_value("Procurement Orders", po_name, "dispatch_date")

        # Ensure current_po_dispatch_date is a datetime object if it exists, for proper comparison
        # Frappe usually returns datetime objects for DateTime fields, but good to be aware
        # if isinstance(current_po_dispatch_date, str):
        #     current_po_dispatch_date = frappe.utils.get_datetime(current_po_dispatch_date)


        latest_dispatch_timestamp_from_version = None

        versions = frappe.get_all(
            "Version",
            filters={
                "ref_doctype": "Procurement Orders",
                "docname": po_name
            },
            fields=["name", "creation", "data"],
            order_by="creation DESC"
        )

        for version_doc in versions:
            try:
                version_data = json.loads(version_doc.data)
                
                if "changed" in version_data and version_data["changed"]:
                    for change in version_data["changed"]:
                        if len(change) == 3:
                            field_name, old_value, new_value = change
                            if field_name == "status" and \
                               new_value == "Dispatched" and \
                               (old_value == "PO Approved" or old_value == "PO Sent"):
                                latest_dispatch_timestamp_from_version = version_doc.creation
                                break 
                
                if latest_dispatch_timestamp_from_version:
                    break

            except json.JSONDecodeError:
                frappe.log(
                    message=f"Error decoding JSON for Version {version_doc.name} (PO: {po_name})",
                    title="Patch: set_dispatch_date"
                )
            except Exception as e:
                frappe.log(
                    message=f"Unexpected error processing Version {version_doc.name} (PO: {po_name}): {str(e)}",
                    title="Patch: set_dispatch_date"
                )
        
        target_dispatch_date = None
        update_reason = ""

        if latest_dispatch_timestamp_from_version:
            target_dispatch_date = latest_dispatch_timestamp_from_version
            update_reason = "version_history"
        else:
            # Fallback to PO's creation date if no specific version event found
            target_dispatch_date = po_creation_date
            update_reason = "po_creation_fallback"
            frappe.log(f"PO {po_name}: No specific dispatch version found. Using PO creation date {po_creation_date} as fallback.")

        if target_dispatch_date:
            # Check if update is needed
            # Note: Direct comparison of datetime objects should work.
            # Frappe's get_value for DateTime fields returns datetime objects.
            # If current_po_dispatch_date is a string, it needs conversion, but usually not needed.
            
            if not current_po_dispatch_date or current_po_dispatch_date != target_dispatch_date:
                frappe.db.set_value(
                    "Procurement Orders",
                    po_name,
                    "dispatch_date",
                    target_dispatch_date,
                    update_modified=False
                )
                if update_reason == "version_history":
                    updated_via_version_count += 1
                    frappe.log(f"Updated dispatch_date for PO {po_name} to {target_dispatch_date} (from version).")
                elif update_reason == "po_creation_fallback":
                    updated_via_creation_fallback_count += 1
                    frappe.log(f"Updated dispatch_date for PO {po_name} to {target_dispatch_date} (fallback to PO creation).")
            else:
                already_had_correct_date_count += 1
                frappe.log(f"PO {po_name} already had correct dispatch_date: {current_po_dispatch_date} (target was {target_dispatch_date} from {update_reason}).")
        else:
            # This case should ideally not be reached if fallback to po_creation_date always provides a date
            skipped_no_relevant_change_and_no_fallback_needed +=1 # Or some other error state
            frappe.log(f"PO {po_name}: Could not determine a dispatch_date (current status: {po.status}). This should not happen with fallback.")


    frappe.db.commit()
    frappe.db.auto_commit_on_many_writes = False # Reset to default

    frappe.log("--- Patch Execution Summary ---")
    frappe.log(f"Total Procurement Orders checked: {len(procurement_orders_to_check)}")
    frappe.log(f"Updated via version history: {updated_via_version_count}")
    frappe.log(f"Updated via PO creation fallback: {updated_via_creation_fallback_count}")
    frappe.log(f"Already had correct dispatch_date: {already_had_correct_date_count}")
    if skipped_no_relevant_change_and_no_fallback_needed > 0: # Log if this unexpected case occurs
        frappe.log(f"PO skipped (no date determined, even with fallback): {skipped_no_relevant_change_and_no_fallback_needed}")