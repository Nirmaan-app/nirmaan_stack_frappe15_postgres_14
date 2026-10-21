from dataclasses import dataclass

import frappe
from ..Notifications.pr_notifications import (
    NOTIFIED_USER_FIELDS,
    PrNotification,
    get_admin_users,
    get_allowed_accountants,
    get_allowed_lead_users,
    get_allowed_procurement_users,
    get_users_who_see_project,
)
from frappe import _
from .procurement_requests import get_user_name
from nirmaan_stack.api.projects._tendering_guard import validate_won
from nirmaan_stack.api.service_requests.vendor_fy_limit import validate_vendor_gst_hold
from nirmaan_stack.services.role_profiles import SERVICE_PROCUREMENT_PROFILES, can_decide_work_order
from nirmaan_stack.services.work_order_amendment import REVERTED, vendor_before_amendment
from nirmaan_stack.services.work_order_gst import gst_is_on
from nirmaan_stack.services.work_order_lifecycle import (
    AMENDMENT,
    APPROVED,
    SETTLED_PAYMENT_STATUSES,
    AmendmentFacts,
    WorkOrderChangeRefused,
    change_problem,
    delete_problem,
    is_amendment_save,
    is_approval,
    is_decision,
)


def guard_lifecycle(doc, method=None):
    """Refuse a Work Order save the lifecycle rules forbid for this user (`services/work_order_lifecycle`).

    Bound to validate on its own, so the SPA, Desk and the REST API all meet it: only Admin and Project
    Lead may approve, reject, or accept or revert an amendment (#1529); a Finalized Work Order's scope is
    locked (#1539); an amendment is held to the amendment rules (#1540), read here from the database. It runs
    after the doctype's own `validate`, so `flags.gst_set_from_vendor` is set by then.
    """
    before = doc.get_doc_before_save()
    problem = change_problem(
        before,
        doc,
        may_decide=can_decide_work_order(frappe.session.user),
        gst_from_vendor=bool(doc.flags.gst_set_from_vendor),
        finalize_action=bool(doc.flags.finalize_action),
        amendment=amendment_facts(before, doc) if is_amendment_save(before, doc) else None,
    )
    if problem:
        frappe.throw(_(problem), WorkOrderChangeRefused, title=_("Not allowed"))


def amendment_facts(before, doc) -> AmendmentFacts:
    """The payments, invoices and vendor facts an amendment save of `doc` is checked against."""
    payments = frappe.get_all(
        "Project Payments",
        filters={"document_type": "Service Requests", "document_name": doc.name},
        fields=["name", "status"],
        order_by="creation asc",
    )
    invoices = frappe.db.count(
        "Vendor Invoices",
        {"document_type": "Service Requests", "document_name": doc.name, "status": ("!=", "Rejected")},
    ) + frappe.db.count("WO Generated Invoice", {"work_order": doc.name, "status": ("!=", "Voided")})
    starting = before.status == "Approved"
    return AmendmentFacts(
        open_payments=tuple(
            (p.name, p.status) for p in payments if p.status not in SETTLED_PAYMENT_STATUSES
        ),
        has_live_payment=any(p.status != "Rejected" for p in payments),
        invoices=invoices,
        vendor_before=before.vendor if starting else vendor_before_amendment(doc.name, before.vendor),
        vendor_on_gst_hold=bool(doc.vendor and frappe.db.get_value("Vendors", doc.vendor, "gst_hold")),
    )


def guard_delete(doc, method=None):
    """Refuse deleting a Finalized Work Order (#1539). First in `on_trash`, so nothing is cleared before it."""
    problem = delete_problem(doc)
    if problem:
        frappe.throw(_(problem), WorkOrderChangeRefused, title=_("Not allowed"))


