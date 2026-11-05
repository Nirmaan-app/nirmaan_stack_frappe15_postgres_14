# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""GST Payment Request: an Accountant approves a Work Order's GST before any payment exists.

A GST payment (ADR-0030, `Project Payments.is_gst_payment`) is no longer created straight from Request
Payment. The raiser makes a `GST Payment Request` (Pending); an Accountant, an Accountant Lead or an Admin
(`PAYMENT_SETTLE_PROFILES`) approves it, which creates the payment through the ordinary request path, routed
by amount as any payment is, or rejects it, which creates nothing. Project Payments' statuses are untouched.

    Pending  -> Approved   the decider, through `api/payments/gst_payment_requests.approve_gst_payment_request`
    Pending  -> Rejected   the decider, with a reason, through `reject_gst_payment_request`
    Approved <-> Paid      its payment, by itself: Paid while the payment is Paid (reconciled), Approved
                           otherwise (`sync_with_payment`, the Project Payments `on_update`); a payment L1 or
                           the CEO rejects leaves it Approved
    anything else          refused

DELETING. A decider deletes a Pending or Rejected request (`delete_gst_payment_request`); an Approved or
Paid one goes only with its payment: deleting the payment deletes it (`delete_with_payment`, the Project
Payments `on_trash`), and the GST it held is free again. The doctype's `on_trash` refuses every other delete.

THE LIMIT. A Pending request holds its amount against the Work Order's GST left and total left
(`services/work_order_payment_limit`), so the same GST cannot be asked for twice; an Approved one holds
it through the payment it created (counted there, never here); a Rejected one holds nothing, so its amount
may be asked for again.

EVERY GST REQUEST IS APPROVED IN THE GST REQUESTS TAB (owner, 2026-11-04): an Accountant's or an Admin's own
included; nobody's GST payment is approved by their raising it. A GST payment is born only from an approved
request (`gst_payment_birth_problem`, run by the Project Payments `validate`), with three exceptions that are
not a person asking for money: a split of one that already was (`split_child`), the Accountant's Paid entry
(a payment already made, recorded at Paid by a decider), and the `Administrator` system account (as for the
invoice check). Those get their request recorded beside them, already decided (`record_decider_request`, the
Project Payments `after_insert`), so every GST payment has its request and follows the same Paid and delete rules.

