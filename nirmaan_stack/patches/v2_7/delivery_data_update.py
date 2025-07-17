import frappe
import json
from frappe.utils import getdate

def execute():
    """
    Patch to update the 'delivery_data' JSON field in all Procurement Orders.
    1. Adds a chronological 'note_no' to each delivery event.
    2. Resets the 'from' value to 0 for all items in the first delivery event.
    """
    po_doctype = "Procurement Orders"
    
    # Fetch all POs that have a value in 'delivery_data' to avoid processing nulls.
    # We only need the name and the data itself.
    procurement_orders = frappe.get_all(
        po_doctype,
        fields=["name", "delivery_data", "status"],
        filters=[
            ["status", "in", ["Partially Delivered", "Delivered"]],
        ]
    )
    
    updated_count = 0
    skipped_count = 0
    failed_count = 0
    total_docs = len(procurement_orders)

    print(f"Starting patch for 'delivery_data' on {total_docs} Procurement Orders.")

    for idx, po in enumerate(procurement_orders):
        po_name = po.get("name")
        delivery_data_json = po.get("delivery_data")

        try:
            # --- 1. Validate and Parse the JSON Data ---
            if not delivery_data_json:
                skipped_count += 1
                continue

            po_delivery_data = delivery_data_json

            # Ensure the expected structure {'data': {'date': {...}}} exists
            # if not isinstance(po_delivery_data, dict) or "data" not in po_delivery_data or not isinstance(po_delivery_data.get("data"), dict):
            #     print(f"PO {po_name}: Skipping due to malformed delivery_data (missing 'data' object).")
            #     skipped_count += 1
            #     continue
            
            # Skip if there are no delivery dates to process
            if not po_delivery_data["data"]:
                skipped_count += 1
                continue

            # --- 2. Sort Delivery Dates Chronologically ---
            # The keys of the 'data' object are date strings. Sorting them gives us the timeline.
            # Standard string sort works correctly for 'YYYY-MM-DD' format.
            sorted_date_keys = sorted(po_delivery_data["data"].keys())

            # --- 3. Iterate and Apply Changes in Memory ---
            for note_no, date_key in enumerate(sorted_date_keys, start=1):
                delivery_event = po_delivery_data["data"][date_key]
                
                # Requirement 1: Add the chronological note_no
                delivery_event['note_no'] = note_no
                
                # Requirement 2: For the *first* delivery event, reset 'from' values
                if note_no == 1 and 'items' in delivery_event and isinstance(delivery_event['items'], list):
                    for item in delivery_event['items']:
                        if isinstance(item, dict):
                            item['from'] = 0
            
            # --- 4. Update the Document in the Database ---
            updated_json_string = json.dumps(po_delivery_data)
            
            # Use frappe.db.set_value for high performance.
            # This directly updates the field in the database without running all ORM hooks.
            frappe.db.set_value(
                po_doctype,
                po_name,
                "delivery_data",
                updated_json_string,
                update_modified=False # Do not change the 'modified' timestamp for a patch
            )
            
            updated_count += 1
            if updated_count % 50 == 0:
                frappe.db.commit() # Commit periodically to manage transaction size
                print(f"Progress: Updated {updated_count}/{total_docs} POs.")

        except json.JSONDecodeError:
            print(f"PO {po_name}: Failed to decode JSON in delivery_data.")
            failed_count += 1
        except Exception as e:
            print(title=f"Error processing PO {po_name}", message=frappe.get_traceback())
            failed_count += 1

    # Final commit for any remaining changes
    frappe.db.commit()

    # --- 5. Log Final Summary ---
    summary_message = f"""
    Delivery Data Patch Summary:
    - Total POs Checked: {total_docs}
    - Successfully Updated: {updated_count}
    - Skipped (No Data/Malformed): {skipped_count}
    - Failed: {failed_count}
    """
    print(summary_message)