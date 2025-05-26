import frappe
import json

def execute():
    # Optional: Reload doctypes if their definitions were changed for this patch
    # frappe.reload_doc("procurement_requests", "doctype", "procurement_requests", force=True)
    # frappe.reload_doc("procurement_orders", "doctype", "procurement_orders", force=True)
    # frappe.reload_doc("sent_back_category", "doctype", "sent_back_category", force=True) # Use the actual DocType name

    # --- Phase 1: Update Procurement Requests (as before) ---
    update_pr_items()

    # --- Phase 2: Update Procurement Orders based on linked PR's work_package ---
    update_po_items()

    # --- Phase 3: Update Sent Back Category items based on linked PR's work_package ---
    update_sbc_items()

    frappe.log("Patch execution for backfilling work_package in items completed.")

# --- Helper function to update items in a JSON list field ---
def _update_items_in_json_list(doc_name, doctype, json_field_name, parent_work_package, items_json_string):
    """
    Helper to parse, update items with work_package, and serialize back.
    Returns True if modifications were made, False otherwise.
    Raises exceptions on critical errors.
    """
    if not items_json_string:
        frappe.log(f"Skipping {doctype} {doc_name}: {json_field_name} is empty or not set.")
        return False

    try:
        list_data = frappe.parse_json(items_json_string)
        if not isinstance(list_data, dict) or "list" not in list_data or not isinstance(list_data["list"], list):
            frappe.log(f"Skipping {doctype} {doc_name}: {json_field_name} JSON structure is invalid. Data: {list_data}")
            return False # Indicate failure for this doc

        items_list = list_data.get("list", [])
        modified_items_flag = False

        for item in items_list:
            if not isinstance(item, dict):
                frappe.log(f"Skipping non-dict item in {doctype} {doc_name}, field {json_field_name}: {item}")
                continue
            if item.get("procurement_package") != parent_work_package:
                if item.get("work_package"):
                    del item["work_package"]
                item["procurement_package"] = parent_work_package
                modified_items_flag = True
        
        if modified_items_flag:
            list_data["list"] = items_list
            updated_json_string = json.dumps(list_data)
            frappe.db.set_value(
                doctype,
                doc_name,
                json_field_name,
                updated_json_string,
                update_modified=False
            )
            return True # Modifications made
        else:
            frappe.log(f"{doctype} {doc_name}: No items needed {json_field_name} procurement_package update.")
            return False # No modifications needed for these items

    except json.JSONDecodeError as e:
        frappe.log(f"Failed to parse {json_field_name} for {doctype} {doc_name}. Error: {e}. Data: {items_json_string}")
        raise # Re-raise to be caught by the calling function for counting failures
    except Exception as e:
        frappe.log(f"Unexpected error updating items for {doctype} {doc_name}, field {json_field_name}. Error: {e}")
        raise # Re-raise


# --- Function to update Procurement Request items ---
def update_pr_items():
    frappe.log("Starting backfill for Procurement Request items...")
    procurement_requests = frappe.get_all(
        "Procurement Requests",
        filters={"work_package": ["is", "set"]},
        fields=["name", "work_package", "procurement_list"]
    )

    if not procurement_requests:
        frappe.log("No Procurement Requests found needing procurement_package backfill in items.")
        return

    processed_count = 0
    failed_count = 0
    for pr_data in procurement_requests:
        pr_name = pr_data.get("name")
        parent_wp = pr_data.get("work_package")
        pr_list_json = pr_data.get("procurement_list")
        try:
            if _update_items_in_json_list(pr_name, "Procurement Requests", "procurement_list", parent_wp, pr_list_json):
                processed_count += 1
            # If _update_items_in_json_list returns False (no modification needed), it's not a failure
            # and not counted in processed_count for "modified documents"
        except Exception: # Catch errors re-raised by helper
            failed_count +=1
        
        if (processed_count + failed_count) % 50 == 0 and (processed_count + failed_count) > 0:
            frappe.db.commit()
            frappe.log(f"PR Update: Committed after processing {processed_count + failed_count} records.")
    
    frappe.db.commit()
    frappe.log(f"Procurement Request items: Successfully updated {processed_count} records. Failed: {failed_count}.")


