# your_app_name/patches/v1_0/set_dispatch_date_for_procurement_orders.py
import frappe
import json

def execute():
    # frappe.db.auto_commit_on_many_writes = True # Good for patches doing many small writes

    # Get all Procurement Orders that are in a state where they should have a dispatch_date
    # and potentially don't have one yet, or we want to ensure it's the correct one.
    procurement_orders_to_check = frappe.get_all(
        "Procurement Orders",
        filters={
            "status": ["in", ["Dispatched", "Partially Delivered", "Delivered"]]
        },
        fields=["name", "status"] # We only need 'name' to query versions
    )

    updated_count = 0
    skipped_no_version_count = 0
    already_had_date_count = 0 # Optional: if you want to track this

    frappe.log(f"Found {len(procurement_orders_to_check)} Procurement Orders to check for dispatch_date.")

    for po in procurement_orders_to_check:
        po_name = po.name
        current_po_dispatch_date = frappe.db.get_value("Procurement Orders", po_name, "dispatch_date")

        # Find version history for this specific Procurement Order, newest first
        versions = frappe.get_all(
            "Version",
            filters={
                "ref_doctype": "Procurement Orders",
                "docname": po_name
            },
            fields=["name", "creation", "data"],
            order_by="creation DESC" # Important to get the latest dispatch event
        )

        latest_dispatch_timestamp = None

        for version_doc in versions:
            try:
                # The 'data' field in tabVersion is a JSON string
                version_data = json.loads(version_doc.data)
                
                # Check if 'changed' key exists and is not empty
                if "changed" in version_data and version_data["changed"]:
                    for change in version_data["changed"]:
                        # change is a list: [field_name, old_value, new_value]
                        if len(change) == 3:
                            field_name, old_value, new_value = change
                            # We are looking for the specific transition to "Dispatched"
                            # As per your example, it's from "PO Approved"
                            if field_name == "status" and new_value == "Dispatched" and old_value == "PO Approved":
                                latest_dispatch_timestamp = version_doc.creation
                                # Since we are iterating from newest to oldest,
                                # the first one we find is the latest dispatch event.
                                break 
                
                if latest_dispatch_timestamp:
                    break # Found the relevant change for this PO

            except json.JSONDecodeError:
                frappe.log(
                    f"Error decoding JSON for Version {version_doc.name} (PO: {po_name})",
                    "Patch: set_dispatch_date"
                )
            except Exception as e:
                frappe.log(
                    f"Unexpected error processing Version {version_doc.name} (PO: {po_name}): {str(e)}",
                    "Patch: set_dispatch_date"
                )
        
        if latest_dispatch_timestamp:
            # Only update if the new timestamp is different or if dispatch_date was not set
            if not current_po_dispatch_date or current_po_dispatch_date != latest_dispatch_timestamp:
                frappe.db.set_value(
                    "Procurement Orders",
                    po_name,
                    "dispatch_date",
                    latest_dispatch_timestamp,
                    update_modified=False # Generally false for patches not reflecting user action
                )
                updated_count += 1
                frappe.log(f"Updated dispatch_date for PO {po_name} to {latest_dispatch_timestamp}")
            else:
                already_had_date_count +=1
                frappe.log(f"PO {po_name} already had correct dispatch_date: {current_po_dispatch_date}")

        else:
            skipped_no_version_count += 1
            frappe.log(f"No version found indicating dispatch for PO {po_name} (current status: {po.status})")

    # Commit all changes at the end
    frappe.db.commit()
    # frappe.db.auto_commit_on_many_writes = False # Reset to default

    frappe.log("--- Patch Execution Summary ---")
    frappe.log(f"Total Procurement Orders checked: {len(procurement_orders_to_check)}")
    frappe.log(f"Procurement Orders updated with dispatch_date: {updated_count}")
    frappe.log(f"Procurement Orders that already had correct dispatch_date: {already_had_date_count}")
    frappe.log(f"Procurement Orders skipped (no dispatch version found): {skipped_no_version_count}")