import frappe
import json
from frappe.utils import flt

def execute():
    # Ensure DocTypes are reloaded if you've made changes to them in .json files
    # (though adding a new field via UI usually handles this for that DocType)
    frappe.reload_doc("Nirmaan Stack", "doctype", "procurement_requests", force=True)
    frappe.reload_doc("Nirmaan Stack", "doctype", "procurement_request_item_detail", force=True)

    doctype_name = "Procurement Requests"
    old_json_field_name = "procurement_list"    # The source JSON field
    new_table_field_name = "order_list" # <<<< YOUR NEW TABLE FIELD NAME
    # child_doctype_name = "Procurement Request Item Detail" # Not strictly needed if using doc.append

    # Get all PRs that have data in the old JSON field
    # and haven't been migrated to the new table field yet.
    # You'll need a flag field on "Procurement Requests" for this, e.g., "pr_items_migrated_to_table" (Check, default 0)
    prs_to_migrate = frappe.get_all(
        doctype_name,
        fields=["name", old_json_field_name, "work_package"], # Include parent work_package
        # filters={
        #     old_json_field_name: ["is", "set"], # Only process if old field has data
        #     # "pr_items_migrated_to_table": ("!=", 1) # Uncomment if you add this flag
        # }
    )

    if not prs_to_migrate:
        frappe.log(f"No {doctype_name} found needing migration from '{old_json_field_name}' to '{new_table_field_name}'.")
        return

    migrated_pr_count = 0
    failed_pr_count = 0
    total_items_migrated = 0

    for pr_data in prs_to_migrate:
        pr_name = pr_data.get("name")
        parent_work_package = pr_data.get("work_package")
        old_json_string = pr_data.get(old_json_field_name)

        # old_json_string should not be empty due to the filter, but an extra check doesn't hurt.
        if not old_json_string:
            frappe.log(f"Skipping PR {pr_name}: Old JSON field '{old_json_field_name}' is unexpectedly empty after filter.")
            continue

        try:
            doc = frappe.get_doc(doctype_name, pr_name)

            # Check if the new table field already has items (e.g., if patch is re-run or partially run)
            # If it does, we might want to skip or clear it first to avoid duplicates.
            # For this strategy (migrating TO a new field), let's assume we clear it to ensure a clean migration.
            if doc.get(new_table_field_name): # Check if the list field exists and has items
                 frappe.log(f"PR {pr_name}: New table field '{new_table_field_name}' already has data. Clearing it before migration.")
                 doc.set(new_table_field_name, []) # Clear existing items in the new table field
                 # Note: If you save here, it will clear. If you append later and then save, it's effectively a replace.
                 # For safety, clearing then appending is explicit.

            items_data_dict = {}
            if isinstance(old_json_string, str):
                try:
                    items_data_dict = json.loads(old_json_string)
                except json.JSONDecodeError as e:
                    frappe.log(f"Failed to parse JSON for PR {pr_name}, field '{old_json_field_name}'. Error: {e}. Data: {old_json_string}")
                    failed_pr_count += 1
                    continue # Skip this PR
            elif isinstance(old_json_string, dict):
                items_data_dict = old_json_string
            else:
                frappe.log(f"Skipping PR {pr_name}: Content of '{old_json_field_name}' is not a string or dict. Data: {old_json_string}")
                failed_pr_count += 1
                continue

            if not isinstance(items_data_dict, dict) or "list" not in items_data_dict or not isinstance(items_data_dict.get("list"), list):
                frappe.log(f"Skipping PR {pr_name}: JSON structure in '{old_json_field_name}' is invalid. Data: {items_data_dict}")
                failed_pr_count += 1
                continue
            
            items_to_add = items_data_dict.get("list", [])

            if not items_to_add:
                frappe.log(f"PR {pr_name}: No items in old JSON field '{old_json_field_name}'.")
                # If you cleared the new_table_field_name above, you might want to save the doc now
                # if doc.meta.get_field(new_table_field_name).is_table_field and not doc.get(new_table_field_name):
                #    pass # No items to add, new table field is already empty or cleared.
                # Else, if you use a migration flag, set it.
                # frappe.db.set_value(doctype_name, pr_name, "pr_items_migrated_to_table", 1, update_modified=False)
                # migrated_pr_count += 1 # Count as processed even if no items
                continue

            items_were_appended = False
            for item_dict in items_to_add:
                if not isinstance(item_dict, dict):
                    frappe.log(f"Skipping malformed item in PR {pr_name}: {item_dict}")
                    continue
                
                child_doc_data = {
                    "item_id": item_dict.get("name"),
                    "item_name": item_dict.get("item"),
                    "unit": item_dict.get("unit"),
                    "quantity": flt(item_dict.get("quantity")),
                    "category": item_dict.get("category"),
                    "procurement_package": item_dict.get("work_package") or parent_work_package,
                    "make": item_dict.get("make"),
                    "status": item_dict.get("status"),
                    "tax": flt(item_dict.get("tax")),
                    "comment": item_dict.get("comment"),
                    "vendor": item_dict.get("vendor"),
                    "quote": flt(item_dict.get("quote")),
                }
                
                doc.append(new_table_field_name, child_doc_data) # Append to the NEW table field
                total_items_migrated += 1
                items_were_appended = True
            
            if items_were_appended: # Only save if we actually appended items
                doc.save(ignore_permissions=True, ignore_version=True) # ignore_version if you don't want this to create a new doc version
                # frappe.db.set_value(doctype_name, pr_name, "pr_items_migrated_to_table", 1, update_modified=False)
                migrated_pr_count += 1

                if migrated_pr_count % 20 == 0:
                    frappe.db.commit()
                    frappe.log(f"Migrated data for {migrated_pr_count} PRs to '{new_table_field_name}'.")
            else:
                 frappe.log(f"PR {pr_name}: No valid items found to append after parsing.")


        except Exception as e:
            frappe.log(f"Error migrating PR {pr_name} to '{new_table_field_name}'. Error: {e}")
            failed_pr_count += 1

    frappe.db.commit()
    frappe.log(f"Successfully migrated data from '{old_json_field_name}' to '{new_table_field_name}' for {migrated_pr_count} {doctype_name} documents.")
    frappe.log(f"Total items migrated to '{new_table_field_name}': {total_items_migrated}.")
    if failed_pr_count > 0:
        frappe.log(f"Failed to migrate data for {failed_pr_count} {doctype_name} documents.")