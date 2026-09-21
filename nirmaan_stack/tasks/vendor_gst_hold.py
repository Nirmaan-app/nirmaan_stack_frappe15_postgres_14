# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""GST Hold -- the one daily job (ADR-0028). Wired in hooks.py `scheduler_events["cron"]` at 04:00.

    update_gst_holds   GST Hold ON for a vendor when ALL THREE hold (owner, 19/09/2026):
                         1. no GST number
                         2. vendor_type Service or Material & Service
                         3. GST-off WOs this FY total > Rs 15L
                       every other vendor  ->  left exactly as it is

⚠️ THIS JOB NEVER RELEASES A VENDOR (owner, 19/09/2026). A hold stays ON when the total drops, when a
new financial year starts and when a GST number is added -- only an Admin takes it off, with
`api/vendor/gst_hold.remove_gst_hold`. A hand untick on a vendor that still meets all three is put
back ON by the next run.

⚠️ 04:00, NOT 04:30. The Vendor Hold credit job (`vendor_credit_update`, 04:30) loads and saves every
vendor as a full row; a GST Hold write landing between its load and its save would either be
overwritten with the stale value or trip its timestamp check and stop that job part-way. This job is
a few queries, done well before 04:30.

The write is `frappe.db.set_value` and skips the Vendors doc_events on purpose: those hooks only
maintain Vendor Category rows, and nothing is derived from `gst_hold`.
"""

import frappe

from nirmaan_stack.api.service_requests.vendor_fy_limit import vendor_fy_totals
from nirmaan_stack.services.wo_vendor_limit import exceeds_limit


def update_gst_holds() -> dict:
    """The daily job. Returns {"held": [...]} -- the vendors it put ON hold this run."""
    # `vendor_fy_totals` already holds only vendors meeting 1 and 2; the limit is 3.
    over = {vendor for vendor, total in vendor_fy_totals().items() if exceeds_limit(total)}

    held = sorted(over - set(held_vendors()))
    if held:
        frappe.db.set_value("Vendors", {"name": ("in", held)}, "gst_hold", 1)
    return {"held": held}


def held_vendors() -> list:
    """Every vendor on GST Hold right now."""
    return frappe.get_all("Vendors", filters={"gst_hold": 1}, pluck="name")
