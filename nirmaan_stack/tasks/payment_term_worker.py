# my_custom_app/my_custom_app/utils/payment_term_worker.py

import frappe
from frappe.utils import today

# We add @frappe.whitelist() so you can easily test this from the browser console
# or via an API call, just like your other script.
@frappe.whitelist()
def update_payment_term_status():
    """
    This function is designed to be run daily.
    It finds all 'PO Payment Terms' child records that meet the criteria:
    1. Status is 'Created'
    2. Due Date is today
    ...and updates their status to 'Scheduled'.
    """
    try:
        # Get today's date in 'YYYY-MM-DD' format, which is how Frappe stores dates.
        today_date = today()
        
        # Log the start of the process for easy debugging in the Error Log.
        # frappe.log("Starting payment term status update job PaymentTermWorker")

        # Use frappe.get_all to efficiently find the specific child table rows we need to update.
        # This is much faster than loading every single Purchase Order.
        # We need the 'name' of the child row to update it, and 'parent' to log which PO it belongs to.
        payments_to_update = frappe.get_all(
            "PO Payment Terms",  # The name of the Child DocType
            filters={
                "status": "Created",
                "due_date": today_date,
            },
            fields=["name", "parent"]  # 'parent' will give the Purchase Order ID
        )

        if not payments_to_update:
            # frappe.log_message(f"No payment terms due for update on {today_date}.", "PaymentTermWorker")
            return {"status": "success", "message": "No payment terms to update."}

        updated_count = 0
        print("s {updated_count}:Here worker ")
        for payment in payments_to_update: 
            try:
                # frappe.db.set_value is the most efficient way to update a single field
                # in any document (parent or child) without triggering all document hooks (like on_update).
                # This is perfect for a simple status change.
                frappe.db.set_value(
                    "PO Payment Terms",  # DocType name
                    payment.name,        # The unique name of the child table row
                    "status",            # The field to update
                    "Scheduled"          # The new value
                )
                updated_count += 1
                
                # Log each successful update for traceability.
                # frappe.log_message(
                #     f"Updated status to 'Scheduled' for payment term {payment.name} in PO {payment.parent}",
                #     "PaymentTermWorker"
                # )

            except Exception as e:
                # If a single update fails, log the error but continue with the next one.
                frappe.log_error(
                    f"Failed to update payment term {payment.name} in PO {payment.parent}. Error: {e}",
                    "PaymentTermWorkerError"
                )

        # After the loop has finished, commit all the changes to the database at once.
        frappe.db.commit()

        success_message = f"Successfully updated {updated_count} payment term(s) to 'Scheduled'."
        # frappe.log_message(success_message, "PaymentTermWorker")

        return {"status": "success", "message": success_message}

    except Exception as e:
        # If a major error occurs (e.g., the query fails), rollback any potential changes.
        frappe.db.rollback()
        frappe.log_error(frappe.get_traceback(), "PaymentTermWorkerError")
        return {"status": "error", "message": f"An error occurred in the main process: {str(e)}"}