# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Bell rows and pushes for a GST Payment Request (`services/gst_payment_requests`).

Raised: the project's Accountants and Accountant Leads hear of it. Decided: the requester hears the
outcome. Called by the endpoints AFTER their commit, so a refused decision never notifies. Each row
commits on its own, as the other payment notifications do.
"""

import frappe
from frappe import _

from .pr_notifications import PrNotification, get_allowed_accountants

RAISED_EVENT = "gst_request:raised"
DECIDED_EVENT = "gst_request:decided"


def notify_request_raised(req) -> None:
    """Tell the project's Accountants a GST request waits for them."""
    raiser = frappe.utils.get_fullname(req.owner)
    amount = frappe.format_value(req.amount, "Currency")
    for user in get_allowed_accountants(req):
        _send(
            user, req, RAISED_EVENT,
            title=_("GST Payment Awaiting Accountant Approval"),
            description=_("{0} asked for a GST payment of {1} on {2}.").format(raiser, amount, req.work_order),
            action_url="project-payments?tab=GST%20Requests",
        )


def notify_request_decided(req) -> None:
    """Tell the requester their GST request was approved or rejected."""
    user = frappe.db.get_value(
        "Nirmaan Users", req.owner, ["name", "full_name", "role_profile", "fcm_token", "push_notification"],
        as_dict=True,
    )
    if not user or user.name == frappe.session.user:
        return
    amount = frappe.format_value(req.amount, "Currency")
    if req.status == "Approved":
        description = _("Your GST request of {0} on {1} was approved: payment {2}.").format(
            amount, req.work_order, req.project_payment)
    else:
        description = _("Your GST request of {0} on {1} was rejected: {2}").format(
            amount, req.work_order, req.review_comment)
    _send(
        user, req, DECIDED_EVENT,
        title=_("GST Request {0}").format(_(req.status)),
        description=description,
        action_url=f"service-requests/{req.work_order}?tab=approved-sr",
    )


DESCRIPTION_MAX = 140  # Nirmaan Notifications.description is a Data field


def _fit(text: str, limit: int = DESCRIPTION_MAX) -> str:
    """Cut text to the bell field's limit; the full reason stays on the request itself."""
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _send(user, req, event: str, *, title: str, description: str, action_url: str) -> None:
    """Callers run this AFTER the decision commits, so a failure here must not reach the user as an error."""
    description = _fit(description)
    try:
        if user.get("push_notification") == "true":
            PrNotification(user, title, description, f"{frappe.utils.get_url()}/frontend/{action_url}")
        row = frappe.new_doc("Nirmaan Notifications")
        row.update({
            "recipient": user.get("name"), "recipient_role": user.get("role_profile"),
            "sender": frappe.session.user if frappe.session.user != "Administrator" else None,
            "title": title, "description": description,
            "document": "GST Payment Request", "docname": req.name, "project": req.project,
            "seen": "false", "type": "info", "event_id": event, "action_url": action_url,
        })
        row.insert(ignore_permissions=True)
        frappe.db.commit()
    except Exception:
        frappe.db.rollback()
        frappe.log_error(title=f"GST request notification failed: {req.name}")
        return
    frappe.publish_realtime(
        event=event,
        message={"title": title, "description": description, "project": req.project,
                 "sender": frappe.session.user, "docname": req.name, "notificationId": row.name},
        user=user.get("name"),
    )