def validate(doc, method):
    """Tendering operational guard (Slice 5 / B5) + vendor GST Hold on a NEW Work Order;
    the GST flag guard on an existing one.

    Defense-in-depth backstop: refuse to create a Service Request (Work Order)
    against a Tendering project stub, or for a vendor on GST Hold (ADR-0028).
    Those two guard only NEW docs so edits to existing/legacy SRs are never blocked.
    """
    if doc.is_new():
        validate_won(doc.project, "Service Request")
        validate_vendor_gst_hold(doc)
    else:
        validate_gst_flag_not_changed_by_hand(doc)
        validate_gst_not_switched_off_with_gst_payments(doc)


def validate_gst_flag_not_changed_by_hand(doc):
    """Refuse a GST flag change that the server did not make (ADR-0028 Amendment A, #1538).

    GST follows the vendor. Its only writers set `doc.flags.gst_set_from_vendor`: approval and an
    accepted vendor-changing amendment (`ServiceRequests.set_gst_from_vendor`, the doctype's own
    `validate`, which runs before this hook) and Match GST to vendor
    (`api/service_requests/match_gst_to_vendor`). Flags never travel over REST, so the page switch,
    Desk and the API all meet this, Admin included.
    """
    old_doc = doc.get_doc_before_save()
    if not old_doc or gst_is_on(old_doc.gst) == gst_is_on(doc.gst) or doc.flags.gst_set_from_vendor:
        return
    frappe.throw(
        _("GST Applicable on {0} follows its vendor and can't be changed by hand. "
          "Admin or an Accountant can use Match GST to vendor.").format(doc.name),
        title=_("GST follows the vendor"),
    )


def validate_gst_not_switched_off_with_gst_payments(doc):
    """Refuse turning the GST flag OFF while the Work Order has a GST payment (ADR-0030, decision 6).

    A GST payment counts at every status, Rejected included, until it is deleted. Turning GST ON is
    never refused. This runs in the lifecycle, after the doctype's own `validate`, so the two ways the
    flag can still move meet it: `ServiceRequests.set_gst_from_vendor` (approval, an accepted
    vendor-changing amendment) and Match GST to vendor. A raw `set_value` of `gst` would not --
    nothing writes `gst` that way.
    """
    old_doc = doc.get_doc_before_save()
    if not (old_doc and gst_is_on(old_doc.gst) and not gst_is_on(doc.gst)):
        return
    gst_payments = frappe.get_all(
        "Project Payments",
        filters={"document_type": "Service Requests", "document_name": doc.name, "is_gst_payment": 1},
        pluck="name",
        order_by="creation asc",
    )
    if gst_payments:
        frappe.throw(
            _("GST cannot be switched off on {0} while it has GST payments: {1}.").format(
                doc.name, ", ".join(gst_payments)
            ),
            title=_("GST payments exist"),
        )


def on_trash(doc, method):
    frappe.db.delete("Nirmaan Comments", {
        "reference_name" : ("=", doc.name)
    })
    print(f"flagged for delete sr document: {doc} {doc.modified_by} {doc.owner}")
    notifications = frappe.db.get_all("Nirmaan Notifications", 
                                      filters={"docname": doc.name},
                                      fields={"name", "recipient"}
                                      )

    if notifications:
        for notification in notifications:
            print(f"running delete notification event for user: {notification['recipient']} with {notification['name']}")
            message = {
            "title": _("SR Deleted"),
            "description": _(f"SR: {doc.name} has been deleted."),
            "docname": doc.name,
            "sender": frappe.session.user,
            "notificationId" : notification["name"]
            }
            frappe.publish_realtime(
                event="sr:delete",
                message=message,
                user=notification["recipient"]
            )
    frappe.db.delete("Nirmaan Notifications", {
        "docname": ("=", doc.name)
    })

# --- Notifications (#1533) ---------------------------------------------------------------------------

VENDOR_SELECTED = "Vendor Selected"

VENDOR_SELECTED_EVENT = "sr:vendorSelected"
AMENDED_EVENT = "sr:amended"
APPROVED_EVENT = "sr:approved"
REJECTED_EVENT = "sr:rejected"
AMENDMENT_ACCEPTED_EVENT = "sr:amendmentAccepted"
AMENDMENT_REVERTED_EVENT = "sr:amendmentReverted"
FINALIZED_EVENT = "sr:finalized"

