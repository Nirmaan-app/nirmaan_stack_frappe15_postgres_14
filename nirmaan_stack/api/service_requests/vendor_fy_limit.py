# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Vendor GST-off Work Orders this financial year -- the database reads behind GST Hold, and its guard.

The rule itself (limit, FY dates, which WOs count, the `>` edge) is owned by
`nirmaan_stack.services.wo_vendor_limit`. This module only fetches it and enforces the hold.

Public interface:
    get_vendor_fy_wo_total(vendor)              -> dict   whitelisted; new-WO wizard + Vendor page
    vendor_fy_wo_total(vendor, today)           -> dict   one vendor: total, hold flag, the WOs
    vendor_fy_gst_off_work_orders(vendor, today)-> list   the WOs that make up that total
    vendor_fy_totals(today)                     -> dict   every holdable vendor's total, one GROUP BY (daily job)
    validate_vendor_gst_hold(doc)               -> None   raises; called from the SR `validate` hook
"""

from datetime import timedelta

import frappe
from frappe import _
from frappe.utils import flt, getdate

from nirmaan_stack.services.wo_vendor_limit import (
    EXCLUDED_STATUS,
    GST_HOLD_VENDOR_TYPES,
    GST_OFF,
    WO_VENDOR_FY_LIMIT,
    financial_year_bounds,
)

# The Work Orders that count toward a vendor's FY total. ONE definition, shared by the per-vendor
# list and the all-vendor GROUP BY, so the Vendor page, the wizard and the daily job can never disagree.
_COUNTED_WO = """
    s.gst = %(gst_off)s
    AND COALESCE(s.status, '') != %(excluded_status)s
    AND s.creation >= %(fy_start)s
    AND s.creation < %(fy_end_exclusive)s
"""


def _counted_wo_params(today=None) -> dict:
    fy_start, fy_end_exclusive = financial_year_bounds(getdate(today))
    return {
        "gst_off": GST_OFF,
        "excluded_status": EXCLUDED_STATUS,
        "fy_start": fy_start,
        "fy_end_exclusive": fy_end_exclusive,
    }


def vendor_fy_gst_off_work_orders(vendor, today=None) -> list:
    """The vendor's counted WOs this FY, oldest first. `total_amount` is pre-GST on a GST-off WO."""
    return frappe.db.sql(
        f"""
        SELECT s.name, s.project, p.project_name, s.status, s.creation,
               COALESCE(s.total_amount, 0) AS total_amount,
               COALESCE(s.amount_paid, 0) AS amount_paid
        FROM "tabService Requests" s
        LEFT JOIN "tabProjects" p ON p.name = s.project
        WHERE s.vendor = %(vendor)s AND {_COUNTED_WO}
        ORDER BY s.creation, s.name
        """,
        {**_counted_wo_params(today), "vendor": vendor},
        as_dict=True,
    )


def vendor_fy_wo_total(vendor, today=None) -> dict:
    """One vendor's FY total, its GST Hold flag and the WOs behind the total."""
    fy_start, fy_end_exclusive = financial_year_bounds(getdate(today))
    work_orders = vendor_fy_gst_off_work_orders(vendor, today)
    return {
        "vendor": vendor,
        "gst_hold": frappe.db.get_value("Vendors", vendor, "gst_hold") or 0,
        "total": flt(sum(flt(wo.total_amount) for wo in work_orders), 2),
        "wo_count": len(work_orders),
        "fy_start": str(fy_start),
        "fy_end": str(fy_end_exclusive - timedelta(days=1)),
        "limit": WO_VENDOR_FY_LIMIT,
        "work_orders": work_orders,
    }


def vendor_fy_totals(today=None) -> dict:
    """{vendor: FY total} for every vendor that CAN be put on GST Hold -- a Service / Material &
    Service vendor with no GST number -- that has at least one counted WO. One query. Every other
    vendor is left out: it can never be put on GST Hold, whatever its total."""
    rows = frappe.db.sql(
        f"""
        SELECT s.vendor, COALESCE(SUM(s.total_amount), 0)
        FROM "tabService Requests" s
        JOIN "tabVendors" v ON v.name = s.vendor
        WHERE v.vendor_type IN %(vendor_types)s
          AND COALESCE(TRIM(v.vendor_gst), '') = ''
          AND {_COUNTED_WO}
        GROUP BY s.vendor
        """,
        {**_counted_wo_params(today), "vendor_types": GST_HOLD_VENDOR_TYPES},
    )
    return {vendor: flt(total, 2) for vendor, total in rows}


@frappe.whitelist()
def get_vendor_fy_wo_total(vendor: str) -> dict:
    frappe.has_permission("Service Requests", "read", throw=True)
    return vendor_fy_wo_total(vendor)


def validate_vendor_gst_hold(doc) -> None:
    """Refuse a NEW Work Order for a vendor on GST Hold. Caller guards is_new()."""
    if not doc.vendor or not frappe.db.get_value("Vendors", doc.vendor, "gst_hold"):
        return
    frappe.throw(
        _("This vendor is on GST Hold, so a new Work Order can't be created for it. Contact Admin to remove the GST Hold."),
        title=_("Vendor on GST Hold"),
    )
