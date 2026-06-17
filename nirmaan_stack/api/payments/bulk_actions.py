"""
Bulk approve / reject Project Payments.

Two endpoints, same engine:
  * bulk_lead_approve_payments   — Admin promoting Requested → CEO Pending / Rejected
  * bulk_ceo_approve_payments    — CEO promoting CEO Pending → Approved / Rejected

Race-safe by design:
  * Locks each PO row (SELECT ... FOR UPDATE) before mutating its terms,
    serializing against single-row approve / other bulk runs / PO revision.
  * One po_doc.save() per PO group, regardless of how many payments touch it.
  * Per-payment status guard so stale rows are reported, not silently overwritten.
  * Suppresses the per-payment notification cascade via flags.bulk_approval and
    emits one summary notification per recipient at the end.
"""

import json
from collections import defaultdict
from dataclasses import dataclass
from typing import Callable, Optional

import frappe
from frappe import _
from frappe.utils import nowdate

from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER
from nirmaan_stack.integrations.Notifications.pr_notifications import (
    get_admin_users,
    get_allowed_accountants,
)

MAX_BATCH_SIZE = 100
LEAD_ALLOWED_ROLE_PROFILES = (
    "Nirmaan Admin Profile",
    "Nirmaan Accountant Profile",
    "Nirmaan Accountant Lead Profile",
)
REJECTED_STATUS = "Rejected"


# ---------------------------------------------------------------------------
# Public endpoints
# ---------------------------------------------------------------------------

@frappe.whitelist()
def bulk_lead_approve_payments(payment_ids, action: str, rejection_reason: Optional[str] = None):
    """Admin bulk action on payments currently in 'Requested'."""
    _authorize_lead()
    return _bulk_action(
        payment_ids=payment_ids,
        action=action,
        rejection_reason=rejection_reason,
        config=_LEAD_CONFIG,
    )


@frappe.whitelist()
def bulk_ceo_approve_payments(payment_ids, action: str, rejection_reason: Optional[str] = None):
    """CEO bulk action on payments currently in 'CEO Pending'."""
    _authorize_ceo()
    return _bulk_action(
        payment_ids=payment_ids,
        action=action,
        rejection_reason=rejection_reason,
        config=_CEO_CONFIG,
    )


# ---------------------------------------------------------------------------
# Config per mode
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class _ModeConfig:
    source_status: str
    approve_target_status: str
    approve_date_field: Optional[str]
    approve_event_id: str
    approve_action_url: str
    approve_notification_recipients: Callable[[list], dict]
    """
    Receives the list of succeeded-payment rows
    (name, project, document_name, owner) and returns
    {recipient_user_dict.name: (recipient_user_dict, count, project_id, sample_docname)}.
    """


def _ceo_recipients_for_approve(succeeded_rows: list[dict]) -> dict:
    """CEO approved → notify accountants per project (one summary per accountant
    per project) AND admins (one global summary covering the whole bulk)."""
    per_project = defaultdict(list)
    for r in succeeded_rows:
        per_project[r["project"]].append(r)

    bundles: dict = {}

    # ── Per-project accountants ─────────────────────────────────────────────
    for project_id, rows in per_project.items():
        try:
            project_doc = frappe.get_doc("Projects", project_id)
        except frappe.DoesNotExistError:
            continue
        accountants = get_allowed_accountants(project_doc) or []
        for user in accountants:
            key = (user.get("name"), project_id)
            bundles[key] = {
                "user": user,
                "count": len(rows),
                "project_id": project_id,
                "project_name": project_doc.project_name,
                "sample_docname": rows[0]["name"],
            }

    # ── Admins (global) ─────────────────────────────────────────────────────
    # Admins get ONE summary per bulk run regardless of how many projects are
    # involved. We skip the actor themselves so the CEO doesn't notify
    # themselves if they happen to also hold the Admin profile.
    total = len(succeeded_rows)
    unique_projects = len(per_project)
    sample = succeeded_rows[0] if succeeded_rows else None
    actor = frappe.session.user

    for admin in get_admin_users() or []:
        admin_name = admin.get("name")
        if not admin_name or admin_name == actor:
            continue
        key = (admin_name, "*")
        # Don't overwrite if this user already has a per-project accountant
        # bundle (unlikely but possible if an admin is also a project
        # accountant). The accountant bundle is more actionable.
        if key in bundles:
            continue
        bundles[key] = {
            "user": admin,
            "count": total,
            "project_id": sample["project"] if sample else None,
            # project_name=None signals "global summary" to the title/body
            # selector in _emit_approve_summary — admins get the cross-project
            # message instead of the per-project one.
            "project_name": None,
            "unique_projects": unique_projects,
            "sample_docname": sample["name"] if sample else None,
        }

    return bundles