ACCOUNTANT_PROFILES = ("Nirmaan Accountant Profile", "Nirmaan Accountant Lead Profile")
_NOTICE_SAVEPOINT = "work_order_notice"


@dataclass(frozen=True)
class Notice:
    """One Work Order notice: the bell row, the realtime event of the same name, and the push."""

    event: str
    title: str
    description: str
    push_title: str
    push_text: str   # the push body after "Hi <name>, "
    tab: str         # the Work Order page tab the bell links to


def on_update(doc, method=None):
    """Tell people about the status move this save made: once, and only after the save commits (#1533).

    A save that keeps the status (notes, the GST flag, an invoice number) tells nobody. The bell rows ride
    the save's own transaction, so a save that rolls back leaves none, and the realtime events and pushes
    wait for its commit. The rows are the system's, inserted past the saver's permissions: a PMO Executive
    amends a Work Order but may not create Nirmaan Notifications.
    """
    before = doc.get_doc_before_save()
    event = status_event(before.status if before else None, doc.status, doc.flags.amendment_outcome)
    if event:
        notify(doc, event)


def notify_finalized(doc):
    """Tell the approval audience a Work Order was finalized, so the Work Order lists show it (story 77).
    Called by `api/sr_finalize.finalize_sr` before its commit."""
    notify(doc, FINALIZED_EVENT)


def status_event(before_status, after_status, amendment_outcome=None) -> str | None:
    """The notice a save moving the status from `before_status` (None for a new Work Order) to
    `after_status` sends, or None. `amendment_outcome`: `flags.amendment_outcome`, set on the save that
    decides an amendment (#1540)."""
    if before_status == after_status:
        return None
    if after_status == VENDOR_SELECTED:
        return VENDOR_SELECTED_EVENT
    if after_status == AMENDMENT:
        return AMENDED_EVENT
    if is_approval(before_status, after_status):
        return APPROVED_EVENT
    if before_status == AMENDMENT and after_status == APPROVED:
        return AMENDMENT_REVERTED_EVENT if amendment_outcome == REVERTED else AMENDMENT_ACCEPTED_EVENT
    if is_decision(before_status, after_status):
        return REJECTED_EVENT
    return None


def notify(doc, event):
    """Write `event`'s bell row for each of its recipients, and send its realtime event and push after the
    commit. A failure is logged and undone, never raised: the save it reports stands."""
    recipients = _recipients(doc, event)
    if not recipients:
        return
    notice = _notice(doc, event)
    frappe.db.savepoint(_NOTICE_SAVEPOINT)
    try:
        rows = [(user, _bell_row(doc, notice, user)) for user in recipients]
    except Exception:
        frappe.db.rollback(save_point=_NOTICE_SAVEPOINT)
        frappe.log_error(frappe.get_traceback(), f"Work Order {event} notification failed")
        return
    message = {"title": notice.title, "description": notice.description, "project": doc.project,
               "work_package": "Services", "sender": frappe.session.user, "docname": doc.name}
    for user, row in rows:
        frappe.publish_realtime(event=notice.event, message={**message, "notificationId": row},
                                user=user["name"], after_commit=True)
    frappe.db.after_commit.add(lambda: _push(notice, recipients))


def _recipients(doc, event) -> list:
    """Who `event` tells, each once."""
    if event in (VENDOR_SELECTED_EVENT, AMENDED_EVENT):
        users = get_allowed_lead_users(doc) + get_admin_users()
    elif event in (APPROVED_EVENT, FINALIZED_EVENT):
        users = (get_allowed_procurement_users(doc)
                 + get_users_who_see_project(doc.project, SERVICE_PROCUREMENT_PROFILES)
                 + get_admin_users()
                 + get_allowed_accountants(doc))
    else:
        users = _creator(doc)
    unique = {}
    for user in users:
        unique.setdefault(user["name"], user)
    return list(unique.values())


def _creator(doc) -> list:
    """The Work Order's creator, unless they made this move themselves or have no Nirmaan Users row."""
    if doc.owner == frappe.session.user:
        return []
    return frappe.get_all("Nirmaan Users", filters={"name": doc.owner}, fields=NOTIFIED_USER_FIELDS)


