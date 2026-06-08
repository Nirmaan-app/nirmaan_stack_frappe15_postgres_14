# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Drop the Internal Transfer Request layer entirely.

Background
----------
The original two-step transfer flow had ITR (request, holds Pending items) →
admin approval → ITM (memo, dispatch + delivery). The ITR layer has been
collapsed: ITMs are now created directly from the inventory picker via
``api.internal_transfers.create_itms`` and are born in ``Approved`` status.

This patch is **destructive**:
  * any in-flight Pending ITR is intentionally lost (per product decision)
  * the ``transfer_request`` link column on every existing ITM is nulled
    before the field itself is removed from the doctype JSON
  * the ``Internal Transfer Request`` and ``Internal Transfer Request Item``
    DocType records and their physical tables are dropped

Idempotent — safe to run on environments that have already been migrated
(every step short-circuits via ``IF EXISTS`` / ``frappe.db.exists``).
"""

import frappe


def execute():
    # 1. Null out the legacy ITM → ITR link on every existing ITM so removing
    #    the field from the doctype JSON in the same release doesn't trip a
    #    Frappe migrate integrity check.
    if _column_exists("tabInternal Transfer Memo", "transfer_request"):
        frappe.db.sql(
            'UPDATE "tabInternal Transfer Memo" SET transfer_request = NULL '
            'WHERE transfer_request IS NOT NULL'
        )

    # 2. Normalise any legacy ITMs created via the deleted
    #    ``create_itms_from_inventory`` endpoint, which used the now-removed
    #    "Pending Approval" status. The new doctype Select enum is
    #    Approved / Dispatched / Partially Delivered / Delivered — leaving
    #    stale rows would silently render as the literal string with no UI
    #    or backend handling. They map cleanly to "Approved" in the new
    #    flow (auto-approval is the only behaviour now).
    if frappe.db.table_exists("Internal Transfer Memo"):
        frappe.db.sql(
            'UPDATE "tabInternal Transfer Memo" '
            "SET status = 'Approved' "
            "WHERE status = 'Pending Approval'"
        )
        # Same defensive sweep for child item rows in case any inherited
        # the legacy status from their parent.
        if _column_exists("tabInternal Transfer Memo Item", "status"):
            frappe.db.sql(
                'UPDATE "tabInternal Transfer Memo Item" '
                "SET status = 'Approved' "
                "WHERE status = 'Pending Approval'"
            )

    # 3. Delete child rows then parent rows (Frappe child tables don't
    #    cascade automatically on raw DELETE).
    if frappe.db.table_exists("Internal Transfer Request Item"):
        frappe.db.sql('DELETE FROM "tabInternal Transfer Request Item"')
    if frappe.db.table_exists("Internal Transfer Request"):
        frappe.db.sql('DELETE FROM "tabInternal Transfer Request"')

    # 4. Remove the DocType records (Frappe's metadata).
    for dt in ("Internal Transfer Request Item", "Internal Transfer Request"):
        if frappe.db.exists("DocType", dt):
            frappe.delete_doc("DocType", dt, force=True, ignore_permissions=True)

    # 5. Drop the physical tables (defensive — `delete_doc` usually handles
    #    this, but being explicit means the patch can clean up after a
    #    half-migrated environment too).
    for table in (
        "tabInternal Transfer Request Item",
        "tabInternal Transfer Request",
    ):
        frappe.db.sql(f'DROP TABLE IF EXISTS "{table}"')

    # 6. Drop dangling User Permissions / Property Setters / Custom Fields
    #    that referenced the removed doctypes. Without this they linger as
    #    orphan rows; benign but noisy in `bench --site ... migrate` output.
    for table, columns in (
        ("tabUser Permission", ("allow",)),
        ("tabProperty Setter", ("doc_type",)),
        ("tabCustom Field", ("dt",)),
        ("tabDocPerm", ("parent",)),
    ):
        if not frappe.db.table_exists(table):
            continue
        for column in columns:
            if not _column_exists(table, column):
                continue
            frappe.db.sql(
                f'DELETE FROM "{table}" WHERE "{column}" IN '
                "('Internal Transfer Request', 'Internal Transfer Request Item')"
            )

    frappe.db.commit()


def _column_exists(table_name: str, column_name: str) -> bool:
    """True if ``column_name`` exists on ``table_name`` (PostgreSQL)."""
    if not frappe.db.table_exists(table_name):
        return False
    rows = frappe.db.sql(
        """
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = %(table)s
          AND column_name = %(column)s
        LIMIT 1
        """,
        {"table": table_name, "column": column_name},
    )
    return bool(rows)
