# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Read-only: the figures a Work Order's PDF footer prints (spec #1528 story 68, review round 3 U1).

    get_work_order_print_totals(work_order) -> {"sub_total", "total"}
    get_amended_totals(work_orders) -> {work order: total}   the Approve Amended list

`sub_total` is the value of the rows the PDF prints; `total` is the Work Order's stored `total_amount`, or,
while an amendment is open (the stored total is still the one from before it), the total its accept will
store, by the same rule (`work_order_gst.work_order_total`). The browser only rounds them for display.
"""

import frappe
from frappe.utils import flt

from nirmaan_stack.api.sr_remarks import assert_can_read_work_order
from nirmaan_stack.services.work_order_gst import items_value, work_order_total
from nirmaan_stack.services.work_order_lifecycle import AMENDMENT

SR = "Service Requests"


@frappe.whitelist(methods=["GET"])
def get_work_order_print_totals(work_order: str) -> dict:
    """The footer figures of `work_order`'s PDF. Raises `frappe.PermissionError` unless the caller may read it.

    Example (₹1,00,000 of items, GST on, Approved): {"sub_total": 100000.0, "total": 118000.0}
    """
    assert_can_read_work_order(work_order)
    doc = frappe.get_doc(SR, work_order)
    return {"sub_total": flt(items_value(doc.work_order_items), 2), "total": _total_of(doc)}


def _total_of(doc) -> float:
    """The Work Order's total, or while an amendment is open the total its accept will store."""
    if doc.status == AMENDMENT:
        return flt(work_order_total(items_value(doc.work_order_items), doc.gst), 2)
    return flt(doc.total_amount, 2)


@frappe.whitelist(methods=["GET"])
def get_amended_totals(work_orders) -> dict:
    """`{work order: total}` for the Approve Amended list's "Amended Value" (walk W4): each Work Order's
    total as its accept will store it (the stored one for a Work Order not under amendment). Work Orders
    the caller may not read, and names that are none, are left out.

    Args:
        work_orders: JSON list of Service Requests names (one page of the list).
    """
    names = [n for n in (frappe.parse_json(work_orders) or []) if isinstance(n, str)]
    totals = {}
    for name in names:
        if not frappe.db.exists(SR, name) or not frappe.has_permission(SR, "read", doc=name):
            continue
        totals[name] = _total_of(frappe.get_doc(SR, name))
    return totals
