"""Internal Transfer Request (ITR) controller.

Handles validation, status derivation, and the availability guard
that prevents over-committing inventory across concurrent ITRs.
"""

import frappe
from frappe.utils import flt


def validate(doc, method):
    """Basic invariants on every save."""
    source_type = getattr(doc, "source_type", None) or "Project"
    target_type = getattr(doc, "target_type", None) or "Project"

    if source_type == "Project" and not doc.source_project:
        frappe.throw("Source Project is required for project transfers.")
    if target_type == "Project" and not doc.target_project:
        frappe.throw("Target Project is required for project transfers.")
    if source_type == "Warehouse" and target_type == "Warehouse":
        frappe.throw("Source and target cannot both be Warehouse.")
    if (
        source_type == "Project" and target_type == "Project"
        and doc.source_project and doc.target_project
        and doc.source_project == doc.target_project
    ):
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


def available_quantity(item_id, source_project, exclude_itr=None, make=None):
    """Available transfer qty for (item_id, source_project, make), net of
    qty reserved by Pending/Approved ITR items and dispatched ITM transfers
    after the latest RIR.

    When ``make`` is provided, all three legs (RIR row, reservations, dispatch
    deductions) are filtered by `make IS NOT DISTINCT FROM %(make)s` so that
    a Tata-make dispatch does not consume Jindal-make availability. Empty
    string is normalised to NULL. When ``make`` is None, behaviour is the
    legacy "sum across all makes" — preserved for callers that haven't been
    migrated to make-aware availability.

    Returns 0.0 when no submitted RIR exists or item has no entry.
    """
    if not item_id or not source_project:
        return 0.0

    # Normalise empty-string to None so `IS NOT DISTINCT FROM` matches NULL rows.
    if isinstance(make, str):
        make = make.strip() or None

    make_filter = "AND rie.make IS NOT DISTINCT FROM %(make)s" if make is not None else ""
    itri_make_filter = "AND itri.make IS NOT DISTINCT FROM %(make)s" if make is not None else ""
    itmi_make_filter = "AND itmi.make IS NOT DISTINCT FROM %(make)s" if make is not None else ""

    # Latest RIR remaining + modified timestamp (needed for ITM deduction window).
    # We key the deduction on `modified` rather than report_date so same-day
    # dispatches that happen AFTER the PM finalizes the report are still deducted.
    latest_rir = frappe.db.sql(
        f"""
        SELECT COALESCE(SUM(rie.remaining_quantity), 0) AS qty,
               rir.report_date,
               rir.modified
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
          {make_filter}
        GROUP BY rir.report_date, rir.modified
        """,
        {"src": source_project, "item": item_id, "make": make},
        as_dict=True,
    )
    rir_qty = flt(latest_rir[0].qty) if latest_rir else 0.0
    rir_modified = latest_rir[0].modified if latest_rir else None

    # Reserved by Pending/Approved ITR items whose linked ITM has NOT
    # been dispatched yet.  Once an ITM is dispatched, the reservation
    # is replaced by the dispatch-deduction query below.
    reserved = frappe.db.sql(
        f"""
        SELECT COALESCE(SUM(itri.transfer_quantity), 0)
        FROM "tabInternal Transfer Request Item" itri
        JOIN "tabInternal Transfer Request" itr ON itri.parent = itr.name
        WHERE itr.source_project = %(src)s
          AND itri.item_id = %(item)s
          {itri_make_filter}
          AND itri.status IN ('Pending', 'Approved')
          AND NOT EXISTS (
              SELECT 1 FROM "tabInternal Transfer Memo" itm_chk
              WHERE itm_chk.name = itri.linked_itm
                AND itm_chk.status IN ('Dispatched', 'Partially Delivered', 'Delivered')
          )
          AND (%(exclude)s IS NULL OR itr.name != %(exclude)s)
        """,
        {"src": source_project, "item": item_id, "exclude": exclude_itr, "make": make},
    )
    reserved_qty = flt(reserved[0][0]) if reserved else 0.0

    # Dispatched ITM transfers after the latest RIR was saved.
    # Only post-submit dispatches are deducted to avoid double-counting with
    # quantities the PM already reduced in the report.
    itm_deduction = 0.0
    if rir_modified:
        itm_ded = frappe.db.sql(
            f"""
            SELECT COALESCE(SUM(itmi.transfer_quantity), 0)
            FROM "tabInternal Transfer Memo Item" itmi
            JOIN "tabInternal Transfer Memo" itm ON itmi.parent = itm.name
            WHERE itm.source_project = %(src)s
              AND itmi.item_id = %(item)s
              {itmi_make_filter}
              AND itm.status IN ('Dispatched', 'Partially Delivered', 'Delivered')
              AND itm.dispatched_on > %(rir_modified)s
            """,
            {"src": source_project, "item": item_id, "rir_modified": rir_modified, "make": make},
        )
        itm_deduction = flt(itm_ded[0][0]) if itm_ded else 0.0

    # Material moved to Warehouse via ITM (target_type=Warehouse) is
    # already counted in itm_deduction above, since those ITMs have a
    # dispatched_on timestamp after the RIR's modified timestamp.
    # No separate WR deduction.

    return max(rir_qty - reserved_qty - itm_deduction, 0.0)


