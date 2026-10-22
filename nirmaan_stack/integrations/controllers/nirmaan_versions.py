import json

import frappe

from nirmaan_stack.integrations.controllers.nirmaan_comments import readable_work_orders_sql
from nirmaan_stack.services.role_profiles import ADMIN_PROFILE, has_role_profile
from nirmaan_stack.services.work_order_amendment import PRE_AMENDMENT_KEY, pre_amendment_state

SNAPSHOT_KEPT_REFUSAL = "An amendment snapshot is the Work Order's audit record: it can't be deleted or changed."

def generate_sr_amend_version(doc, method):
    if doc.ref_doctype != "Service Requests":
        return
    data = json.loads(doc.data)

    # Check if the status changed from "Approved" to "Amendment"
    status_change = next((change for change in data['changed'] if change[0] == 'status'), None)
    if status_change and status_change[1] == "Approved" and status_change[2] == "Amendment":
        # Create a new Nirmaan Versions document
        nv = frappe.new_doc("Nirmaan Versions")
        nv.ref_doctype = doc.ref_doctype
        nv.docname = doc.docname
        # The Version's changes, plus the whole state from before the amendment (walk W2): a revert restores
        # that, so a change made while the amendment waits is undone too.
        work_order = frappe.get_doc("Service Requests", doc.docname)
        nv.data = frappe.as_json({**data, PRE_AMENDMENT_KEY: pre_amendment_state(data, work_order)})
        nv.previous_state = status_change[1]
        nv.new_state = status_change[2]
        nv.insert(ignore_permissions=True)
    else:
        pass


def is_amendment_snapshot(doc) -> bool:
    """The record `generate_sr_amend_version` leaves when a Work Order moves from Approved to Amendment."""
    return (doc.get("ref_doctype") == "Service Requests" and doc.get("previous_state") == "Approved"
            and doc.get("new_state") == "Amendment")


def keep_amendment_snapshot(doc, method=None):
    """A Work Order's amendment snapshot is its audit record (#1540, story 25): no REST, Desk or code save
    changes it after it is made, and nothing deletes it. Bound to validate and on_trash. The one change
    made to it, its outcome, is the server's `services/work_order_amendment.mark_snapshots` (`set_value`,
    which runs no hook)."""
    before = doc if method == "on_trash" else doc.get_doc_before_save()
    if before and is_amendment_snapshot(before):
        frappe.throw(SNAPSHOT_KEPT_REFUSAL, frappe.ValidationError)


def has_permission(doc, ptype=None, user=None, debug=False):
    """Deny a Work Order's snapshot to a user who may not read that Work Order (review round 4, X4): it
    holds the items and rates from before the amendment. Other doctypes' snapshots: the role rows decide."""
    if doc.get("ref_doctype") != "Service Requests" or not doc.get("docname"):
        return None
    user = user or frappe.session.user
    if not frappe.db.exists("Service Requests", doc.docname):
        # Its Work Order deleted, no read of it decides: the snapshot is the Admin's (review round 5, AA4).
        return None if has_role_profile(user, (ADMIN_PROFILE,)) else False
    return None if frappe.has_permission("Service Requests", "read", doc=doc.docname, user=user) else False


def get_permission_query_conditions(user=None, doctype=None):
    """A list holds a Work Order's snapshots only where the user may read that Work Order."""
    user = user or frappe.session.user
    if user == "Administrator":
        return ""
    readable = readable_work_orders_sql(user)
    other = "COALESCE(\"tabNirmaan Versions\".ref_doctype, '') != 'Service Requests'"
    if not readable:
        return other
    return f'({other} OR "tabNirmaan Versions".docname IN ({readable}))'