def _ceo_user_dict():
    return frappe.db.get_value(
        "Nirmaan Users",
        {"name": CEO_AUTHORIZED_USER},
        ["fcm_token", "name", "full_name", "role_profile", "push_notification"],
        as_dict=True,
    )


def _lead_recipients_for_approve(succeeded_rows: list[dict]) -> dict:
    """Lead approved → notify CEO once with a single summary covering all projects."""
    ceo_user = _ceo_user_dict()
    if not ceo_user:
        return {}
    return {
        (ceo_user.get("name"), "*"): {
            "user": ceo_user,
            "count": len(succeeded_rows),
            "project_id": succeeded_rows[0]["project"] if succeeded_rows else None,
            "project_name": None,
            "sample_docname": succeeded_rows[0]["name"] if succeeded_rows else None,
        }
    }


_LEAD_CONFIG = _ModeConfig(
    source_status="Requested",
    approve_target_status="CEO Pending",
    approve_date_field="approval_date",
    # Must match the controller hook's event_id for the same transition
    # (controllers/project_payments.py — Requested → CEO Pending uses
    # "payment:approved"). "payment:new" is the after_insert event for
    # "a new payment request was created" and routes to a different listener.
    approve_event_id="payment:approved",
    approve_action_url="project-payments?tab=CEO%20Pending",
    approve_notification_recipients=_lead_recipients_for_approve,
)

_CEO_CONFIG = _ModeConfig(
    source_status="CEO Pending",
    approve_target_status="Approved",
    approve_date_field="ceo_approval_date",
    approve_event_id="payment:ceo_approved",
    approve_action_url="project-payments?tab=New%20Payments",
    approve_notification_recipients=_ceo_recipients_for_approve,
)


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------

def _authorize_ceo():
    if frappe.session.user != CEO_AUTHORIZED_USER:
        frappe.throw(
            _("Only the authorised CEO user can perform this action."),
            frappe.PermissionError,
        )


def _authorize_lead():
    user = frappe.session.user
    if user == "Administrator":
        return
    role_profile = frappe.db.get_value("Nirmaan Users", user, "role_profile")
    if role_profile in LEAD_ALLOWED_ROLE_PROFILES:
        return
    frappe.throw(
        _("You are not authorised to approve payments in bulk."),
        frappe.PermissionError,
    )


# ---------------------------------------------------------------------------
# Core engine
# ---------------------------------------------------------------------------

