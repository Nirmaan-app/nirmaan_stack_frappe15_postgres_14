# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Read-only: the figures a Work Order's PDF footer prints (spec #1528 story 68, review round 3 U1).

    get_work_order_print_totals(work_order) -> {"sub_total", "total"}

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
    sub_total = flt(items_value(doc.work_order_items), 2)
    total = work_order_total(sub_total, doc.gst) if doc.status == AMENDMENT else doc.total_amount
    return {"sub_total": sub_total, "total": flt(total, 2)}
