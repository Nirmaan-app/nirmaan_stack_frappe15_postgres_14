# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Read the `Vendor Refunds` recorded against one PO / Work Order -- the "Vendor Refunds" dialog on a PO's
and a WO's Transaction Details card. (The vendor page's tab reads the doctype through the shared data
table instead.)

⚠️ PERMISSION-AWARE (`frappe.get_list`). The doctype's READ DocPerms mirror `Project Payments`' read roles
-- refunds are shown beside those payments -- and a user's project User Permissions apply exactly as
they do to the payments, so a project-scoped user sees the refunds of their own projects only.
"""

import frappe

from nirmaan_stack.services.vendor_refunds import REFUND_DOCUMENT_FIELDS, VENDOR_REFUNDS

_FIELDS = [
    "name",
    "vendor",
    "project",
    "document_type",
    "document_name",
    "amount",
    "utr",
    "payment_date",
    "description",
    "refund_attachment",
    "creation",
]


@frappe.whitelist()
def get_vendor_refunds(document_type: str | None = None, document_name: str | None = None):
    """The vendor refunds against one PO / WO, newest payment date first."""
    if not document_name or document_type not in REFUND_DOCUMENT_FIELDS:
        frappe.throw("Name a PO or a Work Order to list its vendor refunds.")
    return frappe.get_list(
        VENDOR_REFUNDS,
        filters={"document_type": document_type, "document_name": document_name},
        fields=_FIELDS,
        order_by="payment_date desc, creation desc",
        limit_page_length=0,
    )