def _bulk_action(payment_ids, action: str, rejection_reason: str | None, config: _ModeConfig):
    if isinstance(payment_ids, str):
        try:
            payment_ids = json.loads(payment_ids)
        except json.JSONDecodeError:
            frappe.throw(_("payment_ids must be a JSON list of names."))

    if not isinstance(payment_ids, list) or not payment_ids:
        frappe.throw(_("payment_ids must be a non-empty list."))

    if len(payment_ids) > MAX_BATCH_SIZE:
        frappe.throw(_("Bulk action limited to {0} payments per call.").format(MAX_BATCH_SIZE))

    if action not in ("approve", "reject"):
        frappe.throw(_("action must be 'approve' or 'reject'."))

    if action == "reject" and not (rejection_reason or "").strip():
        frappe.throw(_("Rejection reason is required."))

    deduped_ids = list(dict.fromkeys(payment_ids))

    payment_rows = frappe.get_all(
        "Project Payments",
        filters={"name": ["in", deduped_ids]},
        fields=["name", "document_type", "document_name"],
    )
    found = {r["name"]: r for r in payment_rows}

    succeeded: list[str] = []
    failed: list[dict] = []

    for pid in deduped_ids:
        if pid not in found:
            failed.append({"name": pid, "reason": "Payment not found"})

    groups: dict[tuple, list[str]] = defaultdict(list)
    for pid in deduped_ids:
        if pid not in found:
            continue
        row = found[pid]
        groups[(row["document_type"], row["document_name"])].append(pid)

    target_status = REJECTED_STATUS if action == "reject" else config.approve_target_status

    # Deferred rejection-reason comments — applied AFTER the group commits,
    # so a comment failure cannot poison the approval (fix E2).
    pending_comments: list[str] = []

    for (doc_type, doc_name), pids in groups.items():
        _process_group(
            doc_type=doc_type,
            doc_name=doc_name,
            payment_ids=pids,
            action=action,
            target_status=target_status,
            approve_date_field=config.approve_date_field,
            source_status=config.source_status,
            succeeded=succeeded,
            failed=failed,
            pending_comments=pending_comments,
        )

    # Commit BEFORE emitting notifications / writing comments (fix E7) — push
    # notifications and Comment rows should reference state that already exists
    # on disk; if the engine had a fatal failure we would never reach this line.
    frappe.db.commit()

    # Best-effort: rejection-reason comments. A failure here does not unwind the
    # approvals — the comment is purely auditing.
    if action == "reject" and rejection_reason and pending_comments:
        _add_rejection_comments(pending_comments, rejection_reason)

    if action == "approve" and succeeded:
        try:
            _emit_approve_summary(succeeded, config)
        except Exception:
            frappe.log_error(
                title="Bulk Payment Notification Error",
                message=frappe.get_traceback(),
            )

    return {
        "status": 200,
        "message": _("Processed {0} payments. {1} succeeded, {2} failed.").format(
            len(deduped_ids), len(succeeded), len(failed)
        ),
        "data": {
            "succeeded": succeeded,
            "failed": failed,
            "total": len(deduped_ids),
        },
    }


# ---------------------------------------------------------------------------
# Per-group processing (one PO row lock + one PO save)
# ---------------------------------------------------------------------------

