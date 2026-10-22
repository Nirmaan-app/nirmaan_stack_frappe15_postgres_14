# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Who may read a Work Order's item rows (spec #1528 story 4, walk W1).

`GET /api/resource/Work Order Items?parent=Service Requests` checks only read on the Service Requests
doctype, not on each row's Work Order, so a user on one project could list another project's rows and rates.
These two hooks scope the child doctype to the Work Orders the user may read, as the remarks are
(`controllers/nirmaan_comments.readable_work_orders_sql`). The Work Order's own reads (`frappe.get_doc`)
load its rows without them.
"""

import frappe

from nirmaan_stack.integrations.controllers.nirmaan_comments import WORK_ORDER, readable_work_orders_sql


def has_permission(doc, ptype=None, user=None, debug=False):
    """Deny a row of a Work Order the user may not read; None otherwise (the role rows decide)."""
    if doc.get("parenttype") != WORK_ORDER or not doc.get("parent") or not frappe.db.exists(WORK_ORDER, doc.parent):
        return None
    user = user or frappe.session.user
    return None if frappe.has_permission(WORK_ORDER, "read", doc=doc.parent, user=user) else False


def get_permission_query_conditions(user=None, doctype=None):
    """A list holds only rows of Work Orders the user may read."""
    user = user or frappe.session.user
    if user == "Administrator":
        return ""
    readable = readable_work_orders_sql(user)
    if not readable:
        return "1=0"
    return f'"tabWork Order Items".parent IN ({readable})'
