# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Read-only: the Work Order / Purchase Order value behind every row of the TDS register
(Reports → Payment → TDS Deduction), for its "WO/PO excl. GST" and "WO/PO incl. GST" columns.

Its own endpoint because `Payment TDS Deduction.document_name` is a Dynamic Link, which the list API
cannot join. It answers for the WHOLE register, not one page, so the screen's CSV export carries the
values for every row it writes.

⚠️ "TDS" HERE IS TAX DEDUCTED AT SOURCE, not a Technical Data Sheet.
"""

import frappe

from nirmaan_stack.services.payment_tds import (
    PROCUREMENT_ORDER_DOCTYPE,
    SERVICE_REQUEST_DOCTYPE,
    TDS_DOCTYPE,
)
from nirmaan_stack.services.tds_register_orders import purchase_order_value, work_order_value


@frappe.whitelist()
def get_tds_register_order_values() -> dict:
    """Each order the register names, with its total in the GST column it belongs to.

    Raises `frappe.PermissionError` unless the caller may read `Payment TDS Deduction`. The orders are
    read through `frappe.get_list`, so one the caller may not read is simply absent.

    Returns:
        `{order name: {"excl_gst": float | None, "incl_gst": float | None}}`; exactly one of the two is set.

    Example:
        {"SR-00260-001079": {"excl_gst": None, "incl_gst": 3351.2},
         "SR-00203-001021": {"excl_gst": 40000.0, "incl_gst": None},
         "PO/059/00091/25-26": {"excl_gst": None, "incl_gst": 8024.0}}
    """
    frappe.has_permission(TDS_DOCTYPE, "read", throw=True)

    referenced = frappe.get_list(
        TDS_DOCTYPE,
        fields=["document_type", "document_name"],
        filters=[["document_name", "is", "set"]],
        distinct=True,
        limit_page_length=0,
    )
    names_by_type: dict[str, list[str]] = {}
    for row in referenced:
        names_by_type.setdefault(row.document_type, []).append(row.document_name)

    values = {}
    work_orders = names_by_type.get(SERVICE_REQUEST_DOCTYPE)
    if work_orders:
        for wo in frappe.get_list(
            SERVICE_REQUEST_DOCTYPE,
            filters=[["name", "in", work_orders]],
            fields=["name", "gst", "total_amount"],
            limit_page_length=0,
        ):
            values[wo.name] = work_order_value(wo.gst, wo.total_amount)

    purchase_orders = names_by_type.get(PROCUREMENT_ORDER_DOCTYPE)
    if purchase_orders:
        for po in frappe.get_list(
            PROCUREMENT_ORDER_DOCTYPE,
            filters=[["name", "in", purchase_orders]],
            fields=["name", "amount", "tax_amount", "total_amount"],
            limit_page_length=0,
        ):
            values[po.name] = purchase_order_value(po.amount, po.tax_amount, po.total_amount)

    return values