def _process_group(
    doc_type: str,
    doc_name: str,
    payment_ids: list[str],
    action: str,
    target_status: str,
    approve_date_field: Optional[str],
    source_status: str,
    succeeded: list[str],
    failed: list[dict],
    pending_comments: list[str],
):
    """Process all payments belonging to one parent doc atomically.

    A Postgres SAVEPOINT wraps the whole group so a late failure
    (e.g. ``po_doc.save()`` raising) rolls back every ``pay.save()`` already
    made in this group — preventing the silent drift where payments end up in
    the success list with their linked PO term still in the old state.
    """

    po_doc = None
    if doc_type == "Procurement Orders":
        try:
            frappe.db.sql(
                'SELECT name FROM "tabProcurement Orders" WHERE name = %s FOR UPDATE',
                doc_name,
            )
            po_doc = frappe.get_doc("Procurement Orders", doc_name)
        except frappe.DoesNotExistError:
            for pid in payment_ids:
                failed.append({"name": pid, "reason": f"Linked PO {doc_name} not found"})
            return
        except Exception as exc:
            frappe.log_error(
                title="Bulk Payment PO Lock Error",
                message=frappe.get_traceback(),
            )
            for pid in payment_ids:
                failed.append({"name": pid, "reason": f"Could not lock linked PO: {exc}"})
            return

    savepoint = f"bulk_grp_{frappe.generate_hash(length=12)}"
    frappe.db.savepoint(savepoint)

    local_succeeded: list[str] = []
    local_rejection_pids: list[str] = []
    po_dirty = False

    for pid in payment_ids:
        try:
            # Lock the payment row alongside the PO row (fix E4) so a single-row
            # writer racing on the same payment serialises behind us, instead
            # of either side hitting a TimestampMismatchError or producing a
            # last-write-wins divergence between Project Payment.status and
            # PO payment_terms[i].term_status.
            frappe.db.sql(
                'SELECT name FROM "tabProject Payments" WHERE name = %s FOR UPDATE',
                pid,
            )
            pay = frappe.get_doc("Project Payments", pid)
        except frappe.DoesNotExistError:
            failed.append({"name": pid, "reason": "Payment not found"})
            continue

        if pay.status != source_status:
            failed.append({
                "name": pid,
                "reason": f"Status is '{pay.status}', expected '{source_status}'",
            })
            continue

        if pay.project:
            project_status = frappe.db.get_value("Projects", pay.project, "status")
            if project_status == "CEO Hold":
                failed.append({"name": pid, "reason": "Project is on CEO Hold"})
                continue

        try:
            # In-memory mutations first (fix E2). PO term sync runs before
            # pay.save() so that any orphan-term log surfaces even if the
            # payment write later fails; ``po_dirty`` is only flipped on a
            # successful save below.
            pay.status = target_status
            if action == "approve" and approve_date_field:
                pay.set(approve_date_field, nowdate())

            sync_outcome = "noop"
            if po_doc is not None:
                sync_outcome = _sync_po_term_in_memory(po_doc, pid, target_status)
                if sync_outcome == "orphan":
                    frappe.log_error(
                        title=f"Bulk Payment Orphan Term ({pid})",
                        message=(
                            f"Payment {pid} status moved to '{target_status}' "
                            f"but no matching payment_terms row found on PO "
                            f"{doc_name}. PO term will stay out of sync."
                        ),
                    )

            pay.flags.bulk_approval = True
            pay.save(ignore_permissions=True)

            if sync_outcome == "updated":
                po_dirty = True

            local_succeeded.append(pid)
            if action == "reject":
                local_rejection_pids.append(pid)
        except Exception as exc:
            failed.append({"name": pid, "reason": str(exc) or "Unknown error"})
            frappe.log_error(
                title=f"Bulk Payment Save Error ({pid})",
                message=frappe.get_traceback(),
            )

    # One PO save covers all per-term mutations in this group.
    if po_doc is not None and po_dirty:
        try:
            po_doc.save(ignore_permissions=True)
        except Exception as exc:
            # Fix E1: group rollback. Every payment we already committed in this
            # group reverts to its old status; they all move from
            # local_succeeded -> failed with a clear reason so the caller sees
            # exactly what happened.
            frappe.db.rollback(save_point=savepoint)
            frappe.log_error(
                title=f"Bulk Payment Group Rollback ({doc_name})",
                message=frappe.get_traceback(),
            )
            for pid in local_succeeded:
                failed.append({
                    "name": pid,
                    "reason": f"Group rollback — PO sync failed: {exc}",
                })
            return

    # Group survived — release the savepoint and promote local results.
    frappe.db.release_savepoint(savepoint)
    succeeded.extend(local_succeeded)
    pending_comments.extend(local_rejection_pids)


def _sync_po_term_in_memory(po_doc, payment_name: str, new_status: str) -> str:
    """Mirrors ``_find_and_update_po_term`` but mutates in-memory; caller saves once.

    Returns one of:
      * ``"updated"`` — a term row was modified; caller should save the PO.
      * ``"noop"``    — matching term row already had this status.
      * ``"orphan"``  — no matching term row found (caller should log).
    """
    for term in po_doc.get("payment_terms") or []:
        if term.project_payment == payment_name:
            if term.term_status != new_status:
                term.term_status = new_status
                return "updated"
            return "noop"
    return "orphan"


def _add_rejection_comments(payment_ids: list[str], rejection_reason: str):
    """Best-effort: attach a Frappe Comment to each rejected payment.

    Runs AFTER the engine has committed the group (fix E2) so a comment
    failure cannot leave the caller with a phantom-failed payment whose
    status flip already landed.
    """
    for pid in payment_ids:
        try:
            pay = frappe.get_doc("Project Payments", pid)
            pay.add_comment("Comment", text=_("Rejected: {0}").format(rejection_reason))
        except Exception:
            frappe.log_error(
                title=f"Bulk Reject Comment Error ({pid})",
                message=frappe.get_traceback(),
            )


