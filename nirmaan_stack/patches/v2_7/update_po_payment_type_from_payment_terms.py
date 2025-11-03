
import frappe
import json # Import json for better log display of lists

def execute():
    # Initialize counters for tracking
    updated_count = 0
    skipped_count = 0
    error_count = 0
    
    # List to store names of documents that failed or were skipped (for detailed logs)
    skipped_orders = []
    failed_orders = []

    # 1. Get the names of all 'Procurement Orders' documents
    all_orders = frappe.get_list(
        'Procurement Orders',
        pluck='name',
    )
    
    total_orders = len(all_orders)
    
    # Use standard print for starting message
    print(f"\n--- Starting patch for {total_orders} Procurement Orders ---\n")

    for order_name in all_orders:
        try:
            # 2. Load the full document
            order_doc = frappe.get_doc('Procurement Orders', order_name)

            # Check if the child table has any entries
            if order_doc.payment_terms and len(order_doc.payment_terms) > 0:
                # 3. Get the value from the first row (index 0) of the child table
                first_term = order_doc.payment_terms[0]
                
                # Check if the payment_type field actually has a value
                if first_term.payment_type:
                    payment_type_value = first_term.payment_type
                    
                    # 4. Update the new parent field 'payment_type'
                    if order_doc.payment_type != payment_type_value:
                        order_doc.payment_type = payment_type_value

                        # 5. Save the document and commit the change
                        order_doc.save(ignore_permissions=True, ignore_version=True) 
                        frappe.db.commit()
                        updated_count += 1
                        print(f"Updated: {order_name} with Payment Type: {payment_type_value}")
                    else:
                        # Case: Value already matches, skip update
                        skipped_count += 1
                        skipped_orders.append(f"{order_name} (Value already set)")
                        
                else:
                    # Case: Child table exists, but the 'payment_type' field is empty
                    skipped_count += 1
                    skipped_orders.append(f"{order_name} (Payment Term exists but 'payment_type' is empty)")
            else:
                # Case: No 'PO Payment Terms' child entries found
                skipped_count += 1
                skipped_orders.append(f"{order_name} (No Payment Terms found)")

        except Exception as e:
            # Log any errors using frappe.log_error (good practice for patches)
            frappe.log_error(
                title=f"Patch Error in Procurement Orders: {order_name}", 
                message=str(e)
            )
            # Rollback any uncommitted changes for the current document if an error occurs
            frappe.db.rollback()
            error_count += 1
            failed_orders.append(f"{order_name} ({e})")
            print(f"ERROR: {order_name} failed. Check Error Log for details.")

    # --- Final Summary ---
    summary_message = f"""
\n---------------------------------------------------
### Procurement Orders Update Patch Completed

**Total Orders Processed:** {total_orders}
**Successfully Updated:** {updated_count}
**Skipped/No Update Needed:** {skipped_count}
**Failed (Error):** {error_count}
---------------------------------------------------
"""
    # Use standard print for the summary
    print(summary_message)

    if skipped_orders:
        # Log the skipped orders to the console. Limiting to 20 for readability.
        print(f"\n--- Skipped Orders ({len(skipped_orders)}): ---")
        for order in skipped_orders[:20]:
            print(f"- {order}")
        if len(skipped_orders) > 20:
            print(f"and {len(skipped_orders) - 20} more...")

    if failed_orders:
        # Log the failed orders to the console.
        print(f"\n*** WARNING: {error_count} orders failed. Check Frappe Error Log for full details. ***")
        
        # Also log to frappe for file logging persistence
        frappe.log_error(
            title="Procurement Orders Patch Failures Summary", 
            message=json.dumps(failed_orders, indent=2)
        )

# import frappe

# def execute():
#     # 1. Get the names of all 'Procurement Orders' documents
#     # Using frappe.db.get_all with pluck='name' is efficient for fetching only names
#     all_orders = frappe.get_list(
#         'Procurement Orders',
#         fields=['name', 'payment_terms', 'payment_type'], # Fetching payment_terms is optional but can be used for initial filtering
#         pluck='name',
#         # Optionally, you can add a filter to only process documents that don't have the new field set yet:
#         # filters={'payment_type': ['is', 'set']} 
#     )
    
#     frappe.msgprint(f"Starting patch for {len(all_orders)} Procurement Orders...")

#     for order_name in all_orders:
#         try:
#             # 2. Load the full document
#             order_doc = frappe.get_doc('Procurement Orders', order_name)

#             # Check if the child table has any entries
#             # We assume the child table is a list field named 'payment_terms' on the parent DocType.
#             if order_doc.payment_terms and len(order_doc.payment_terms) > 0:
#                 # 3. Get the value from the first row (index 0) of the child table
#                 # The child table DocType is "PO Payment Terms" and the field is "payment_type"
#                 first_term = order_doc.payment_terms[0]
                
#                 # Check if the payment_type field actually has a value
#                 if first_term.payment_type:
#                     payment_type_value = first_term.payment_type
                    
#                     # 4. Update the new parent field 'payment_type'
#                     order_doc.payment_type = payment_type_value

#                     # 5. Save the document and commit the change
#                     order_doc.save(ignore_permissions=True)
#                     frappe.db.commit()
#                     # frappe.msgprint(f"Updated {order_name} with payment_type: {payment_type_value}")

#         except Exception as e:
#             # Log any errors to help with debugging
#             frappe.log_error(
#                 title=f"Patch Error in Procurement Orders: {order_name}", 
#                 message=str(e)
#             )
#             # Rollback any uncommitted changes for the current document if an error occurs
#             frappe.db.rollback()

#     frappe.msgprint("Procurement Orders update patch completed.")