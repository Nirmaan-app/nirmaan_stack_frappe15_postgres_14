# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Vendor financial-year Work Order limit -- the database sum, the endpoint, and the save guard.

The rule itself (limit, FY dates, which WOs count, the `>` edge) is owned by
`nirmaan_stack.services.wo_vendor_limit`. This module only fetches and enforces it.

Public interface:
    get_vendor_fy_wo_total(vendor)      -> dict   whitelisted; read by the new-WO wizard
    vendor_fy_wo_total(vendor, today)   -> dict   the one-query aggregate
    validate_vendor_fy_limit(doc)       -> None   raises; called from the SR `validate` hook
"""

from datetime import timedelta

import frappe
from frappe import _
from frappe.utils import flt, fmt_money, getdate

from nirmaan_stack.services.wo_vendor_limit import (
    EXCLUDED_STATUS,
    GST_OFF,
    WO_VENDOR_FY_LIMIT,
    exceeds_limit,
    financial_year_bounds,
)


def vendor_fy_wo_total(vendor, today=None) -> dict:
    """Pre-GST sum of the vendor's GST-off, non-rejected WOs created this financial year."""
    fy_start, fy_end_exclusive = financial_year_bounds(getdate(today))
    total, wo_count = frappe.db.sql(
        """
        SELECT COALESCE(SUM(w.quantity * w.rate), 0), COUNT(DISTINCT s.name)
        FROM "tabService Requests" s
        JOIN "tabWork Order Items" w
          ON w.parent = s.name AND w.parenttype = 'Service Requests'
        WHERE s.vendor = %(vendor)s
          AND s.gst = %(gst_off)s
          AND COALESCE(s.status, '') != %(excluded_status)s
          AND s.creation >= %(fy_start)s
          AND s.creation < %(fy_end_exclusive)s
        """,
        {
            "vendor": vendor,
            "gst_off": GST_OFF,
            "excluded_status": EXCLUDED_STATUS,
            "fy_start": fy_start,
            "fy_end_exclusive": fy_end_exclusive,
        },
    )[0]
    return {
        "vendor": vendor,
        "total": flt(total, 2),
        "wo_count": wo_count,
        "fy_start": str(fy_start),
        "fy_end": str(fy_end_exclusive - timedelta(days=1)),
        "limit": WO_VENDOR_FY_LIMIT,
    }


@frappe.whitelist()
def get_vendor_fy_wo_total(vendor: str) -> dict:
    frappe.has_permission("Service Requests", "read", throw=True)
    return vendor_fy_wo_total(vendor)


def validate_vendor_fy_limit(doc) -> None:
    """Refuse a NEW Work Order that takes its vendor above the FY limit. Caller guards is_new()."""
    if not doc.vendor:
        return
    new_wo_amount = sum(flt(row.quantity) * flt(row.rate) for row in doc.work_order_items or [])
    summary = vendor_fy_wo_total(doc.vendor)
    if not exceeds_limit(summary["total"], new_wo_amount):
        return
    frappe.throw(
        _(
            "This vendor's Work Orders (GST off) for this financial year total {0}. With this "
            "Work Order ({1}) it becomes {2}, above the {3} limit."
        ).format(
            fmt_money(summary["total"], currency="INR"),
            fmt_money(new_wo_amount, currency="INR"),
            fmt_money(summary["total"] + new_wo_amount, currency="INR"),
            fmt_money(WO_VENDOR_FY_LIMIT, currency="INR"),
        ),
        title=_("Vendor Work Order Limit Reached"),
    )
