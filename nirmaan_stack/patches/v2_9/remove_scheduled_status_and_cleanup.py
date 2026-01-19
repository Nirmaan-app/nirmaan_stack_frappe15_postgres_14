"""
Migration patch to remove "Scheduled" status from PO Payment Terms.

This patch:
1. Converts all "Scheduled" terms to "Created" (eligibility now calculated from due_date)
2. Copies any data from old `status` field to `term_status` if term_status is empty

Part of the elimination of "Scheduled" status in favor of frontend date-based eligibility.
"""

import frappe


def execute():
    """
    Migrate payment term statuses:
    - Convert "Scheduled" -> "Created"
    - Backfill term_status from old status field if needed
    """
    frappe.logger("payment_term_migration").info(
        "Starting migration: Remove Scheduled status and cleanup"
    )

    # 1. Convert all "Scheduled" terms to "Created"
    # These terms will now show as eligible for payment if due_date <= today
    scheduled_count = frappe.db.sql("""
        SELECT COUNT(*) FROM `tabPO Payment Terms`
        WHERE term_status = 'Scheduled'
    """)[0][0]

    if scheduled_count > 0:
        frappe.db.sql("""
            UPDATE `tabPO Payment Terms`
            SET term_status = 'Created'
            WHERE term_status = 'Scheduled'
        """)
        frappe.logger("payment_term_migration").info(
            f"Converted {scheduled_count} 'Scheduled' terms to 'Created'"
        )

    # 2. Copy any data from old status field to term_status if term_status is empty
    # This handles any legacy data that might have status but not term_status
    backfill_count = frappe.db.sql("""
        SELECT COUNT(*) FROM `tabPO Payment Terms`
        WHERE (term_status IS NULL OR term_status = '')
        AND status IS NOT NULL AND status != ''
    """)[0][0]

    if backfill_count > 0:
        frappe.db.sql("""
            UPDATE `tabPO Payment Terms`
            SET term_status = status
            WHERE (term_status IS NULL OR term_status = '')
            AND status IS NOT NULL AND status != ''
        """)
        frappe.logger("payment_term_migration").info(
            f"Backfilled term_status from status field for {backfill_count} terms"
        )

    # 3. Also convert any "Scheduled" values that might be in the old status field
    old_scheduled_count = frappe.db.sql("""
        SELECT COUNT(*) FROM `tabPO Payment Terms`
        WHERE status = 'Scheduled'
    """)[0][0]

    if old_scheduled_count > 0:
        frappe.db.sql("""
            UPDATE `tabPO Payment Terms`
            SET status = 'Created'
            WHERE status = 'Scheduled'
        """)
        frappe.logger("payment_term_migration").info(
            f"Converted {old_scheduled_count} old 'Scheduled' status values to 'Created'"
        )

    frappe.db.commit()

    total_migrated = scheduled_count + backfill_count + old_scheduled_count
    frappe.logger("payment_term_migration").info(
        f"Migration complete. Total records affected: {total_migrated}"
    )
