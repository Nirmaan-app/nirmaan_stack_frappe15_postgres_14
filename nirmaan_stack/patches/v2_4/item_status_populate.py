# nirmaan_stack/nirmaan_stack/patches/vX_Y/update_item_status_based_on_quotations.py

import frappe
from frappe.utils import now_datetime, get_datetime
from dateutil.relativedelta import relativedelta

def execute():
    frappe.reload_doc("Nirmaan Stack", "doctype", "items") # Ensures latest schema for Items
    frappe.reload_doc("Nirmaan Stack", "doctype", "approved_quotations") # Ensures latest schema for Approved Quotations
    # Assuming Procurement Orders is also in "Nirmaan Stack". If not, adjust module name.
    # frappe.reload_doc("Nirmaan Stack", "doctype", "procurement_orders")

    items_to_update = []
    current_time = now_datetime()
    six_months_ago = current_time - relativedelta(months=6)
    one_month_old = current_time - relativedelta(months=1)

    # Fetch all item names
    all_item_names = [item.name for item in frappe.get_all("Items", fields=["name"])]
    frappe.log(f"Found {len(all_item_names)} items to process.")

    for item_name in all_item_names:
        item_doc = frappe.get_doc("Items", item_name)
        new_status = None

        approved_quotations = frappe.get_all(
            "Approved Quotations",
            filters={"item_id": item_name},
            fields=["name", "procurement_order", "creation"] # Fetch creation of AQ itself for debugging/context if needed
        )

        num_approved_quotations = len(approved_quotations)

        if num_approved_quotations == 0:
            if get_datetime(item_doc.creation) > one_month_old:
                # If no approved quotations and item was created within the last month, consider it "Active"
                new_status = "Active"
            else:
                new_status = "Inactive"
        elif num_approved_quotations == 1:
            aq = approved_quotations[0]
            if aq.procurement_order:
                # Fetch the creation date of the linked Procurement Order
                po_creation_timestamp = frappe.db.get_value(
                    "Procurement Orders",
                    aq.procurement_order,
                    "creation"
                )

                if po_creation_timestamp:
                    po_creation_date = get_datetime(po_creation_timestamp)
                    if po_creation_date < six_months_ago:
                        new_status = "Inactive"
                    else:
                        new_status = "Active"
                else:
                    # Procurement Order linked, but record not found or 'creation' is null.
                    # This case should ideally not happen if data integrity is maintained.
                    # Defaulting to Inactive as per problem's spirit (cannot confirm recent activity).
                    frappe.log(
                        f"Procurement Order '{aq.procurement_order}' linked to AQ '{aq.name}' for Item '{item_name}' not found or has no creation date. Setting Item to Inactive."
                        
                    )
                    new_status = "Inactive"
            else:
                # Approved quotation exists but no procurement order linked.
                # Consider this as not actively procured recently.
                frappe.log(
                     
                    f"Approved Quotation '{aq.name}' for Item '{item_name}' has no linked Procurement Order. Setting Item to Inactive."
                )
                new_status = "Inactive"
        else: # num_approved_quotations > 1
            new_status = "Active"

        # Update the item if the status needs to change or is not set to the new_status
        if new_status and item_doc.item_status != new_status:
            items_to_update.append({
                "item_name": item_name,
                "status": new_status
            })
            # Direct update:
            # frappe.db.set_value("Items", item_name, "item_status", new_status)
            # print(f"Updating Item '{item_name}' to '{new_status}'")


    # Batch update for potentially better performance, though set_value is efficient for single fields.
    # For a very large number of items, direct SQL might be faster, but this is safer and uses ORM.
    if items_to_update:
        frappe.log(f"Preparing to update {len(items_to_update)} items.")
        count = 0
        for update_info in items_to_update:
            try:
                frappe.db.set_value("Items", update_info["item_name"], "item_status", update_info["status"], update_modified=False)
                count += 1
                if count % 100 == 0: # Commit every 100 records
                    frappe.db.commit()
                    frappe.log(f"Committed {count} updates.")
            except Exception as e:
                frappe.log(
                    f"Failed to update Item '{update_info['item_name']}' to '{update_info['status']}': {str(e)}",
                    
                )
        frappe.db.commit() # Final commit
        frappe.log( f"Successfully updated {count} items.")
    else:
        frappe.log("No items required status updates.")