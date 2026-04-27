"""Internal Transfer Request (ITR) controller.

Handles validation, status derivation, and the availability guard
that prevents over-committing inventory across concurrent ITRs.
"""

import frappe
from frappe.utils import flt


def validate(doc, method):
    """Basic invariants on every save."""
    if doc.source_project and doc.target_project and doc.source_project == doc.target_project:
        frappe.throw("Source and target projects must differ.")

    for row in (doc.items or []):
        if flt(row.transfer_quantity) <= 0:
            frappe.throw(
                f"Row {row.idx}: transfer quantity must be greater than zero."
            )


def after_insert(doc, method):
    """Emit itr:new event to admins."""
    from nirmaan_stack.integrations.controllers.internal_transfer_memo import _get_admins

    recipients = _get_admins() | {doc.requested_by}
    message = {"itr": doc.name, "status": doc.status}
    frappe.db.commit()
    for user in recipients:
        if user:
            frappe.publish_realtime(event="itr:new", message=message, user=user)


def available_quantity(item_id, source_project, exclude_itr=None):
    """Available transfer qty for (item_id, source_project), net of qty
    reserved by Pending/Approved ITR items and dispatched ITM transfers
    after the latest RIR.

    Returns 0.0 when no submitted RIR exists or item has no entry.
    """
    if not item_id or not source_project:
        return 0.0

    # Latest RIR remaining + report_date (needed for ITM deduction window)
    latest_rir = frappe.db.sql(
        """
        SELECT COALESCE(SUM(rie.remaining_quantity), 0) AS qty,
               rir.report_date
        FROM "tabRemaining Item Entry" rie
        JOIN "tabRemaining Items Report" rir ON rie.parent = rir.name
        WHERE rir.project = %(src)s
          AND rir.status = 'Submitted'
          AND rir.name = (
            SELECT name FROM "tabRemaining Items Report"
            WHERE project = %(src)s AND status = 'Submitted'
            ORDER BY report_date DESC, creation DESC LIMIT 1
          )
          AND rie.item_id = %(item)s
        GROUP BY rir.report_date
        """,
        {"src": source_project, "item": item_id},
        as_dict=True,
    )
    rir_qty = flt(latest_rir[0].qty) if latest_rir else 0.0
    rir_date = str(latest_rir[0].report_date) if latest_rir else None

    # Reserved by Pending/Approved ITR items whose linked ITM has NOT
    # been dispatched yet.  Once an ITM is dispatched, the reservation
    # is replaced by the dispatch-deduction query below.
    reserved = frappe.db.sql(
        """
        SELECT COALESCE(SUM(itri.transfer_quantity), 0)
        FROM "tabInternal Transfer Request Item" itri
        JOIN "tabInternal Transfer Request" itr ON itri.parent = itr.name
        WHERE itr.source_project = %(src)s
          AND itri.item_id = %(item)s
          AND itri.status IN ('Pending', 'Approved')
          AND NOT EXISTS (
              SELECT 1 FROM "tabInternal Transfer Memo" itm_chk
              WHERE itm_chk.name = itri.linked_itm
                AND itm_chk.status IN ('Dispatched', 'Partially Delivered', 'Delivered')
          )
          AND (%(exclude)s IS NULL OR itr.name != %(exclude)s)
        """,
        {"src": source_project, "item": item_id, "exclude": exclude_itr},
    )
    reserved_qty = flt(reserved[0][0]) if reserved else 0.0

    # Dispatched ITM transfers after the latest RIR date.
    # Only post-RIR dispatches are deducted to avoid double-counting with
    # quantities the PM already reduced in a newer report.
    itm_deduction = 0.0
    if rir_date:
        itm_ded = frappe.db.sql(
            """
            SELECT COALESCE(SUM(itmi.transfer_quantity), 0)
            FROM "tabInternal Transfer Memo Item" itmi
            JOIN "tabInternal Transfer Memo" itm ON itmi.parent = itm.name
            WHERE itm.source_project = %(src)s
              AND itmi.item_id = %(item)s
              AND itm.status IN ('Dispatched', 'Partially Delivered', 'Delivered')
              AND itm.dispatched_on::date > %(rir_date)s
            """,
            {"src": source_project, "item": item_id, "rir_date": rir_date},
        )
        itm_deduction = flt(itm_ded[0][0]) if itm_ded else 0.0

    return max(rir_qty - reserved_qty - itm_deduction, 0.0)