# --- Function to update Procurement Order items ---
def update_po_items():
    frappe.log("Starting backfill for Procurement Order items...")
    # Fetch POs that have a linked PR, and that PR has a work_package
    # This requires a more complex query if you want to filter directly on the PR's work_package.
    # Simpler: fetch all POs with a procurement_request, then get the PR's work_package.
    
    procurement_orders = frappe.get_all(
        "Procurement Orders",
        filters={"procurement_request": ["is", "set"]}, # Ensure there's a linked PR
        fields=["name", "procurement_request", "order_list"]
    )

    if not procurement_orders:
        frappe.log("No Procurement Orders found linked to Procurement Requests.")
        return

    processed_count = 0
    failed_count = 0
    pr_work_package_cache = {} # Cache to avoid repeated DB calls for PR work_package

    for po_data in procurement_orders:
        po_name = po_data.get("name")
        linked_pr_name = po_data.get("procurement_request")
        order_list_json = po_data.get("order_list")

        if not linked_pr_name:
            continue

        # Get work_package from the linked PR (with caching)
        parent_work_package = pr_work_package_cache.get(linked_pr_name)
        if parent_work_package is None: # Not in cache or PR had no WP
            pr_wp_value = frappe.db.get_value("Procurement Requests", linked_pr_name, "work_package")
            if pr_wp_value:
                parent_work_package = pr_wp_value
                pr_work_package_cache[linked_pr_name] = parent_work_package
            else:
                pr_work_package_cache[linked_pr_name] = False # Mark as checked, no WP found
                frappe.log(f"Skipping PO {po_name}: Linked PR {linked_pr_name} has no work_package set.")
                continue # Skip this PO if linked PR has no work_package
        elif parent_work_package is False: # Explicitly cached as no WP
            frappe.log(f"Skipping PO {po_name} (cached): Linked PR {linked_pr_name} has no work_package set.")
            continue
            
        try:
            if _update_items_in_json_list(po_name, "Procurement Orders", "order_list", parent_work_package, order_list_json):
                processed_count += 1
        except Exception:
            failed_count += 1

        if (processed_count + failed_count) % 50 == 0 and (processed_count + failed_count) > 0:
            frappe.db.commit()
            frappe.log(f"PO Update: Committed after processing {processed_count + failed_count} records.")
            
    frappe.db.commit()
    frappe.log(f"Procurement Order items: Successfully updated {processed_count} records. Failed: {failed_count}.")


# --- Function to update Sent Back Category items ---
def update_sbc_items():
    frappe.log("Starting backfill for Sent Back Category items...")
    # Ensure you use the correct DocType name for "Sent Back Category"
    sbc_doctype_name = "Sent Back Category" # Verify this is the exact name in your system

    sent_back_categories = frappe.get_all(
        sbc_doctype_name,
        filters={"procurement_request": ["is", "set"]}, # Ensure there's a linked PR
        fields=["name", "procurement_request", "item_list"]
    )

    if not sent_back_categories:
        frappe.log(f"No {sbc_doctype_name} documents found linked to Procurement Requests.")
        return

    processed_count = 0
    failed_count = 0
    pr_work_package_cache = {} # Can reuse or have a separate cache

    for sbc_data in sent_back_categories:
        sbc_name = sbc_data.get("name")
        linked_pr_name = sbc_data.get("procurement_request")
        item_list_json = sbc_data.get("item_list")

        if not linked_pr_name:
            continue

        parent_work_package = pr_work_package_cache.get(linked_pr_name)
        if parent_work_package is None:
            pr_wp_value = frappe.db.get_value("Procurement Requests", linked_pr_name, "work_package")
            if pr_wp_value:
                parent_work_package = pr_wp_value
                pr_work_package_cache[linked_pr_name] = parent_work_package
            else:
                pr_work_package_cache[linked_pr_name] = False
                frappe.log(f"Skipping {sbc_doctype_name} {sbc_name}: Linked PR {linked_pr_name} has no work_package set.")
                continue
        elif parent_work_package is False:
            frappe.log(f"Skipping {sbc_doctype_name} {sbc_name} (cached): Linked PR {linked_pr_name} has no work_package set.")
            continue
            
        try:
            if _update_items_in_json_list(sbc_name, sbc_doctype_name, "item_list", parent_work_package, item_list_json):
                processed_count += 1
        except Exception:
            failed_count += 1

        if (processed_count + failed_count) % 50 == 0 and (processed_count + failed_count) > 0:
            frappe.db.commit()
            frappe.log(f"SBC Update: Committed after processing {processed_count + failed_count} records.")
            
    frappe.db.commit()
    frappe.log(f"{sbc_doctype_name} items: Successfully updated {processed_count} records. Failed: {failed_count}.")