Every write to a request carries `DECIDING_FLAG`, which only server code sets; the `validate` controller
refuses any other insert or change (Desk and REST included: System Manager sits on six role profiles, so
the doctype's own permissions are not the boundary).
"""

import frappe
from frappe import _
from frappe.utils import flt

from nirmaan_stack.services.role_profiles import PAYMENT_SETTLE_PROFILES, has_role_profile

DOCTYPE = "GST Payment Request"

PENDING = "Pending"
APPROVED = "Approved"
REJECTED = "Rejected"
PAID = "Paid"
STATUSES = (PENDING, APPROVED, REJECTED, PAID)
#: A decider may delete a request only at these; the others go with their payment.
DELETABLE = (PENDING, REJECTED)

#: Set by the request endpoints on every write to a request.
DECIDING_FLAG = "gst_request_deciding"
#: Set by the approval on the payment it inserts: the request's name.
FROM_GST_REQUEST = "from_gst_request"
#: `frappe.flags` key naming the payment whose delete is taking its request along.
PAYMENT_DELETE_FLAG = "deleting_gst_payment"
#: The payment status that makes its request Paid: reconciled, as Paid means everywhere.
PAYMENT_PAID = "Paid"

#: The fields only the endpoints write.
_GUARDED_FIELDS = (
    "work_order", "project", "vendor", "amount", "status",
    "reviewed_by", "reviewed_on", "review_comment", "project_payment",
)


class GstRequestRefused(frappe.ValidationError):
    """A request write outside the endpoints, or a decision the request cannot take."""


def can_decide(user: str) -> bool:
    """May `user` approve or reject a GST Payment Request?"""
    return has_role_profile(user, PAYMENT_SETTLE_PROFILES)


def raises_gst_directly(user: str) -> bool:
    """Only the `Administrator` system account raises a GST payment without a request; every person asks."""
    return user == "Administrator"


def pending_gst_amount(work_order: str, exclude_request: str | None = None) -> float:
    """The GST a Work Order's Pending requests hold, leaving out `exclude_request` (the one being approved)."""
    if not work_order:
        return 0.0
    filters = {"work_order": work_order, "status": PENDING}
    if exclude_request:
        filters["name"] = ["!=", exclude_request]
    rows = frappe.get_all(DOCTYPE, filters=filters, fields=["sum(amount) as total"])
    return round(flt(rows[0].total if rows else 0), 2)


def pending_requests(work_order: str) -> list[str]:
    """Names of a Work Order's Pending requests, oldest first."""
    return frappe.get_all(
        DOCTYPE, filters={"work_order": work_order, "status": PENDING}, pluck="name", order_by="creation asc"
    )


def decision_problem(status: str | None) -> str | None:
    """Why a request at `status` cannot be decided, or None while it is Pending."""
    if status == PENDING:
        return None
    return _("This GST request is already {0}.").format((status or "decided").lower())


def validate(doc) -> None:
    """The request's `validate`: only the endpoints write it, and a rejection carries its reason."""
    if not doc.flags.get(DECIDING_FLAG):
        if doc.is_new():
            raise GstRequestRefused(_("A GST request is made from the Work Order's Request Payment, not directly."))
        before = doc.get_doc_before_save()
        changed = [f for f in _GUARDED_FIELDS if before and (before.get(f) or None) != (doc.get(f) or None)]
        if changed:
            raise GstRequestRefused(
                _("A GST request is approved or rejected from the GST Requests tab, not edited. Changed: {0}.").format(
                    ", ".join(changed)))
    if doc.status not in STATUSES:
        raise GstRequestRefused(_("Unknown GST request status: {0}.").format(doc.status))
    if doc.status == REJECTED and not (doc.review_comment or "").strip():
        raise GstRequestRefused(_("A rejected GST request needs a reason."))


def delete_problem(doc, user: str) -> str | None:
    """Why `user` may not delete request `doc`, or None. Its payment's delete always may."""
    if doc.project_payment and frappe.flags.get(PAYMENT_DELETE_FLAG) == doc.project_payment:
        return None
    if not can_decide(user):
        return _("Only an Accountant, an Accountant Lead or an Admin deletes a GST request.")
    if doc.status not in DELETABLE:
        return _("An {0} GST request goes only with its payment: delete {1} instead.").format(
            doc.status.lower(), doc.project_payment or _("the payment"))
    return None


def status_for_payment(payment_status: str | None) -> str:
    """An approved request's status for its payment's: Paid while the payment is Paid, Approved otherwise."""
    return PAID if (payment_status or "").strip() == PAYMENT_PAID else APPROVED


def sync_with_payment(payment) -> None:
    """Move the request `payment` was made from to the status its payment's now gives (Approved <-> Paid)."""
    if not flt(payment.get("is_gst_payment")):
        return
    name = frappe.db.get_value(DOCTYPE, {"project_payment": payment.name}, "name")
    if not name:
        return
    req = frappe.get_doc(DOCTYPE, name)
    target = status_for_payment(payment.status)
    if req.status not in (APPROVED, PAID) or req.status == target:
        return
    req.status = target
    req.flags[DECIDING_FLAG] = True
    req.save(ignore_permissions=True)


def link_payment(payment) -> None:
    """The payment an approved request made (`FROM_GST_REQUEST` names it): link the request to it and give it
    the requester as owner, before the payment's own `after_insert` commits its notifications, so the request,
    its link and the payment's owner land in the same commit. Raw writes of two stamps nothing derives from."""
    request = payment.flags.get(FROM_GST_REQUEST)
    if not request:
        return
    owner = frappe.db.get_value(DOCTYPE, request, "owner")
    frappe.db.set_value(DOCTYPE, request, "project_payment", payment.name, update_modified=False)
    if owner:
        frappe.db.set_value("Project Payments", payment.name, "owner", owner, update_modified=False)
        payment.owner = owner


def record_decider_request(payment) -> None:
    """Record the request beside a GST payment born without one (a Paid entry, the `Administrator` account):
    already decided, by whoever recorded it.

    Skips a payment that has one coming (`FROM_GST_REQUEST`, the approval links it) or that is the leftover of
    a split (`split_child`: its original keeps the request).
    """
    if not flt(payment.get("is_gst_payment")) or payment.document_type != "Service Requests":
        return
    if payment.flags.get(FROM_GST_REQUEST) or payment.flags.get("split_child"):
        return
    if frappe.db.exists(DOCTYPE, {"project_payment": payment.name}):
        return
    req = frappe.new_doc(DOCTYPE)
    req.update({
        "work_order": payment.document_name, "project": payment.project, "vendor": payment.vendor,
        "amount": payment.amount, "status": status_for_payment(payment.status),
        "reviewed_by": frappe.session.user, "reviewed_on": frappe.utils.now_datetime(),
        "project_payment": payment.name,
    })
    req.flags[DECIDING_FLAG] = True
    req.insert(ignore_permissions=True)


def delete_with_payment(payment) -> None:
    """Delete the request `payment` was made from, as `payment` is deleted: neither is left without the other.
    Before Frappe's link check, which the request's Link would otherwise fail; a refused delete rolls it back."""
    for name in frappe.get_all(DOCTYPE, filters={"project_payment": payment.name}, pluck="name"):
        frappe.flags[PAYMENT_DELETE_FLAG] = payment.name
        try:
            frappe.delete_doc(DOCTYPE, name, ignore_permissions=True, force=True)
        finally:
            frappe.flags.pop(PAYMENT_DELETE_FLAG, None)


def gst_payment_birth_problem(doc, user: str) -> str | None:
    """Why a new Project Payment may not be born a GST payment, or None.

    A GST payment comes from an approved request (`FROM_GST_REQUEST`), from a split of a payment that
    already was one (`split_child`: the CEO's part-approval, Bulk Import's part settle), from a decider's Paid
    entry (a payment already made), or from the `Administrator` system account.
    """
    if not flt(doc.get("is_gst_payment")):
        return None
    if doc.flags.get(FROM_GST_REQUEST) or doc.flags.get("split_child") or raises_gst_directly(user):
        return None
    if (doc.status or "").strip() == PAYMENT_PAID and can_decide(user):
        return None
    return _("A GST payment is approved in GST Requests first: send it to the Accountant from Request Payment.")


def gst_raise_problem(doc, user: str) -> str | None:
    """Why a save may not raise a saved GST payment's amount, or None: the Accountant approved the old one.
    The system's own moves (`payment_steps.SYSTEM_STEP_FLAGS`) are not a person raising it."""
    from nirmaan_stack.services.payment_steps import is_system_move

    if doc.is_new() or not flt(doc.get("is_gst_payment")) or is_system_move(doc) or can_decide(user):
        return None
    before = doc.get_doc_before_save()
    if before and flt(doc.amount, 2) > flt(before.amount, 2):
        return _("Only an Accountant may raise a GST payment's amount: the Accountant approved {0}.").format(
            frappe.format_value(flt(before.amount), "Currency"))
    return None
