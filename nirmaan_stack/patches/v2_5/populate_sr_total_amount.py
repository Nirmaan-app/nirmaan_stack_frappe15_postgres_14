# apps/nirmaan_stack/nirmaan_stack/patches/v1_0/populate_sr_total_amount.py

import frappe
import json
from frappe.utils import flt

def execute():
    """
    Populates the 'total_amount' for all existing 'Service Requests'
    documents that have a status of 'Approved'.
    """
    frappe.reload_doctype("Service Requests")

    # 1. Fetch only the necessary fields for the target documents.
    # This is much more memory-efficient than loading the full document object for each record.
    service_requests = frappe.get_all(
        "Service Requests",
        filters={"status": "Approved"},
        fields=["name", "service_order_list", "gst"]
    )

    if not service_requests:
        print("No 'Approved' Service Requests found to update. Patch complete.")
        return

    print(f"Found {len(service_requests)} 'Approved' Service Requests to process...")
    
    updated_count = 0
    # 2. Loop through each document found.
    for sr in service_requests:
        sub_total = 0.0

        # 3. Safely parse JSON and calculate sub_total (same logic as on_update).
        if sr.service_order_list:
            try:
                order_data = sr.service_order_list
                service_items = order_data.get("list", [])

                for item in service_items:
                    quantity = flt(item.get("quantity"))
                    rate = flt(item.get("rate"))
                    sub_total += quantity * rate
            
            except (json.JSONDecodeError, TypeError):
                # If data is malformed for a specific old record, log it and continue.
                print(f"Skipping Service Request {sr.name} due to invalid JSON in 'service_order_list'.")
                continue

        # 4. Calculate final total_amount with GST.
        total_amount = sub_total
        if sr.gst and str(sr.gst).lower() in ["true", "1", "yes"]:
            gst_amount = sub_total * 0.18
            total_amount += gst_amount

        # 5. Update the document in the database efficiently.
        # frappe.db.set_value is the best way to update a single field in a patch
        # as it's a direct DB call and does not trigger document hooks (like on_update).
        frappe.db.set_value("Service Requests", sr.name, "total_amount", total_amount, update_modified=False)
        updated_count += 1

    # 6. Commit the changes to the database.
    # This is crucial. Without this, the changes made by set_value will not be saved.
    frappe.db.commit()
    
    print(f"Successfully updated 'total_amount' for {updated_count} Service Requests.")