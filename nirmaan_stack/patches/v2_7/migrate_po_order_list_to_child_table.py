import frappe
import json
from frappe.utils import flt, getdate
from frappe.model.document import Document
from datetime import datetime

def execute():
    """
    Migration patch to:
    1. Move items from 'order_list' (JSON) to 'items' child table.
    2. Create line items for loading and freight charges.
    3. Generate payment terms based on related 'Project Payments' entries.
    4. Calculate and set latest payment and delivery dates.
    """
    module_name = "Nirmaan Stack" 
    frappe.reload_doc(module_name, "doctype", "procurement_orders", force=True)
    frappe.reload_doc(module_name, "doctype", "purchase_order_item", force=True)
    frappe.reload_doc(module_name, "doctype", "po_payment_terms", force=True)

    po_doctype = "Procurement Orders"
    old_json_field_name = "order_list"
    new_items_child_table = "items" # The new Table field in Procurement Orders
    new_payments_child_table = "payment_terms"

    po_docs_to_migrate = frappe.get_all(
        po_doctype,
        fields=["name", old_json_field_name, "procurement_request","loading_charges", "freight_charges", "delivery_data"], # Parent PO's work_package for fallback
        # filters={"custom": ["!=", "true"]}
        order_by="creation asc"  # Order by creation date for consistent processing
    )

    if not po_docs_to_migrate:
        frappe.log("No Procurement Orders found needing migration.")
        return

    migrated_count = 0
    failed_count = 0
    failed_pos = []
    total_docs = len(po_docs_to_migrate)

    for idx, po_data in enumerate(po_docs_to_migrate):
        po_name = po_data.get("name")
        frappe.log(f"Processing PO {po_name} ({idx + 1}/{total_docs})")

        try:
            # Get the full document to modify
            po_doc = frappe.get_doc(po_doctype, po_name)
            # print(f"Processing PO: {po_doc}")
            # --- Start: Original JSON to Child Table Migration ---
            po_doc.set(new_items_child_table, []) # Clear existing items to prevent duplicates

            total_amount_excl_tax = 0.0
            total_tax_amount = 0.0

            old_json_string = po_data.get(old_json_field_name)
            if old_json_string:
                data_dict = {}
                if isinstance(old_json_string, str):
                    try:
                        data_dict = json.loads(old_json_string)
                    except json.JSONDecodeError:
                        frappe.log(f"ERROR: PO {po_name}: Invalid JSON in '{old_json_field_name}'. Skipping item migration.")
                elif isinstance(old_json_string, dict):
                    data_dict = old_json_string
                
                items_json_list = data_dict.get("list", [])
                if isinstance(items_json_list, list):
                    # Fetching PR details once is more efficient
                    parent_pr_doc = None
                    if po_data.get("procurement_request"):
                        parent_pr_doc = frappe.get_doc("Procurement Requests", po_data.get("procurement_request"))
                    
                    for item_json in items_json_list:
                        # ... (Existing item migration logic remains largely the same) ...
                        item_id = item_json.get("name")
                        amount = flt(item_json.get("quote", 0)) * flt(item_json.get("quantity", 0))
                        tax_rate = flt(item_json.get("tax", 0))
                        tax_amount = amount * (tax_rate / 100)

                        child_row = {
                            "item_id": item_id,
                            "item_name": item_json.get("item"),
                            "unit": item_json.get("unit"),
                            "quantity": flt(item_json.get("quantity")),
                            "received_quantity": flt(item_json.get("received", 0)),
                            "category": item_json.get("category"),
                            "procurement_package": item_json.get("procurement_package") or (parent_pr_doc.get("work_package") if parent_pr_doc else None),
                            "quote": flt(item_json.get("quote")),
                            "make": item_json.get("make"),
                            "tax": tax_rate,
                            "amount": amount,
                            "tax_amount": tax_amount,
                            "total_amount": amount + tax_amount,
                            # "procurement_request_item": next((i.name for i in parent_pr_doc.get("items", []) if i.item_id == item_id), None) if parent_pr_doc else None,
                        }
                        po_doc.append(new_items_child_table, child_row)
                        # Add to running totals
                        total_amount_excl_tax += amount
                        total_tax_amount += tax_amount

            # 1. Loading Charges
            loading_charges_val = flt(po_data.get("loading_charges"))
            if loading_charges_val != 0:
                tax_rate = 18.0  # As specified
                tax_amount = loading_charges_val * (tax_rate / 100)
                charge_item = {
                    "item_id": "ITEM-999999",
                    "item_name": "Loading/Unloading Charges",
                    "unit": "NOS",
                    "quantity": 1,
                    "category": "Additional Charges",
                    "procurement_package": "Additional Charges",
                    "quote": loading_charges_val,
                    "amount": loading_charges_val,
                    "tax": tax_rate,
                    "tax_amount": tax_amount,
                    "total_amount": loading_charges_val + tax_amount
                }
                po_doc.append(new_items_child_table, charge_item)
                total_amount_excl_tax += loading_charges_val
                total_tax_amount += tax_amount

            # 2. Freight Charges
            freight_charges_val = flt(po_data.get("freight_charges"))
            if freight_charges_val != 0:
                tax_rate = 18.0  # As specified
                tax_amount = freight_charges_val * (tax_rate / 100)
                charge_item = {
                    "item_id": "ITEM-999998",
                    "item_name": "Freight Charges",
                    "unit": "NOS",
                    "quantity": 1,
                    "category": "Additional Charges",
                    "procurement_package": "Additional Charges",
                    "quote": freight_charges_val,
                    "amount": freight_charges_val,
                    "tax": tax_rate,
                    "tax_amount": tax_amount,
                    "total_amount": freight_charges_val + tax_amount
                }
                po_doc.append(new_items_child_table, charge_item)
                total_amount_excl_tax += freight_charges_val
                total_tax_amount += tax_amount

            # Update final PO totals
            po_doc.amount = total_amount_excl_tax
            po_doc.tax_amount = total_tax_amount
            po_doc.total_amount = total_amount_excl_tax + total_tax_amount

            # 1. Get all related project payments
            project_payments = frappe.get_all(
                "Project Payments",
                filters={"document_type": "Procurement Orders", "document_name": po_name},
                fields=["amount", "payment_date"]
            )
            
            total_paid_amount = 0.0
            latest_payment_date = None
            if project_payments:
                for payment in project_payments:
                    total_paid_amount += flt(payment.get("amount"))
                    payment_date = getdate(payment.get("payment_date"))
                    if payment_date and (not latest_payment_date or payment_date > latest_payment_date):
                        latest_payment_date = payment_date
            
            po_doc.latest_payment_date = latest_payment_date

            # 2. Generate Payment Terms child table
            po_doc.set(new_payments_child_table, []) # Clear existing payment terms
            total_po_amount = flt(po_doc.total_amount)

            if total_paid_amount > 0 and total_po_amount > 0:
                # Add "Payment Done" term
                paid_percentage = round((total_paid_amount / total_po_amount) * 100, 2)
                po_doc.append(new_payments_child_table, {
                    "payment_type": "Delivery against Payment",
                    "label": "Payment Done",
                    "percentage": paid_percentage,
                    "amount": total_paid_amount,
                    "status": "Paid"
                })

            # 3. Generate Balance or Return Term
            balance_amount = total_po_amount - total_paid_amount
            if abs(balance_amount) > 100 and total_po_amount > 0: # Use a small tolerance for float comparison
                if balance_amount > 0: # Balance is due from us
                    due_percentage = round((balance_amount / total_po_amount) * 100, 2)
                    po_doc.append(new_payments_child_table, {
                        "payment_type": "Delivery against Payment",
                        "label": "Payment Due",
                        "percentage": due_percentage,
                        "amount": balance_amount,
                        "status": "Created"
                    })
                else: # A return/refund is due from vendor
                    return_amount = abs(balance_amount)
                    return_percentage = round((return_amount / total_po_amount) * 100, 2)
                    po_doc.append(new_payments_child_table, {
                        "payment_type": "Return",
                        "label": "Return Due",
                        "percentage": return_percentage, # Percentage is usually positive
                        "amount": balance_amount, # Amount is negative
                        "status": "Return"
                    })
            
            # --- NEW LOGIC Start: Calculate Latest Delivery Date ---
            delivery_data_json = po_data.get("delivery_data")
            latest_delivery_date = None
            if delivery_data_json:
                try:
                    delivery_data = json.loads(delivery_data_json) if isinstance(delivery_data_json, str) else delivery_data_json
                    delivery_dates = [getdate(d) for d in delivery_data.get("data", {}).keys()]
                    if delivery_dates:
                        latest_delivery_date = max(delivery_dates)
                except (json.JSONDecodeError, AttributeError, ValueError) as e:
                    frappe.log(f"WARN: PO {po_name}: Could not parse delivery_data JSON. Error: {e}")
            
            po_doc.latest_delivery_date = latest_delivery_date
            # --- NEW LOGIC End: Calculate Latest Delivery Date ---

            # Save the fully modified document
            po_doc.flags.ignore_permissions = True
            po_doc.flags.ignore_version = True # Avoid creating new version for a data patch
            po_doc.save()
            
            migrated_count += 1
            if migrated_count % 20 == 0:
                frappe.db.commit() # Commit progress periodically for large datasets
                frappe.log(f"Committed progress. Migrated {migrated_count} POs.")

        except Exception as e:
            frappe.db.rollback()
            frappe.log_error(title=f"Error migrating PO {po_name}", message=frappe.get_traceback())
            failed_count += 1
            failed_pos.append(po_name)
            
    frappe.db.commit() # Final commit
    frappe.log(f"Successfully migrated data for {migrated_count} Procurement Orders.")
    if failed_count > 0:
        frappe.log(f"ERROR: Failed to migrate data for {failed_count} Procurement Orders. Check Error Log.")
        print(f"Failed POs: {'  ;   '.join(failed_pos)}")
    

    #     try:
    #         po_doc = frappe.get_doc(po_doctype, po_name)
    #         po_doc.set(new_child_table_field_name, []) # Clear existing items

    #         data_dict = {}
    #         if isinstance(old_json_string, str):
    #             try:
    #                 data_dict = json.loads(old_json_string)
    #             except json.JSONDecodeError:
    #                 frappe.log(f"PO {po_name}: Invalid JSON in '{old_json_field_name}'.")
    #                 failed_count += 1
    #                 continue
    #         elif isinstance(old_json_string, dict):
    #             data_dict = old_json_string
    #         else:
    #             frappe.log(f"PO {po_name}: Content of '{old_json_field_name}' not string/dict.")
    #             failed_count += 1
    #             continue
            
    #         items_json_list = data_dict.get("list", [])
    #         if not isinstance(items_json_list, list):
    #             frappe.log(f"PO {po_name}: 'list' key in '{old_json_field_name}' not a list.")
    #             failed_count += 1
    #             continue
              
    #         total_amount_excl_tax = 0.0
    #         total_amount = 0.0
    #         total_tax_amount = 0.0
    #         for item_json in items_json_list:
    #             if not isinstance(item_json, dict):
    #                 continue

    #             item_id = item_json.get("name") # This was Item DocName
    #             item_display_name = item_json.get("item")
                
    #             if not item_id or not item_display_name:
    #                 frappe.log(f"PO {po_name}: Item missing ID or display name. Data: {item_json}")
    #                 continue

    #             # Determine selected make
    #             selected_make_docname = item_json.get("make") # From top-level 'make' field first
    #             if not selected_make_docname and isinstance(item_json.get("makes"), dict):
    #                 makes_list_inner = item_json["makes"].get("list", [])
    #                 for make_obj in makes_list_inner:
    #                     if isinstance(make_obj, dict) and make_obj.get("enabled") == "true":
    #                         selected_make_docname = make_obj.get("make") # This is Make DocName
    #                         break
                
    #             cur_item = next((i for i in pr_order_list if i.get("item_id") == item_id), None)

    #             amount = flt(item_json.get("quote")) * flt(item_json.get("quantity"))
    #             tax_amount = amount * (flt(item_json.get("tax")) / 100)
    #             child_row = {
    #                 "item_id": item_id,
    #                 "item_name": item_display_name,
    #                 "unit": item_json.get("unit"),
    #                 "quantity": flt(item_json.get("quantity")),
    #                 "received_quantity": flt(item_json.get("received", 0)),
    #                 "category": item_json.get("category"),
    #                 "procurement_package": item_json.get("procurement_package") or parent_po_work_package,
    #                 "quote": flt(item_json.get("quote")),
    #                 "make": selected_make_docname,
    #                 # "status": item_json.get("status", "Pending Delivery"), # Default status
    #                 "tax": flt(item_json.get("tax")),
    #                 "comment": item_json.get("comment"),
    #                 "po": item_json.get('po') or None,
    #                 "procurement_request_item": cur_item,
    #                 "amount": amount,
    #                 "tax_amount": tax_amount,

    #                 "total_amount": flt(amount) + flt(tax_amount),
    #                 # 'amount', 'tax_amount', 'total_amount' will be calculated by hooks/scripts
    #             }
    #             total_amount_excl_tax += amount
    #             total_amount += amount + tax_amount
    #             total_tax_amount += tax_amount
                
    #             # Basic validation
    #             if not all(child_row.get(f) for f in ["item_id", "unit", "category"]) or \
    #                child_row.get("quantity") is None or child_row.get("quote") is None:
    #                 frappe.log(f"PO {po_name}: Skipping item due to missing required fields for child table. Data: {child_row}")
    #                 continue

    #             po_doc.append(new_child_table_field_name, child_row)
            
    #         # Trigger calculation of amounts after appending all items
    #         # This assumes you have a method on the PO DocType or a controller hook to do this.
    #         # Example: if hasattr(po_doc, "calculate_item_totals"): po_doc.calculate_item_totals()
    #         # For now, we'll assume this is handled by on_update or validate hooks in Purchase Order Item.
            
    #         po_doc.amount = flt(total_amount_excl_tax)
    #         po_doc.tax_amount = flt(total_tax_amount)
    #         po_doc.total_amount = flt(total_amount)
    #         po_doc.save(ignore_permissions=True, update_modified=False) # Save the document with new child table data
    #         migrated_count += 1
    #         if migrated_count % 20 == 0:
    #             frappe.db.commit()
    #             frappe.log(f"Migrated 'order_list' for {migrated_count} POs.")

    #     except Exception as e:
    #         frappe.db.rollback()
    #         frappe.log(f"Error migrating PO {po_name} for 'order_list'. Error: {e}")
    #         failed_count += 1
            
    # frappe.db.commit()
    # frappe.log(f"Successfully migrated 'order_list' for {migrated_count} POs.")
    # if failed_count > 0:
    #     frappe.log(f"Failed 'order_list' migration for {failed_count} POs.")