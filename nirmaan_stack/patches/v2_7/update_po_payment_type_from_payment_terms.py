import frappe
import json
from frappe.utils import getdate

# Define the constants outside the function for clarity and easy modification
PARENT_DOCTYPE = "Procurement Orders"
CHILD_DOCTYPE = "PO Payment Terms" 
OLD_VALUE = "Delivery against payment" # The value with the typo (lowercase 'a')
NEW_VALUE = "Delivery against Payment" # The corrected value (uppercase 'A')

def _run_data_correction_patch():
    """
    Core logic to iterate through Procurement Orders and correct payment_type fields
    in both the parent and child documents using frappe.db.set_value.
    """
    
    # Initialize counters and logs
    updated_count = 0
    skipped_count = 0
    error_count = 0
    # List to store names of documents that failed or were skipped (for detailed logs)
    skipped_orders = []
    failed_orders = []

    # 1. Get the names of all 'Procurement Orders' documents
    all_orders = frappe.get_list(PARENT_DOCTYPE, pluck='name')
    
    total_orders = len(all_orders)
    
    print(f"\n--- Starting data correction patch for {total_orders} {PARENT_DOCTYPE} (using set_value) ---\n")

    for order_name in all_orders:
        parent_updated = False
        child_updates = 0
        
        try:
            # Load the parent document to get its current field value AND the child table rows
            # We must load the doc to access the child table rows (order_doc.payment_terms)
            order_doc = frappe.get_doc(PARENT_DOCTYPE, order_name)

            # --- A. Check and Update Parent Field using frappe.db.set_value ---
            current_value = order_doc.payment_type
            
            # Check for Typo OR Empty value
            if current_value == OLD_VALUE or not current_value:
                # Update the parent field via set_value
                frappe.db.set_value(
                    PARENT_DOCTYPE, 
                    order_name, 
                    "payment_type", 
                    NEW_VALUE,
                    update_modified=False  # <--- CRUCIAL: PREVENTS MODIFIED DATE/USER UPDATE
                )
                parent_updated = True
            
            
            # --- B. Check and Update ALL Child Fields using frappe.db.set_value ---
            if order_doc.payment_terms:
                
                # Loop through every row in the 'payment_terms' child table
                for term in order_doc.payment_terms:
                    # Check for Typo OR Empty value
                    if term.payment_type == OLD_VALUE or not term.payment_type:
                        
                        # Update the child record via set_value
                        frappe.db.set_value(
                            CHILD_DOCTYPE, 
                            term.name, # Use the child row's unique ID
                            "payment_type", 
                            NEW_VALUE,
                            update_modified=False # PREVENTS MODIFIED DATE/USER UPDATE on child row
                        )
                        child_updates += 1

            
            # --- C. Commit if an update was performed ---
            if parent_updated or child_updates > 0:
                frappe.db.commit()
                updated_count += 1
                
                update_log = []
                if parent_updated:
                    update_log.append("Parent field 'payment_type'")
                if child_updates > 0:
                    update_log.append(f"Child table 'payment_terms' ({child_updates} row(s))")
                    
                print(f"Updated: {order_name} - Changes: {', '.join(update_log)}")
            else:
                # Case: No typo and no empty fields were found
                skipped_count += 1
                skipped_orders.append(f"{order_name} (No correction needed)")

        except Exception as e:
            # Log any errors
            frappe.log_error(
                title=f"Patch Error in {PARENT_DOCTYPE}: {order_name}", 
                message=str(e)
            )
            # Rollback any uncommitted changes for the current document
            frappe.db.rollback()
            error_count += 1
            failed_orders.append(f"{order_name} ({e})")
            print(f"ERROR: {order_name} failed. Check Error Log for details.")


