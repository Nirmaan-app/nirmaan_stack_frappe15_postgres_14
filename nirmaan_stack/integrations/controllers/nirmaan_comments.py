# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Who may read a Work Order's remarks (#1529 follow-up, spec #1528 story 4).

A Work Order's remarks are its details, so a remark on one (`reference_doctype` = Service Requests) is
readable only by users who may read that Work Order: its role rows and the user's project User
Permissions. The remark endpoints check it (`api/sr_remarks.assert_can_read_work_order`); these two hooks
make the doctype itself obey it, because the screens also read remarks through `/api/resource`.

Remarks on every other doctype are left to the role rows, as before.
"""

import frappe

WORK_ORDER = "Service Requests"


def has_permission(doc, ptype=None, user=None, debug=False):
    """Deny a remark on a Work Order the user may not read. Returns None (the role rows decide)
    otherwise: a `has_permission` hook can only deny."""
    if doc.get("reference_doctype") != WORK_ORDER or not doc.get("reference_name"):
        return None
    if not frappe.db.exists(WORK_ORDER, doc.reference_name):
        return None
    user = user or frappe.session.user
    return None if frappe.has_permission(WORK_ORDER, "read", doc=doc.reference_name, user=user) else False


def get_permission_query_conditions(user=None, doctype=None):
    """A list holds a Work Order's remarks only where the user may read that Work Order: the Work Order
    list query Frappe itself builds for the user (role rows and User Permissions) is the subquery."""
    user = user or frappe.session.user
    if user == "Administrator":
        return ""
    try:
        readable = frappe.get_list(WORK_ORDER, fields=["name"], user=user, run=0, limit_page_length=0,
                                   order_by=None)
    except frappe.PermissionError:
        readable = None
    other_doctype = f"COALESCE(\"tabNirmaan Comments\".reference_doctype, '') != {frappe.db.escape(WORK_ORDER)}"
    if not readable:
        return other_doctype
    return f"({other_doctype} OR \"tabNirmaan Comments\".reference_name IN ({readable}))"
