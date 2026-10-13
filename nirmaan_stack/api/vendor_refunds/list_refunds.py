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

from nirmaan_stack.services.vendor_refunds import REFUND_DOCUMENT_FIELDS, VENDOR_REFUNDS, bank_matched

_FIELDS = [
    "name",
    "vendor",
    "project",
    "document_type",
    "document_name",
    "amount",
    # Received / Reconciliation Pending / Cancelled (#1398): only a Received one lowers the paid amount.
    "status",
    # Who recorded it as waiting from Adjust Payments (#1400); blank for a refund made from a bank line.
    "waiting_created_by",
    # Received with no bank line (#1403): the "No bank proof" badge, with who marked it, when and why.
    "no_bank_line",
    "no_bank_line_by",
    "no_bank_line_at",
    "no_bank_line_reason",
    "utr",
    "payment_date",
    "description",
    "refund_attachment",
    "creation",
]


@frappe.whitelist()
def get_vendor_refunds(document_type: str | None = None, document_name: str | None = None):
    """The vendor refunds against one PO / WO, newest payment date first.

    Each row also carries `bank_matched`: a Bulk Import credit line is matched to it right now, so its
    UTR is that line's reference and the edit dialog keeps it fixed (`utr_edit_problem`).
    """
    if not document_name or document_type not in REFUND_DOCUMENT_FIELDS:
        frappe.throw("Name a PO or a Work Order to list its vendor refunds.")
    rows = frappe.get_list(
        VENDOR_REFUNDS,
        filters={"document_type": document_type, "document_name": document_name},
        fields=_FIELDS,
        order_by="payment_date desc, creation desc",
        limit_page_length=0,
    )
    matched = bank_matched([row.name for row in rows])
    for row in rows:
        row["bank_matched"] = row.name in matched
    return rows
