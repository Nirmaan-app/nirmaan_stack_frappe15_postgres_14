# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Remove a vendor's GST Hold -- the Admin action on the Vendor page (ADR-0028, Amendment A).

    remove_gst_hold(vendor) -> {"vendor": vendor, "gst_hold": 0}

It only clears the hold. It changes no Work Order (#1538): until then it switched the vendor's
GST-off Work Orders of this financial year to GST-on, rewriting the totals of paid and finalized ones.
GST now follows the vendor: once the vendor's GST number is entered, its new Work Orders are approved
GST-on, and its old GST-off ones appear on the GST mismatch list for accounts to decide one by one
with Match GST to vendor (`api/service_requests/match_gst_to_vendor`).

No GST number is needed. A vendor that still qualifies is put back on hold by the next morning's job
(`tasks/vendor_gst_hold`), exactly as an untick by hand is.
"""

import frappe
from frappe import _

from nirmaan_stack.services.role_profiles import is_nirmaan_admin


@frappe.whitelist(methods=["POST"])
def remove_gst_hold(vendor: str) -> dict:
    if not is_nirmaan_admin(frappe.session.user):
        frappe.throw(_("Only an Admin can remove GST Hold."), frappe.PermissionError)

    held = frappe.db.get_value("Vendors", vendor, "gst_hold")
    if held is None:
        frappe.throw(_("Vendor {0} not found.").format(vendor), frappe.DoesNotExistError)
    if not held:
        frappe.throw(_("This vendor is not on GST Hold."))

    # `set_value` skips the Vendors doc_events on purpose: they only maintain Vendor Category rows,
    # and nothing is derived from `gst_hold`. The comment below is the audit line.
    frappe.db.set_value("Vendors", vendor, "gst_hold", 0)
    frappe.get_doc("Vendors", vendor).add_comment(
        "Info", _("GST Hold removed. No Work Order was changed."),
    )
    frappe.db.commit()
    return {"vendor": vendor, "gst_hold": 0}