# ---------------------------------------------------------------------------
# Summary notifications
# ---------------------------------------------------------------------------

def _emit_approve_summary(succeeded_ids: list[str], config: _ModeConfig):
    """Single notification per recipient instead of N per-payment notifications."""
    rows = frappe.get_all(
        "Project Payments",
        filters={"name": ["in", succeeded_ids]},
        fields=["name", "project", "document_name", "owner"],
    )

    bundles = config.approve_notification_recipients(rows)

    # Fix E6: visibility for misconfigured permission setups — if the engine
    # approved payments but nobody is wired up to be notified, surface it in
    # the Error Log instead of failing silently.
    if rows and not bundles:
        frappe.log_error(
            title="Bulk Payment Notification — no recipients",
            message=(
                f"Approved {len(rows)} payment(s) "
                f"(target='{config.approve_target_status}') but found 0 "
                f"notification recipients. Check CEO Nirmaan Users row / "
                f"Nirmaan User Permissions for the affected projects."
            ),
        )

    for bundle in bundles.values():
        user = bundle["user"]
        count = bundle["count"]
        project_id = bundle["project_id"]
        project_name = bundle.get("project_name")
        sample_docname = bundle["sample_docname"]
        unique_projects = bundle.get("unique_projects")
        plural = "s" if count != 1 else ""

        if project_name:
            # Per-project recipient (accountant) — concrete project context.
            title = _("{0} payment{1} ready — {2}").format(count, plural, project_name)
            body = _("{0} payment{1} now in '{2}' for {3}.").format(
                count, plural, config.approve_target_status, project_name,
            )
        elif unique_projects is not None:
            # Admin global summary (CEO-approve fan-out, cross-project).
            proj_plural = "s" if unique_projects != 1 else ""
            title = _("{0} payment{1} approved by CEO").format(count, plural)
            body = _("CEO approved {0} payment{1} across {2} project{3}.").format(
                count, plural, unique_projects, proj_plural,
            )
        else:
            # Lead-approve fan-out to CEO — single recipient, global summary.
            title = _("{0} payment{1} awaiting your action").format(count, plural)
            body = _("{0} payment{1} now in '{2}'.").format(
                count, plural, config.approve_target_status,
            )

        _insert_summary_notification(
            user=user,
            title=title,
            body=body,
            project=project_id,
            docname=sample_docname,
            event_id=config.approve_event_id,
            action_url=config.approve_action_url,
        )


def _insert_summary_notification(
    user: dict,
    title: str,
    body: str,
    project: Optional[str],
    docname: Optional[str],
    event_id: str,
    action_url: str,
):
    # FCM mobile push intentionally NOT sent here — bulk approvals only use the
    # in-app Nirmaan Notifications row + realtime socket event. Recipients see
    # the notification in the bell icon and (if connected) get the live ping.
    # Single-row flows still send FCM via the controller hook for back-compat.
    notif = frappe.new_doc("Nirmaan Notifications")
    notif.update({
        "recipient": user.get("name"),
        "recipient_role": user.get("role_profile"),
        "sender": frappe.session.user if frappe.session.user != "Administrator" else None,
        "title": title,
        "description": body,
        "document": "Project Payments",
        "docname": docname,
        "project": project,
        "seen": "false",
        "type": "info",
        "event_id": event_id,
        "action_url": action_url,
    })
    notif.insert(ignore_permissions=True)
    # Commit before publishing the realtime event so the socket consumer can
    # look up the notification doc by id (see CLAUDE.md gotcha #4). Since the
    # engine's main commit has already fired (fix E7 moved _emit_approve_summary
    # after it), each notification lands in its own short transaction.
    frappe.db.commit()

    frappe.publish_realtime(
        event=event_id,
        message={
            "title": title,
            "description": body,
            "project": project,
            "sender": frappe.session.user,
            "docname": docname,
            "notificationId": notif.name,
        },
        user=user.get("name"),
    )