def warehouse_available_quantity(item_id, make=None, exclude_itr=None):
    """Available warehouse stock for a (item_id, make) pair, net of pending reservations.

    Warehouse stock is keyed by (item_id, make) — each distinct pair has its
    own row and its own quantity. `make` may be None for items with no known
    make, in which case we match the NULL bucket.

    Subtracts active reservations that haven't yet been reflected on-hand:
      - Approved ITMs from warehouse (not yet dispatched) with the same make
      - Pending/Approved ITRs from warehouse with the same make whose ITM is
        not yet created or not dispatched

    Returns 0.0 when the (item_id, make) row has no warehouse stock.
    """
    if not item_id:
        return 0.0

    # Normalise empty-string → None so the SQL IS NULL branch fires.
    make = make or None

    on_hand = frappe.db.get_value(
        "Warehouse Stock Item",
        {"item_id": item_id, "make": make},
        "quantity",
    ) or 0.0
    on_hand = flt(on_hand)

    # `make IS NOT DISTINCT FROM %(make)s` handles both values and NULL cleanly
    # (treats NULL = NULL as a match, unlike plain `=`).
    approved_itm = frappe.db.sql(
        """
        SELECT COALESCE(SUM(itmi.transfer_quantity), 0)
        FROM "tabInternal Transfer Memo Item" itmi
        JOIN "tabInternal Transfer Memo" itm ON itmi.parent = itm.name
        WHERE itm.source_type = 'Warehouse'
          AND itmi.item_id = %(item)s
          AND itmi.make IS NOT DISTINCT FROM %(make)s
          AND itm.status = 'Approved'
        """,
        {"item": item_id, "make": make},
    )
    reserved_itm = flt(approved_itm[0][0]) if approved_itm else 0.0

    reserved = frappe.db.sql(
        """
        SELECT COALESCE(SUM(itri.transfer_quantity), 0)
        FROM "tabInternal Transfer Request Item" itri
        JOIN "tabInternal Transfer Request" itr ON itri.parent = itr.name
        WHERE itr.source_type = 'Warehouse'
          AND itri.item_id = %(item)s
          AND itri.make IS NOT DISTINCT FROM %(make)s
          AND itri.status IN ('Pending', 'Approved')
          AND NOT EXISTS (
              SELECT 1 FROM "tabInternal Transfer Memo" itm_chk
              WHERE itm_chk.name = itri.linked_itm
                AND itm_chk.status IN ('Approved', 'Dispatched', 'Partially Delivered', 'Delivered')
          )
          AND (%(exclude)s IS NULL OR itr.name != %(exclude)s)
        """,
        {"item": item_id, "make": make, "exclude": exclude_itr},
    )
    total_reserved = flt(reserved[0][0]) if reserved else 0.0

    return max(on_hand - reserved_itm - total_reserved, 0.0)
