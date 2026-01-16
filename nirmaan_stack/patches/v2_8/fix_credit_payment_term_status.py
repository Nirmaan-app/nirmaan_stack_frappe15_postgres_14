"""
Patch: fix_credit_payment_term_status

This patch fixes credit payment terms that are stuck in "Created" status
when their due_date has already passed.

Background:
-----------
The scheduled task `payment_term_worker.py` was using the old field name
"status" instead of the new field name "term_status" after a migration.
This caused credit terms to never transition from "Created" to "Scheduled"
when their due dates arrived.

This patch:
1. Updates all Credit payment terms where:
   - term_status = "Created"
   - due_date <= today
   - No linked project_payment (meaning no payment was ever requested)

2. Sets their term_status to "Scheduled" so users can request payment

Safe to re-run: Yes (idempotent - only affects terms meeting all criteria)
"""

import frappe
from frappe.utils import today


def execute():
    """
    Fix credit payment terms stuck in 'Created' status when due date has passed.
    """
    today_date = today()

    # Count records before update for reporting
    stuck_terms = frappe.db.sql("""
        SELECT COUNT(*) as count
        FROM `tabPO Payment Terms`
        WHERE term_status = 'Created'
        AND payment_type = 'Credit'
        AND due_date <= %s
        AND (project_payment IS NULL OR project_payment = '')
    """, (today_date,), as_dict=True)

    records_to_fix = stuck_terms[0].count if stuck_terms else 0

    if records_to_fix == 0:
        print("✔ No credit payment terms need fixing. All terms have correct status.")
        return

    print(f"Found {records_to_fix} credit payment term(s) stuck in 'Created' status with past due dates.")

    # Perform the update
    frappe.db.sql("""
        UPDATE `tabPO Payment Terms`
        SET term_status = 'Scheduled',
            modified = NOW(),
            modified_by = %s
        WHERE term_status = 'Created'
        AND payment_type = 'Credit'
        AND due_date <= %s
        AND (project_payment IS NULL OR project_payment = '')
    """, (frappe.session.user or 'Administrator', today_date))

    frappe.db.commit()

    print(f"✅ Successfully updated {records_to_fix} credit payment term(s) from 'Created' to 'Scheduled'.")

    # Log this for audit purposes
    frappe.log_error(
        message=f"Fixed {records_to_fix} credit payment terms stuck in 'Created' status. "
                f"These terms had due_date <= {today_date} but were not transitioned to 'Scheduled' "
                f"due to a bug in payment_term_worker.py (using old 'status' field instead of 'term_status').",
        title="Credit Payment Term Status Fix Applied"
    )
