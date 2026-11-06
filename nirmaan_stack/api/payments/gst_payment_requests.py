# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Raise, approve and reject a GST Payment Request (`services/gst_payment_requests`).

URLs:
  /api/method/nirmaan_stack.api.payments.gst_payment_requests.get_gst_payment_requests
  /api/method/nirmaan_stack.api.payments.gst_payment_requests.request_gst_payment
  /api/method/nirmaan_stack.api.payments.gst_payment_requests.approve_gst_payment_request
  /api/method/nirmaan_stack.api.payments.gst_payment_requests.reject_gst_payment_request
  /api/method/nirmaan_stack.api.payments.gst_payment_requests.delete_gst_payment_request

A request is Online only: it carries no cheque. The approval creates the payment through Request
Payment's own insert (`project_payments.insert_requested_payment`), routed by the REQUESTER's level and owned
by them, so it shows in their "Payment Raised By Me".

TWO AT ONCE. Frappe runs PostgreSQL at REPEATABLE READ: a request that waited on the Work Order's row lock
still reads GST left from a snapshot taken before the first one committed. So the request and the approval
also touch the Work Order row inside the lock (`_lock_work_order`), and Postgres refuses the second writer
outright (a serialization failure), which is told as "try again" rather than let through on stale figures.
"""

import frappe
from frappe import _
from frappe.utils import flt, now_datetime

from nirmaan_stack.api.payments.project_payments import insert_requested_payment
from nirmaan_stack.api.projects._tendering_guard import validate_won
from nirmaan_stack.integrations.Notifications.gst_payment_request_notify import (
    notify_request_decided,
    notify_request_raised,
)
from nirmaan_stack.services import gst_payment_requests as gpr
from nirmaan_stack.services.order_payments import assert_within_work_order_limit
from nirmaan_stack.services.outflow_import.concurrency import is_concurrent_writer_refusal
from nirmaan_stack.services.work_order_lifecycle import WorkOrderChangeRefused, payment_request_problem

WORK_ORDER = "Service Requests"

AT_THE_SAME_MOMENT = "Someone else changed this Work Order's GST at the same moment. Refresh and try again."


def _lock_work_order(name: str):
    """The Work Order, locked and touched, so a second request or approval that waited on it is refused."""
    try:
        sr = frappe.get_doc(WORK_ORDER, name, for_update=True)
        # Raw and value-free on purpose: no field changes, so no hook has anything to recompute. Its only job
        # is to make this row "updated by us" before we commit, for the REPEATABLE READ refusal above.
        frappe.db.sql('UPDATE "tabService Requests" SET modified = modified WHERE name = %s', (name,))
    except Exception as e:
        if is_concurrent_writer_refusal(e):
            frappe.throw(_(AT_THE_SAME_MOMENT), gpr.GstRequestRefused, title=_("Try again"))
        raise
    return sr


def _refuse_unless_payable(sr) -> None:
    """A GST request, and its approval, need a Work Order a payment could be requested on now."""
    validate_won(sr.project, "GST Payment Request")
    problem = payment_request_problem(sr.name, sr.status)
    if problem:
        frappe.throw(_(problem), WorkOrderChangeRefused, title=_("Not allowed"))


@frappe.whitelist(methods=["GET"])
def get_gst_payment_requests(work_order: str | None = None, status: str | None = None, limit: int = 200) -> list:
    """GST requests, newest first, for the Work Order card (`work_order`) or the GST Requests tab (`status`).

    Each row carries what its screen shows beside it: the vendor's name, GSTIN and GST Hold, the project's
    name and the raiser's name. Read with the caller's permissions.
    """
    filters = {}
    if work_order:
        filters["work_order"] = work_order
    if status:
        filters["status"] = status
    rows = frappe.get_list(
        gpr.DOCTYPE, filters=filters, order_by="creation desc", limit_page_length=min(int(limit or 200), 500),
        fields=["name", "work_order", "project", "vendor", "amount", "status", "owner", "creation",
                "reviewed_by", "reviewed_on", "review_comment", "project_payment"],
    )

    def lookup(doctype, names, fields):
        names = sorted({n for n in names if n})
        if not names:
            return {}
        return {r.name: r for r in frappe.get_all(doctype, filters={"name": ["in", names]}, fields=["name", *fields])}

    vendors = lookup("Vendors", (r.vendor for r in rows), ["vendor_name", "vendor_gst", "gst_hold"])
    projects = lookup("Projects", (r.project for r in rows), ["project_name"])
    people = lookup("Nirmaan Users", [r.owner for r in rows] + [r.reviewed_by for r in rows], ["full_name"])

    out = []
    for r in rows:
        vendor = vendors.get(r.vendor) or {}
        out.append({
            **r,
            "creation": str(r.creation),
            "reviewed_on": str(r.reviewed_on) if r.reviewed_on else None,
            "raised_by_name": (people.get(r.owner) or {}).get("full_name") or r.owner,
            "reviewed_by_name": (people.get(r.reviewed_by) or {}).get("full_name") or r.reviewed_by,
            "vendor_name": vendor.get("vendor_name") or r.vendor,
            "vendor_gst": (vendor.get("vendor_gst") or "").strip(),
            "vendor_gst_hold": int(vendor.get("gst_hold") or 0),
            "project_name": (projects.get(r.project) or {}).get("project_name") or r.project,
        })
    return out


@frappe.whitelist(methods=["POST"])
def request_gst_payment(work_order: str, amount) -> dict:
    """Ask the Accountant for a GST payment of `amount` on `work_order`. `{"name": <GPR-...>}`.

    Held to the Work Order's GST left, which the Work Order's other Pending requests already reduce, so
    the same GST cannot be asked for twice. The Work Order row is locked and touched first: of two people
    asking for the last of the GST at once, the second is refused and asked to try again.
    """
    amount = flt(amount, 2)
    if amount <= 0:
        frappe.throw(_("A GST request must be more than zero."))
    frappe.has_permission(WORK_ORDER, "read", doc=work_order, throw=True)
    frappe.has_permission("Project Payments", "create", throw=True)

    sr = _lock_work_order(work_order)
    _refuse_unless_payable(sr)
    assert_within_work_order_limit(sr, amount, True)

    req = frappe.new_doc(gpr.DOCTYPE)
    req.update({
        "work_order": sr.name, "project": sr.project, "vendor": sr.vendor,
        "amount": amount, "status": gpr.PENDING,
    })
    req.flags[gpr.DECIDING_FLAG] = True
    req.insert(ignore_permissions=True)
    frappe.db.commit()

    notify_request_raised(req)
    return {"name": req.name}


def _load_decidable(name: str):
    """The request, locked, refused unless the session user is a decider who can see its project."""
    if not gpr.can_decide(frappe.session.user):
        raise frappe.PermissionError(_("Only an Accountant, an Accountant Lead or an Admin decides a GST request."))
    try:
        req = frappe.get_doc(gpr.DOCTYPE, name, for_update=True)
    except Exception as e:
        if is_concurrent_writer_refusal(e):
            frappe.throw(_("Another Accountant decided this GST request at the same moment. Refresh to see it."),
                         gpr.GstRequestRefused, title=_("Already decided"))
        raise
    # The project scope the list and the bell already apply (User Permissions on the request's project).
    frappe.has_permission(gpr.DOCTYPE, "read", doc=req, throw=True)
    return req


def _load_pending(name: str):
    """The request, locked, refused unless the session user may decide it and it is still Pending."""
    req = _load_decidable(name)
    problem = gpr.decision_problem(req.status)
    if problem:
        frappe.throw(problem, gpr.GstRequestRefused, title=_("Already decided"))
    return req


@frappe.whitelist(methods=["POST"])
def approve_gst_payment_request(name: str) -> dict:
    """Approve a Pending request: create its GST payment for the amount asked, routed by amount as any payment is.

    The amount is the request's own and is not changed at approval (owner, 2026-11-04). The Work Order is
    checked again, since it may have changed since the request: still payable, still the request's vendor, and the GST still left (an
    invoice may have been rejected meanwhile), measured with this request left out.

    The request is saved Approved BEFORE the payment is inserted: the payment's `after_insert` commits
    its notifications, so a payment committed beside a request still Pending could be approved twice. The
    same `after_insert` links the request to the payment first (`gst_payment_requests.link_payment`), so the
    commit never leaves an Approved request without its payment. A refusal before it rolls both back.
    """
    req = _load_pending(name)
    approved = flt(req.amount, 2)

    sr = _lock_work_order(req.work_order)
    _refuse_unless_payable(sr)
    if (sr.vendor or None) != (req.vendor or None):
        frappe.throw(
            _("{0} was asked for {1}, but {2}'s vendor is now {3}. Reject it; a new request can be raised.").format(
                req.name, req.vendor, sr.name, sr.vendor), title=_("Not allowed"))
    assert_within_work_order_limit(sr, approved, True, action="pay", exclude_request=req.name)

    decider = frappe.session.user
    req.update({"status": gpr.APPROVED, "reviewed_by": decider, "reviewed_on": now_datetime()})
    req.flags[gpr.DECIDING_FLAG] = True
    req.save(ignore_permissions=True)

    pay, _cheque, status = insert_requested_payment(sr, approved, True, {}, gst_request=req)
    req.project_payment = pay.name  # written by `link_payment`; kept on the doc for the notification
    pay.add_comment("Comment", _("GST approved by {0} from {1}.").format(frappe.utils.get_fullname(decider), req.name))
    frappe.db.commit()

    notify_request_decided(req)
    return {"name": req.name, "project_payment": pay.name, "payment_status": status}


@frappe.whitelist(methods=["POST"])
def reject_gst_payment_request(name: str, comment: str) -> dict:
    """Reject a Pending request, with a reason. No payment is created, and its amount is free again."""
    if not (comment or "").strip():
        frappe.throw(_("A rejection needs a reason."), title=_("Comment required"))
    req = _load_pending(name)
    req.update({
        "status": gpr.REJECTED, "reviewed_by": frappe.session.user, "reviewed_on": now_datetime(),
        "review_comment": comment.strip(),
    })
    req.flags[gpr.DECIDING_FLAG] = True
    req.save(ignore_permissions=True)
    frappe.db.commit()

    notify_request_decided(req)
    return {"name": req.name, "status": req.status}


@frappe.whitelist(methods=["POST"])
def delete_gst_payment_request(name: str) -> dict:
    """Delete a Pending or Rejected request: Accountant, Accountant Lead or Admin only. An Approved or Paid one
    goes only with its payment (`gst_payment_requests.delete_problem`, run by the doctype's `on_trash`)."""
    if not gpr.can_decide(frappe.session.user):
        raise frappe.PermissionError(_("Only an Accountant, an Accountant Lead or an Admin deletes a GST request."))
    req = _load_decidable(name)
    frappe.delete_doc(gpr.DOCTYPE, req.name, ignore_permissions=True)
    frappe.db.commit()
    return {"name": req.name, "deleted": True}
