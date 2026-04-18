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
    reserved by Pending items in other ITRs.

    Returns 0.0 when no submitted RIR exists or item has no entry.
    """
    if not item_id or not source_project:
        return 0.0

    # Latest RIR remaining
    latest_rir_qty = frappe.db.sql(
        """
        SELECT COALESCE(SUM(rie.remaining_quantity), 0)
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
        """,
        {"src": source_project, "item": item_id},
    )
    rir_qty = flt(latest_rir_qty[0][0]) if latest_rir_qty else 0.0

    # Reserved by Pending or Approved ITR items (not yet dispatched via ITM)
    reserved = frappe.db.sql(
        """
        SELECT COALESCE(SUM(itri.transfer_quantity), 0)
        FROM "tabInternal Transfer Request Item" itri
        JOIN "tabInternal Transfer Request" itr ON itri.parent = itr.name
        WHERE itr.source_project = %(src)s
          AND itri.item_id = %(item)s
          AND itri.status IN ('Pending', 'Approved')
          AND (%(exclude)s IS NULL OR itr.name != %(exclude)s)
        """,
        {"src": source_project, "item": item_id, "exclude": exclude_itr},
    )
    reserved_qty = flt(reserved[0][0]) if reserved else 0.0

    return rir_qty - reserved_qty
