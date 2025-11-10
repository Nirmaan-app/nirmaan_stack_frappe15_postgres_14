import frappe
import json
from frappe.utils import getdate # Import utility functions

def execute():
    """
    Updates the 'approval_date' field (a Date field) in Project Payments using 
    two mechanisms:
    1. Primary: The creation date of the Version record where status changed to 'Approved'.
    2. Fallback: If no 'Approved' version is found, and the current status is 'Paid' 
       with a 'payment_date', use 'payment_date' for 'approval_date'.
    
    This patch is idempotent and avoids updating audit fields.
    It tracks documents updated by version, updated by fallback, and skipped documents.
    """
    
    doctype = 'Project Payments'
    updates_performed = False 
    
    # Tracking arrays for the final summary
    updated_by_version = []
    updated_by_fallback = []
    skipped_no_date_source = []
    payments_to_process_count = 0

    try:
        # 1. Select documents where 'approval_date' is not yet set.
        payments_data = frappe.get_all(
            doctype,
            # filters={'approval_date': ['=', '']}, 
            fields=['name', 'status', 'payment_date']
        )
        payments_to_process_count = len(payments_data) 

        if not payments_data:
            print("No Project Payments documents found that require 'approval_date' update.")
            return

        print(f"Found {len(payments_data)} Project Payments documents to process.")

        for payment_doc in payments_data:
            payment_name = payment_doc.name
            
            # 2. Find all relevant Version records, ordered by creation date.
            versions = frappe.get_all(
                'Version',
                filters={'ref_doctype': doctype, 'docname': payment_name},
                fields=['creation', 'data'],
                order_by='creation asc'
            )

            approval_creation_datetime = None
            
            # 3. Primary: Iterate through versions to find the one that set the status to 'Approved'
            for version in versions:
                try:
                    data = json.loads(version.data)
                except (json.JSONDecodeError, TypeError):
                    continue

                changes = data.get('changed')
                
                if changes and isinstance(changes, list):
                    for change in changes:
                        if (isinstance(change, list) and len(change) >= 3 and
                            change[0] == 'status' and change[2] == 'Approved'):
                            
                            old_status = change[1] if len(change) > 1 else "Unknown/Initial"
                            log_message = (
                                f"Project Payments: {payment_name} - PRIMARY: "
                                f"Status change detected: '{old_status}' -> 'Approved'. "
                                f"Version creation datetime: {version.creation}"
                            )
                            print(log_message)
                            # frappe.log(message=log_message, doctype=doctype, name=payment_name)
                            
                            approval_creation_datetime = version.creation
                            break 
                
                if approval_creation_datetime:
                    break

            # 4. Update the Project Payments document (Primary Update)
            if approval_creation_datetime:
                # Case 1: Updated by Version
                
                approval_date_only = getdate(approval_creation_datetime) 
                
                log_message = (
                    f"Updating Project Payments: {payment_name}. "
                    f"Setting 'approval_date' to: {approval_date_only} (From Version)."
                )
                print(log_message)
                # frappe.log(message=log_message, doctype=doctype, name=payment_name)
                
                frappe.db.set_value(
                    doctype,
                    payment_name,
                    'approval_date',
                    approval_date_only,
                    update_modified=False 
                )
                updates_performed = True
                updated_by_version.append(payment_name) # <-- TRACKING
            
            # 5. Fallback Logic: If no 'Approved' version was found
            else:
                log_message = f"Project Payments: {payment_name} - No 'Approved' version found."
                print(log_message)
                
                # Check for Fallback condition
                if payment_doc.status == 'Paid' and not payment_doc.payment_date in (None, ''):
                    # Case 2: Updated by Fallback
                    
                    fallback_date = getdate(payment_doc.payment_date)
                    
                    log_message = (
                        f"Project Payments: {payment_name} - FALLBACK: Status is 'Paid' and 'payment_date' is set. "
                        f"Setting 'approval_date' to 'payment_date': {fallback_date}"
                    )
                    print(log_message)
                    # frappe.log(message=log_message, doctype=doctype, name=payment_name)
                    
                    frappe.db.set_value(
                        doctype,
                        payment_name,
                        'approval_date',
                        fallback_date, 
                        update_modified=False 
                    )
                    updates_performed = True
                    updated_by_fallback.append(payment_name) # <-- TRACKING
                else:
                    # Case 3: Skipped - No date source found
                    skipped_no_date_source.append(payment_name) # <-- TRACKING
                    log_message = f"Project Payments: {payment_name} - SKIPPED: No 'Approved' version and not eligible for 'Paid' fallback."
                    print(log_message)


        # 6. Commit and Final Messages
        if updates_performed:
            frappe.db.commit() 
            print("Database changes committed.")
        else:
            print("No updates were performed, database commit skipped.")
            
        print("\n--- Summary ---")
        
        # Case 1 Summary
        print(f"1) Updated by Version ('Approved' Status Change): Total = {len(updated_by_version)}")
        if updated_by_version:
            print(f"   Names: {updated_by_version}")
        
        # Case 2 Summary
        print(f"2) Updated by Fallback ('Paid' Status + 'payment_date'): Total = {len(updated_by_fallback)}")
        if updated_by_fallback:
            print(f"   Names: {updated_by_fallback}")
            
        # Case 3 Summary
        print(f"3) Skipped (No 'Approved' Version AND No 'Paid' Fallback): Total = {len(skipped_no_date_source)}")
        if skipped_no_date_source:
            print(f"   Names: {skipped_no_date_source}")
            
        print(f"\nProject Payments approval_date patch execution complete. Total documents in DocType: {payments_to_process_count}")

    except Exception as e:
        # 7. Rollback if any unexpected error occurs to prevent partial updates
        frappe.db.rollback()
        error_message = f"An unexpected error occurred during patch execution. All changes have been rolled back: {str(e)}"
        print(error_message)
        frappe.log_error(message=error_message, title="Project Payments Patch Error")
        # Re-raise the exception so the Frappe patch runner marks the patch as failed
        raise e