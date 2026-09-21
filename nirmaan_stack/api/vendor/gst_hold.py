# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Remove a vendor's GST Hold -- the Admin action on the Vendor page (ADR-0028).

    remove_gst_hold(vendor) -> {"switched": [...], "skipped": [...]}

Removing the hold switches GST Applicable ON for every GST-off Work Order behind this financial
year's total, then clears the hold, all in one transaction. The vendor must have a GST number:
without one the Admin is told to add it first and nothing changes.

⚠️ ONLY "Approved" WOs ARE SWITCHED; any other status is skipped and stays GST-off. The owner named
Amendment (19/09/2026): saving a WO in Amendment re-sends the amendment notifications, and that
branch of `integrations/controllers/service_requests.on_update` commits once per recipient, which
would break the one-transaction guarantee. Every GST-off WO on the site was Approved on that date.

Each WO is SAVED, not `set_value`d: `ServiceRequests.on_update` sees the gst change and recomputes
`total_amount` (+18%) and `amount_due`, and the change lands in the WO's Version history.
"""

import frappe
from frappe import _

from nirmaan_stack.api.service_requests.vendor_fy_limit import vendor_fy_gst_off_work_orders
from nirmaan_stack.services.role_profiles import is_nirmaan_admin
from nirmaan_stack.services.wo_vendor_limit import GST_ON

SWITCHABLE_STATUS = "Approved"


@frappe.whitelist(methods=["POST"])
def remove_gst_hold(vendor: str) -> dict:
    if not is_nirmaan_admin(frappe.session.user):
        frappe.throw(_("Only an Admin can remove GST Hold."), frappe.PermissionError)

    row = frappe.db.get_value("Vendors", vendor, ["gst_hold", "vendor_gst"], as_dict=True)
    if not row:
        frappe.throw(_("Vendor {0} not found.").format(vendor), frappe.DoesNotExistError)
    if not row.gst_hold:
        frappe.throw(_("This vendor is not on GST Hold."))
    if not (row.vendor_gst or "").strip():
        frappe.throw(_("Add this vendor's GST number first to remove GST Hold."))

    switched, skipped = [], []
    for wo in vendor_fy_gst_off_work_orders(vendor):
        if wo.status != SWITCHABLE_STATUS:
            skipped.append(wo.name)
            continue
        sr = frappe.get_doc("Service Requests", wo.name)
        sr.gst = GST_ON
        sr.save(ignore_permissions=True)
        switched.append(wo.name)

    # `set_value` skips the Vendors doc_events on purpose: they only maintain Vendor Category rows,
    # and nothing is derived from `gst_hold`. The comment below is the audit line.
    frappe.db.set_value("Vendors", vendor, "gst_hold", 0)
    frappe.get_doc("Vendors", vendor).add_comment(
        "Info",
        _("GST Hold removed. GST Applicable switched ON for {0} Work Order(s){1}.").format(
            len(switched),
            _("; skipped (not Approved): {0}").format(", ".join(skipped)) if skipped else "",
        ),
    )
    frappe.db.commit()
    return {"switched": switched, "skipped": skipped}