def _notice(doc, event) -> Notice:
    name, actor = doc.name, get_user_name(frappe.session.user)
    texts = {
        VENDOR_SELECTED_EVENT: (
            _("SR Status Updated"), _("Vendors have been selected for the SR: {0}!").format(name),
            _("Vendors Selected for SR: {0}").format(name),
            _("Vendors have been selected for the {0} Service Request. Please review the selection and "
              "proceed with approval or rejection.").format(name),
            "approve-service-order"),
        AMENDED_EVENT: (
            _("SR Status Updated!"), _("SO: {0} has been amended!").format(name),
            _("SO: {0} has been Amended").format(name),
            _("SO: {0} for the {1} project has been amended by {2} and is awaiting your review.").format(
                name, doc.project, actor),
            "approve-amended-so"),
        APPROVED_EVENT: (
            _("SR Approved"), _("Vendors have been approved for the SR: {0}!").format(name),
            _("Vendors Approved for SR: {0}").format(name),
            _("Vendors have been approved for the {0} Service Request. Click here to take action.").format(name),
            "approved-sr"),
        REJECTED_EVENT: (
            _("Work Order Rejected"), _("{0} was rejected by {1}.").format(name, actor),
            _("Work Order {0} Rejected").format(name),
            _("your Work Order {0} was rejected by {1}.").format(name, actor),
            "choose-vendor"),
        AMENDMENT_ACCEPTED_EVENT: (
            _("Amendment Accepted"), _("The amendment to {0} was accepted by {1}.").format(name, actor),
            _("Amendment to {0} Accepted").format(name),
            _("the amendment to your Work Order {0} was accepted by {1}.").format(name, actor),
            "approved-sr"),
        AMENDMENT_REVERTED_EVENT: (
            _("Amendment Reverted"),
            _("The amendment to {0} was reverted by {1}; it is back as it was before.").format(name, actor),
            _("Amendment to {0} Reverted").format(name),
            _("the amendment to your Work Order {0} was reverted by {1}.").format(name, actor),
            "approved-sr"),
        FINALIZED_EVENT: (
            _("Work Order Finalized"), _("{0} was finalized by {1}.").format(name, actor),
            _("Work Order {0} Finalized").format(name),
            _("Work Order {0} was finalized by {1}.").format(name, actor),
            "finalized-sr"),
    }
    return Notice(event, *texts[event])


def _link(doc, notice, user) -> str:
    """Where the bell sends `user`: Accountants to the Work Order's payments, everyone else to its page."""
    if notice.event in (APPROVED_EVENT, FINALIZED_EVENT) and user["role_profile"] in ACCOUNTANT_PROFILES:
        return f"project-payments/{doc.name}"
    return f"service-requests/{doc.name}?tab={notice.tab}"


def _bell_row(doc, notice, user) -> str:
    row = frappe.get_doc({
        "doctype": "Nirmaan Notifications",
        "recipient": user["name"],
        "recipient_role": user["role_profile"],
        "sender": frappe.session.user if frappe.session.user != "Administrator" else None,
        "title": notice.title,
        "description": notice.description,
        "document": "Service Requests",
        "docname": doc.name,
        "project": doc.project,
        "work_package": "Services",
        "seen": "false",
        "type": "info",
        "event_id": notice.event,
        "action_url": _link(doc, notice, user),
    })
    row.insert(ignore_permissions=True)
    return row.name


def _push(notice, recipients):
    """Send the push to each recipient who takes them. Runs after the commit; a failure is logged."""
    for user in recipients:
        if user.get("push_notification") != "true":
            continue
        try:
            PrNotification(user, notice.push_title, _("Hi {0}, {1}").format(user["full_name"], notice.push_text),
                           f"{frappe.utils.get_url()}/frontend/service-requests?tab={notice.tab}")
        except Exception:
            frappe.log_error(frappe.get_traceback(), f"Work Order {notice.event} push failed")
