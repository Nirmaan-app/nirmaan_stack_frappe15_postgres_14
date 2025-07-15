import frappe
import json
from frappe.utils import flt

def execute():
    module_name = "Nirmaan Stack" # Or your app's module name
    # We need to reload Sent Back Category and the child table ProcurementRequestItemDetail
    frappe.reload_doc(module_name, "doctype", "sent_back_category", force=True)
    # No need to reload ProcurementRequestItemDetail if it wasn't changed,
    # but it's good practice if its usage context is expanding.
    # Assuming ProcurementRequestItemDetail is in the same module or a core module
    # If it's in your custom app:
    frappe.reload_doc(module_name, "doctype", "procurement_request_item_detail", force=True)


    sbc_doctype = "Sent Back Category"
    old_json_field_name = "item_list"
    new_child_table_field_name = "order_list" # Using the same name as in PR for consistency

    sbc_docs_to_migrate = frappe.get_all(
        sbc_doctype,
        fields=["name", old_json_field_name, "procurement_request"], # work_package from parent SBC for fallback
        # filters={old_json_field_name: ["is", "set"]} 
    )

    if not sbc_docs_to_migrate:
        frappe.log("No Sent Back Category documents found needing migration for 'item_list'.")
        return

    migrated_count = 0
    failed_count = 0

    for sbc_data in sbc_docs_to_migrate:
        sbc_name = sbc_data.get("name")
        parent_pr = frappe.get_doc("Procurement Requests", sbc_data.get("procurement_request")) # Get PR from parent SBC document
        # parent_work_package = sbc_data.get("work_package") # Get WP from parent SBC document
        parent_work_package = parent_pr.get("work_package")
        old_json_string = sbc_data.get(old_json_field_name)

        if not old_json_string:
            continue

        try:
            sbc_doc = frappe.get_doc(sbc_doctype, sbc_name)
            
            # Clear existing entries in the new child table field
            sbc_doc.set(new_child_table_field_name, [])

            data_dict = {}
            if isinstance(old_json_string, str):
                try:
                    data_dict = json.loads(old_json_string)
                except json.JSONDecodeError:
                    frappe.log(f"SBC {sbc_name}: Invalid JSON in '{old_json_field_name}'. Skipping.")
                    failed_count += 1
                    continue
            elif isinstance(old_json_string, dict):
                data_dict = old_json_string
            else:
                frappe.log(f"SBC {sbc_name}: Content of '{old_json_field_name}' is not string or dict. Skipping.")
                failed_count += 1
                continue
            
            items_json_list = data_dict.get("list", [])
            if not isinstance(items_json_list, list):
                frappe.log(f"SBC {sbc_name}: 'list' key in '{old_json_field_name}' is not a list. Skipping.")
                failed_count += 1
                continue

            for item_data_json in items_json_list:
                if not isinstance(item_data_json, dict):
                    frappe.log(f"SBC {sbc_name}: Found non-dictionary item in list. Skipping: {item_data_json}")
                    continue

                # Mapping from SentBackItem (ProcurementItemWithVendor) JSON fields
                # to ProcurementRequestItemDetail child table fields.
                child_row_data = {
                    # "doctype": "ProcurementRequestItemDetail", # Not needed when using doc.append with correct fieldname
                    "item_id": item_data_json.get("name"),      # 'name' in JSON is Item DocName
                    "item_name": item_data_json.get("item"),    # 'item' in JSON is display name
                    "unit": item_data_json.get("unit"),
                    "quantity": flt(item_data_json.get("quantity")),
                    "category": item_data_json.get("category"),
                    "procurement_package": item_data_json.get("work_package") or parent_work_package, # Use item's WP, fallback to parent SBC's WP
                    "make": item_data_json.get("make"),
                    "status": item_data_json.get("status"),
                    "tax": flt(item_data_json.get("tax")) if item_data_json.get("tax") is not None else None,
                    "comment": item_data_json.get("comment"),
                    "vendor": item_data_json.get("vendor"),
                    "quote": flt(item_data_json.get("quote")) if item_data_json.get("quote") is not None else None,
                }
                
                # Basic validation for required fields in child table
                if not child_row_data["item_id"] or not child_row_data["item_name"] or \
                   not child_row_data["unit"] or child_row_data["quantity"] is None or \
                   not child_row_data["category"] or not child_row_data["status"]:
                    frappe.log(f"SBC {sbc_name}: Skipping item due to missing required fields. Data: {item_data_json}")
                    continue

                sbc_doc.append(new_child_table_field_name, child_row_data)
            
            sbc_doc.save(ignore_permissions=True) # Save the document with new child table data
            migrated_count += 1
            if migrated_count > 0 and migrated_count % 20 == 0:
                frappe.db.commit()
                frappe.log(f"Migrated 'item_list' for {migrated_count} Sent Back Category documents.")

        except Exception as e:
            frappe.db.rollback()
            frappe.log(f"Error migrating SBC {sbc_name}. Type: {type(e).__name__}, Error: {e}")
            failed_count += 1
            
    frappe.db.commit()
    frappe.log(f"Successfully migrated 'item_list' for {migrated_count} Sent Back Category documents.")
    if failed_count > 0:
        frappe.log(f"Failed to migrate 'item_list' for {failed_count} Sent Back Category documents. Check logs.")