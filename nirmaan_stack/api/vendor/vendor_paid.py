# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Read what reached each vendor in a date range (#1461, ADR-0034).

A thin door onto `services/vendor_paid`: Paid PO / Work Order payments, plus the TDS withheld from the
vendor on the Work Order ones, less Received Vendor Refunds, each on its own date (the tax on its payment's). The Vendor report reads it for its dated paid figures. Dates are optional and inclusive
(`YYYY-MM-DD`).

    nirmaan_stack.api.vendor.vendor_paid.get_vendors_paid
        from_date="2026-04-01", to_date="2027-03-31"
        -> {"VEN-0001": 700.0, "VEN-0002": -100.0, ...}   vendors with no money in the range are left out
"""

import frappe
from frappe import _

from nirmaan_stack.services.vendor_paid import vendors_paid


@frappe.whitelist()
def get_vendors_paid(from_date: str | None = None, to_date: str | None = None) -> dict:
    """`{vendor: paid}` for the range; a vendor missing from the reply had nothing paid in it."""
    for doctype in ("Project Payments", "Vendor Refunds"):
        if not frappe.has_permission(doctype, "read"):
            frappe.throw(_("Not permitted to read {0}.").format(doctype), frappe.PermissionError)
    return vendors_paid(from_date or None, to_date or None)
