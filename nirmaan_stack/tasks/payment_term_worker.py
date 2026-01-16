# my_custom_app/my_custom_app/utils/payment_term_worker.py

import frappe
from frappe.utils import today

# We add @frappe.whitelist() so you can easily test this from the browser console.
@frappe.whitelist()
def update_payment_term_status():
    """
    This function is designed to be run daily by the scheduler.
    It finds all 'PO Payment Terms' child records that meet the criteria:
    1. Status is 'Created'
    2. Payment Type is 'Credit'
    3. Due Date is on or before today (handles overdue terms)
    ...and updates their status to 'Scheduled'.
    """
    # --- Optional Security ---
    # For a scheduled job, this isn't strictly required, but it's good practice
    # if you want to manually trigger it via API.
    # frappe.only_for("System Manager") 

    try:
        today_date = today()
        
        # Using frappe.logger is the standard way to log messages.
        # They will appear in the 'Error Log' list in the UI.
        frappe.logger("payment_term_worker").info("Starting daily job to update due payment terms.")

        #
        # --- WHAT CHANGED ---
        # 1. Added `payment_type: "Credit"` to the filters.
        # 2. Changed `due_date` filter to `["<=", today_date]` to include overdue items.
        #
        payments_to_update = frappe.get_all(
            "PO Payment Terms",
            filters={
                "term_status": "Created",  # Use new field name (migrated from 'status')
                "payment_type": "Credit",  # Only target credit terms
                "due_date": ["<=", today_date],  # Find terms due today or in the past
            },
            fields=["name", "parent"]  # 'parent' gives the PO ID for logging
        )

        if not payments_to_update:
            frappe.logger("payment_term_worker").info(f"No credit payment terms due for update on {today_date}.")
            return {"status": "success", "message": "No payment terms to update."}

        updated_count = 0
        frappe.logger("payment_term_worker").info(f"Found {len(payments_to_update)} payment term(s) to process.")
        
        for payment in payments_to_update:
            try:
                # frappe.db.set_value is the most efficient way to update a single field
                # without triggering all document hooks (like on_update).
                frappe.db.set_value(
                    "PO Payment Terms",
                    payment.name,
                    "term_status",  # Use new field name (migrated from 'status')
                    "Scheduled"
                )
                updated_count += 1
                
            except Exception as e:
                # If a single update fails, log the error but continue with the next one.
                frappe.logger("payment_term_worker").error(
                    f"Failed to update payment term {payment.name} in PO {payment.parent}. Error: {e}"
                )

        # After the loop, commit all successful changes to the database at once.
        frappe.db.commit()

        success_message = f"Successfully updated {updated_count} payment term(s) to 'Scheduled'."
        frappe.logger("payment_term_worker").info(success_message)

        return {"status": "success", "message": success_message}

    except Exception as e:
        # If a major error occurs, rollback any potential changes.
        frappe.db.rollback()
        # Use frappe.log_error to capture the full traceback for easy debugging.
        frappe.log_error(title="Payment Term Worker Failed", message=frappe.get_traceback())
        return {"status": "error", "message": f"An unexpected error occurred in the main process: {str(e)}"}


