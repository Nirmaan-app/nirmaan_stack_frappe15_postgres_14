import frappe
import json
from frappe.utils import flt

def execute():
    module_name = "Nirmaan Stack" 
    frappe.reload_doc(module_name, "doctype", "procurement_orders", force=True)
    frappe.reload_doc(module_name, "doctype", "purchase_order_item", force=True)

    po_doctype = "Procurement Orders"
    old_json_field_name = "order_list"
    new_child_table_field_name = "items" # The new Table field in Procurement Orders

    po_docs_to_migrate = frappe.get_all(
        po_doctype,
        fields=["name", old_json_field_name, "procurement_request"], # Parent PO's work_package for fallback
        filters={"custom": ["!=", "true"]}
    )

    if not po_docs_to_migrate:
        frappe.log("No Procurement Orders found needing migration for 'order_list'.")
        return

    migrated_count = 0
    failed_count = 0

    for po_data in po_docs_to_migrate:
        po_name = po_data.get("name")
        # parent_po_work_package = po_data.get("work_package") # If PO itself has a WP
        parent_pr_doc = frappe.get_doc("Procurement Requests", po_data.get("procurement_request"))
        pr_order_list = parent_pr_doc.get("order_list")
        parent_po_work_package = parent_pr_doc.get("work_package")
        old_json_string = po_data.get(old_json_field_name)

        if not old_json_string:
            continue

        try:
            po_doc = frappe.get_doc(po_doctype, po_name)
            po_doc.set(new_child_table_field_name, []) # Clear existing items

            data_dict = {}
            if isinstance(old_json_string, str):
                try:
                    data_dict = json.loads(old_json_string)
                except json.JSONDecodeError:
                    frappe.log(f"PO {po_name}: Invalid JSON in '{old_json_field_name}'.")
                    failed_count += 1
                    continue
            elif isinstance(old_json_string, dict):
                data_dict = old_json_string
            else:
                frappe.log(f"PO {po_name}: Content of '{old_json_field_name}' not string/dict.")
                failed_count += 1
                continue
            
            items_json_list = data_dict.get("list", [])
            if not isinstance(items_json_list, list):
                frappe.log(f"PO {po_name}: 'list' key in '{old_json_field_name}' not a list.")
                failed_count += 1
                continue
              
            total_amount_excl_tax = 0.0
            total_amount = 0.0
            total_tax_amount = 0.0
            for item_json in items_json_list:
                if not isinstance(item_json, dict):
                    continue

                item_id = item_json.get("name") # This was Item DocName
                item_display_name = item_json.get("item")
                
                if not item_id or not item_display_name:
                    frappe.log(f"PO {po_name}: Item missing ID or display name. Data: {item_json}")
                    continue

                # Determine selected make
                selected_make_docname = item_json.get("make") # From top-level 'make' field first
                if not selected_make_docname and isinstance(item_json.get("makes"), dict):
                    makes_list_inner = item_json["makes"].get("list", [])
                    for make_obj in makes_list_inner:
                        if isinstance(make_obj, dict) and make_obj.get("enabled") == "true":
                            selected_make_docname = make_obj.get("make") # This is Make DocName
                            break
                
                cur_item = next((i for i in pr_order_list if i.get("item_id") == item_id), None)

                amount = flt(item_json.get("quote")) * flt(item_json.get("quantity"))
                tax_amount = amount * (flt(item_json.get("tax")) / 100)
                child_row = {
                    "item_id": item_id,
                    "item_name": item_display_name,
                    "unit": item_json.get("unit"),
                    "quantity": flt(item_json.get("quantity")),
                    "received_quantity": flt(item_json.get("received", 0)),
                    "category": item_json.get("category"),
                    "procurement_package": item_json.get("procurement_package") or parent_po_work_package,
                    "quote": flt(item_json.get("quote")),
                    "make": selected_make_docname,
                    # "status": item_json.get("status", "Pending Delivery"), # Default status
                    "tax": flt(item_json.get("tax")),
                    "comment": item_json.get("comment"),
                    "po": item_json.get('po') or None,
                    "procurement_request_item": cur_item,
                    "amount": amount,
                    "tax_amount": tax_amount,

                    "total_amount": flt(amount) + flt(tax_amount),
                    # 'amount', 'tax_amount', 'total_amount' will be calculated by hooks/scripts
                }
                total_amount_excl_tax += amount
                total_amount += amount + tax_amount
                total_tax_amount += tax_amount
                
                # Basic validation
                if not all(child_row.get(f) for f in ["item_id", "unit", "category"]) or \
                   child_row.get("quantity") is None or child_row.get("quote") is None:
                    frappe.log(f"PO {po_name}: Skipping item due to missing required fields for child table. Data: {child_row}")
                    continue

                po_doc.append(new_child_table_field_name, child_row)
            
            # Trigger calculation of amounts after appending all items
            # This assumes you have a method on the PO DocType or a controller hook to do this.
            # Example: if hasattr(po_doc, "calculate_item_totals"): po_doc.calculate_item_totals()
            # For now, we'll assume this is handled by on_update or validate hooks in Purchase Order Item.
            
            po_doc.amount = flt(total_amount_excl_tax)
            po_doc.tax_amount = flt(total_tax_amount)
            po_doc.total_amount = flt(total_amount)
            po_doc.save(ignore_permissions=True)
            migrated_count += 1
            if migrated_count % 20 == 0:
                frappe.db.commit()
                frappe.log(f"Migrated 'order_list' for {migrated_count} POs.")

        except Exception as e:
            frappe.db.rollback()
            frappe.log(f"Error migrating PO {po_name} for 'order_list'. Error: {e}")
            failed_count += 1
            
    frappe.db.commit()
    frappe.log(f"Successfully migrated 'order_list' for {migrated_count} POs.")
    if failed_count > 0:
        frappe.log(f"Failed 'order_list' migration for {failed_count} POs.")