# Define the core logic as a reusable function
def process_procurement_orders(date_filter):
    """
    Core function to copy payment_terms[0].payment_type to parent.payment_type
    filtered by the given date condition, using frappe.db.set_value.
    """
    # Initialize counters for this run
    updated_count = 0
    skipped_count = 0
    error_count = 0
    
    skipped_orders = []
    failed_orders = []
    PARENT_DOCTYPE = 'Procurement Orders'

    # 1. Get the names of 'Procurement Orders' documents with the specified filter
    all_orders = frappe.get_list(
        PARENT_DOCTYPE,
        pluck='name',
        # Apply the date filter passed to the function
        filters=date_filter,
        # Order by creation date for sequential processing
        order_by='creation asc'
    )
    
    total_orders = len(all_orders)
    
    # Use standard print for starting message
    print(f"\n--- Starting run for {total_orders} {PARENT_DOCTYPE} with filter: {date_filter} ---")

    for order_name in all_orders:
        try:
            # 2. Load the full document (needed to access child table rows)
            order_doc = frappe.get_doc(PARENT_DOCTYPE, order_name)
            print(f"Processing creation date: {order_doc.creation} for PO: {order_name}")

            # Check if the child table has any entries
            if order_doc.payment_terms and len(order_doc.payment_terms) > 0:
                # 3. Get the value from the first row (index 0) of the child table
                first_term = order_doc.payment_terms[0]
                
                # Check if the payment_type field actually has a value
                if first_term.payment_type:
                    payment_type_value = first_term.payment_type
                    
                    # 4. Update the new parent field 'payment_type'
                    if order_doc.payment_type:
                        
                        # USE frappe.db.set_value instead of doc.save()
                        frappe.db.set_value(
                            PARENT_DOCTYPE,
                            order_name,
                            "payment_type",
                            payment_type_value,
                        )
                        frappe.db.commit()
                        updated_count += 1
                        print(f"Updated: {order_name} with Payment Type: {payment_type_value}")
                    else:
                        # Case: Value already matches, skip update
                        skipped_count += 1
                        skipped_orders.append(f"{order_name} (Value already set)")
                        print(f"Skipped1: {order_name} (Value already set)")
                        
                else:
                    # Case: Child table exists, but the 'payment_type' field is empty
                    skipped_count += 1
                    skipped_orders.append(f"{order_name} (Payment Term exists but 'payment_type' is empty)")
                    print(f"Skipped2: {order_name} (Value already set)")

            else:
                # Case: No 'PO Payment Terms' child entries found
                skipped_count += 1
                skipped_orders.append(f"{order_name} (No Payment Terms found)")
                print(f"Skipped3: {order_name} (Value already set)")


        except Exception as e:
            # Log any errors
            frappe.log_error(
                title=f"Patch Error in Procurement Orders: {order_name}", 
                message=str(e)
            )
            frappe.db.rollback()
            error_count += 1
            failed_orders.append(f"{order_name} ({e})")
            print(f"ERROR: {order_name} failed. Check Error Log for details.")

    # --- Return Results ---
    return {
        'total': total_orders,
        'updated': updated_count,
        'skipped': skipped_count,
        'error': error_count,
        'skipped_orders': skipped_orders,
        'failed_orders': failed_orders
    }


def execute():
    # Define the split date

    try:
        updated_count = _run_data_correction_patch()
        frappe.msgprint(f"{PARENT_DOCTYPE} data correction patch completed. Updated {updated_count} records.")
    except Exception as e:
        frappe.log_error(title="Critical Patch Failure", message=str(e))
        frappe.msgprint(f"Critical error during patch execution: {str(e)}", title="Patch Failed", indicator="red")
        raise # Re-raise to mark the patch as failed


    SPLIT_DATE = getdate("2025-08-31") 


    # --- JOB 1: creation date < 31/08/2025 ---
    filter_1 = {'creation': ['<', SPLIT_DATE]}
    results_1 = process_procurement_orders(filter_1)
    
    # --- JOB 2: creation date >= 31/08/2025 ---
    # Note: Use >= to catch documents created exactly on the split date and after
    filter_2 = {'creation': ['>=', SPLIT_DATE]}
    results_2 = process_procurement_orders(filter_2)
    
    # --- Combined Final Summary ---
    
    total_processed = results_1['total'] + results_2['total']
    total_updated = results_1['updated'] + results_2['updated']
    total_skipped = results_1['skipped'] + results_2['skipped']
    total_error = results_1['error'] + results_2['error']
    all_failed_orders = results_1['failed_orders'] + results_2['failed_orders']

    summary_message = f"""
\n---------------------------------------------------
### Procurement Orders Update Patch Completed - FINAL COMBINED SUMMARY

**Total Orders Processed:** {total_processed}
**Successfully Updated:** {total_updated}
**Skipped/No Update Needed:** {total_skipped}
**Failed (Error):** {total_error}

--- Detailed Breakdown ---
* Run 1 (< {SPLIT_DATE}): Updated {results_1['updated']}, Skipped {results_1['skipped']}, Skipped {results_1["skipped_orders"]}, Failed {results_1['error']}
* Run 2 (>= {SPLIT_DATE}): Updated {results_2['updated']}, Skipped {results_2['skipped']}, Skipped {results_2["skipped_orders"]},Failed {results_2['error']}
---------------------------------------------------
"""
    # Use standard print for the summary
    print(summary_message)

    if all_failed_orders:
        print(f"\n*** WARNING: {total_error} orders failed. Check Frappe Error Log for full details. ***")
        # Log to frappe for file logging persistence
        frappe.log_error(
            title="Procurement Orders Patch Failures Summary", 
            message=json.dumps(all_failed_orders, indent=2)
        )