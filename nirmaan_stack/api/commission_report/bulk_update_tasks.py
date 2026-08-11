# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Bulk actions over selected Commission Report task rows.

Three actions, each mirroring an action that already exists PER ROW on the tracker
table -- the rules here are the authority, the client's copy in
`commissionBulk.ts` is UX only:

  * ``set_deadline``          -- set one date on every selected row.
                                Allowed at any status EXCEPT Not Applicable
                                (whose deadline is intentionally empty).
  * ``mark_not_applicable``   -- move rows to Not Applicable and WIPE the
                                deadline.
  * ``mark_pending``          -- move rows to Pending. The deadline is RESTORED
                                only when the row is coming FROM Not Applicable
                                (it lost its own when it was marked); from any
                                other status the existing deadline is left alone,
                                mirroring the per-row "Re-activate" vs admin
                                "Send back to Pending" split.

⚠️ THE STATUS ACTIONS CARRY NO FROM-STATUS RESTRICTION (owner ruling). A ticked
row is moved whatever state it is in -- Submitted and Client Accepted included --
so ONE bulk tick can take a client-signed report to Not Applicable. That is
deliberate: the dialog WARNS (naming every selected status that is neither Pending
nor Not Applicable) instead of refusing, exactly as the Design Tracker's bulk
status does. Do NOT reintroduce an eligibility gate here.

Only `task_status` and `deadline` are ever written -- attachments, wizard
responses and approval proof survive a send-back untouched.

  * ``approve`` / ``reject``  -- the APPROVAL QUEUE actions, from the Pending
                                Approval tab. These DO keep a from-status gate
                                (the queue is Pending Approval by definition).
                                ⚠️ APPROVE IS NOT ONE STATUS: it is resolved PER
                                ROW from that row's own `report_type` --
                                Vendor -> Client Accepted (TERMINAL; the uploaded
                                PDF is the signed artifact) and Field -> Submitted
                                (still awaiting the client signature), mirroring
                                ApprovalActionDialog. `reject` is uniform.

The two status actions are the only values the bulk STATUS field offers, and both
are ADMIN-ONLY (the Design Tracker's split); approve / reject are Admin-only too,
matching the per-row queue actions.

Why an endpoint rather than a client loop: the per-row write path is one REST
call per child row (no atomicity, no report of what landed on a partial
failure), and the modal's path replaces the WHOLE child array on the parent,
which silently clobbers a concurrent edit by another user. This applies each row
surgically inside ONE transaction and returns exactly what it did.

A row is never written silently past a rule -- an ineligible, foreign, missing or
externally-locked row comes back in ``skipped`` WITH a reason, so the caller can
show it. Only a genuinely bad REQUEST (unknown action, bad date, no access)
throws.
"""

import frappe
from frappe import _
from frappe.utils import add_days, getdate, now, nowdate

from nirmaan_stack.api.commission_report.editing_lock import _get_current_lock

CHILD_DOCTYPE = "Commission Report Task Child Table"
PARENT_DOCTYPE = "Project Commission Report"

ACTION_SET_DEADLINE = "set_deadline"
ACTION_MARK_NOT_APPLICABLE = "mark_not_applicable"
ACTION_MARK_PENDING = "mark_pending"
ACTION_APPROVE = "approve"
ACTION_REJECT = "reject"
VALID_ACTIONS = {
    ACTION_SET_DEADLINE,
    ACTION_MARK_NOT_APPLICABLE,
    ACTION_MARK_PENDING,
    ACTION_APPROVE,
    ACTION_REJECT,
}

# The two actions the bulk STATUS field offers. Both are Admin-only.
STATUS_ACTIONS = {ACTION_MARK_NOT_APPLICABLE, ACTION_MARK_PENDING}

# The approval-queue actions. UNLIKE the status actions these DO keep a from-status
# gate: the queue is Pending Approval by definition, and approving anything else is
# meaningless rather than merely surprising.
APPROVAL_ACTIONS = {ACTION_APPROVE, ACTION_REJECT}

NOT_APPLICABLE = "Not Applicable"
PENDING = "Pending"
PENDING_APPROVAL = "Pending Approval"
SUBMITTED = "Submitted"
CLIENT_ACCEPTED = "Client Accepted"
REJECTED = "Rejected"

VENDOR = "Vendor"

# The status a status action moves rows TO.
TARGET_STATUS = {
    ACTION_MARK_NOT_APPLICABLE: NOT_APPLICABLE,
    ACTION_MARK_PENDING: PENDING,
}

# Fallback when the master carries no deadline_offset -- mirrors
# ReportActionCell.recomputeDeadline.
DEFAULT_REACTIVATION_DAYS = 7

# ADMIN + PMO ONLY (owner ruling). Deliberately NARROWER than the page's
# `hasEditStructureAccess`, which also carries Design Lead: a Design Lead keeps the
# row checkboxes (they drive the selected-rows CSV export) but gets no bulk write.
BULK_EDIT_PROFILES = {
    "Nirmaan Admin Profile",
    "Nirmaan PMO Executive Profile",
}

# MIRRORS the Design Tracker's split: `bulk_update_task_status` refuses anyone but
# an Admin, while its dialog's assign/deadline sections stay open to the wider set.
# Marking Not Applicable IS a status change, so it takes the narrow gate.
BULK_STATUS_PROFILES = {"Nirmaan Admin Profile"}

# Approving / rejecting is ADMIN-ONLY, matching the per-row ✓/✗ in the approval
# queue (`isAdmin` in GlobalApprovalsTable) -- PMO sees that queue read-only.
BULK_APPROVE_PROFILES = {"Nirmaan Admin Profile"}

# Guards a runaway request; the table pages at 50 rows, so this is far above any
# real selection while still bounding one transaction.
MAX_ROWS_PER_CALL = 500


def _in_profiles(
    user: str, role_profile: str | None, roles: list[str] | None, allowed: set
) -> bool:
    """A profile name shows up as a `Nirmaan Users.role_profile` AND, on this site,
    as a Role -- check both, exactly as the pricing module's gate does."""
    if user == "Administrator":
        return True
    if role_profile and role_profile in allowed:
        return True
    return bool(allowed & set(roles or []))


def has_bulk_access(user: str, role_profile: str | None, roles: list[str] | None) -> bool:
    """May open Bulk Update / set a deadline. Pure, so it needs no user fixture."""
    return _in_profiles(user, role_profile, roles, BULK_EDIT_PROFILES)


def has_bulk_status_access(user: str, role_profile: str | None, roles: list[str] | None) -> bool:
    """May change status in bulk (mark Not Applicable). ADMIN ONLY."""
    return _in_profiles(user, role_profile, roles, BULK_STATUS_PROFILES)


def has_bulk_approve_access(user: str, role_profile: str | None, roles: list[str] | None) -> bool:
    """May approve / reject in bulk. ADMIN ONLY, as the per-row queue actions are."""
    return _in_profiles(user, role_profile, roles, BULK_APPROVE_PROFILES)


def _require_bulk_access(action: str) -> None:
    user = frappe.session.user
    role_profile = frappe.db.get_value("Nirmaan Users", user, "role_profile")
    roles = frappe.get_roles(user)

    if not has_bulk_access(user, role_profile, roles):
        frappe.throw(
            _("You are not authorized to bulk-edit commission report tasks."),
            frappe.PermissionError,
        )

    if action in STATUS_ACTIONS and not has_bulk_status_access(user, role_profile, roles):
        frappe.throw(
            _("Only an Admin can change report status in bulk."),
            frappe.PermissionError,
        )

    if action in APPROVAL_ACTIONS and not has_bulk_approve_access(user, role_profile, roles):
        frappe.throw(
            _("Only an Admin can approve or reject reports in bulk."),
            frappe.PermissionError,
        )


def is_vendor(report_type: str | None) -> bool:
    """Blank counts as Field -- the same normalisation the whole app uses."""
    return (report_type or "Field").strip() == VENDOR


def approval_target(report_type: str | None) -> str:
    """What APPROVING this row means.

    Vendor -> Client Accepted (the uploaded PDF IS the signed artifact, so the
    report is FINISHED). Field -> Submitted (still needs the client signature).
    Mirrors ApprovalActionDialog.doApprove exactly.
    """
    return CLIENT_ACCEPTED if is_vendor(report_type) else SUBMITTED


def _skip_reason(status: str, action: str, row: dict | None = None) -> str | None:
    """Why this row cannot take `action`, or None when it can."""
    status = (status or "").strip()

    if action in APPROVAL_ACTIONS:
        if status != PENDING_APPROVAL:
            return _("Not awaiting approval (this one is {0})").format(
                status or _("unknown")
            )
        # Approving a Vendor row writes Client Accepted -- a TERMINAL state whose
        # evidence is the uploaded file. Never write it with nothing behind it.
        if (
            action == ACTION_APPROVE
            and row is not None
            and is_vendor(row.get("report_type"))
            and not (row.get("approval_proof") or "").strip()
        ):
            return _("Vendor report has no uploaded file to approve")
        return None

    # A status action has NO from-status restriction (owner ruling) -- the ONLY
    # rows it declines are the ones already AT the target, where there is nothing
    # to write and counting them would inflate the result.
    target = TARGET_STATUS.get(action)
    if target:
        if status == target:
            return _("Already {0}").format(target)
        return None

    if status == NOT_APPLICABLE:
        return _("Not Applicable reports carry no deadline")
    return None


def _reactivation_deadlines(tracker: str, rows: list[dict]) -> dict:
    """Deadline to restore per row name when re-activating to Pending.

    Mirrors ReportActionCell.recomputeDeadline: the master's `deadline_offset`
    added to the tracker's `start_date` (today when it has none), else today + 7.
    The master is read ONCE for the whole batch.
    """
    start_date = frappe.db.get_value(PARENT_DOCTYPE, tracker, "start_date")
    base = getdate(start_date) if start_date else getdate(nowdate())
    fallback = add_days(getdate(nowdate()), DEFAULT_REACTIVATION_DAYS)

    pairs = {(r.get("commission_category"), r.get("task_name")) for r in rows}
    offsets = {}
    if pairs:
        for master in frappe.get_all(
            "Commission Report Tasks",
            filters={"task_name": ["in", sorted({p[1] for p in pairs if p[1]})]},
            fields=["task_name", "category_link", "deadline_offset"],
        ):
            offsets[(master.get("category_link"), master.get("task_name"))] = master.get(
                "deadline_offset"
            )

    resolved = {}
    for row in rows:
        offset = offsets.get((row.get("commission_category"), row.get("task_name")))
        resolved[row["name"]] = add_days(base, int(offset)) if offset is not None else fallback
    return resolved


def _locked_by_other(task_row: str) -> str | None:
    """Full name of ANOTHER user holding the edit-wizard lock, else None.

    A lock held by the caller does not block them -- it is their own wizard
    session. Reuses the lock module's own reader so the cache key has one
    definition.
    """
    lock = _get_current_lock(task_row)
    if not lock:
        return None
    holder = lock.get("user")
    if not holder or holder == frappe.session.user:
        return None
    return lock.get("user_name") or holder


@frappe.whitelist(methods=["POST"])
def bulk_update_tasks(tracker, task_rows, action, deadline=None):
    """Apply `action` to the given task rows of one tracker.

    Returns {"updated": [row names], "skipped": [{name, task_name, reason}]}.
    """
    if action not in VALID_ACTIONS:
        frappe.throw(_("Unknown bulk action: {0}").format(action))

    # Gate AFTER the action is known -- marking Not Applicable is Admin-only.
    _require_bulk_access(action)

    if not tracker or not frappe.db.exists(PARENT_DOCTYPE, tracker):
        frappe.throw(_("Commission report {0} not found.").format(tracker or ""))

    rows = frappe.parse_json(task_rows) if isinstance(task_rows, str) else task_rows
    if not isinstance(rows, (list, tuple)) or not rows:
        frappe.throw(_("Select at least one report row."))

    # De-duplicate while preserving the caller's order, so the response reads in
    # the same order as the selection on screen.
    ordered_rows = list(dict.fromkeys(str(r) for r in rows if r))
    if len(ordered_rows) > MAX_ROWS_PER_CALL:
        frappe.throw(
            _("Too many rows in one request ({0}). Select at most {1}.").format(
                len(ordered_rows), MAX_ROWS_PER_CALL
            )
        )

    new_deadline = None
    if action == ACTION_SET_DEADLINE:
        if not deadline:
            frappe.throw(_("A deadline date is required."))
        try:
            new_deadline = getdate(deadline)
        except Exception:
            frappe.throw(_("{0} is not a valid date.").format(deadline))

    rows = frappe.get_all(
        CHILD_DOCTYPE,
        filters={"name": ["in", ordered_rows]},
        fields=[
            "name", "task_name", "task_status", "commission_category", "parent", "parenttype",
            # Approving reads BOTH: the type decides the target status, the file is
            # the evidence a Vendor approval needs.
            "report_type", "approval_proof",
        ],
    )
    existing = {row["name"]: row for row in rows}

    # Re-activation restores a deadline, so resolve them for the whole batch at once.
    reactivation_deadlines = (
        _reactivation_deadlines(tracker, rows) if action == ACTION_MARK_PENDING else {}
    )

    updated: list[str] = []
    skipped: list[dict] = []
    # status -> count. An APPROVE run lands rows in TWO different states, so the
    # caller cannot report it as one number.
    updated_by_status: dict = {}

    def skip(name: str, task_name: str, reason: str) -> None:
        skipped.append({"name": name, "task_name": task_name, "reason": reason})

    for name in ordered_rows:
        row = existing.get(name)
        if not row:
            skip(name, "", _("Report row no longer exists"))
            continue

        task_name = row.get("task_name") or ""

        # A row addressed from a different tracker is a REQUEST error, but it is
        # reported rather than thrown so the rest of the batch still applies.
        if row.get("parent") != tracker or row.get("parenttype") != PARENT_DOCTYPE:
            skip(name, task_name, _("Belongs to a different commission report"))
            continue

        reason = _skip_reason(row.get("task_status"), action, row)
        if reason:
            skip(name, task_name, reason)
            continue

        holder = _locked_by_other(name)
        if holder:
            skip(name, task_name, _("Currently being edited by {0}").format(holder))
            continue

        if action == ACTION_APPROVE:
            # PER ROW, derived from the row's OWN stored report_type -- never from
            # anything the client sent, so a stale page cannot write the wrong
            # TERMINAL status onto a Vendor report. The deadline is not touched.
            values = {"task_status": approval_target(row.get("report_type"))}
        elif action == ACTION_REJECT:
            values = {"task_status": REJECTED}
        elif action == ACTION_MARK_NOT_APPLICABLE:
            # NULL, not "" -- the deadline column is a Date.
            values = {"task_status": NOT_APPLICABLE, "deadline": None}
        elif action == ACTION_MARK_PENDING:
            values: dict = {"task_status": PENDING}
            # A deadline is RESTORED only when re-activating a Not Applicable row --
            # that row lost its own when it was marked. Any other status still HAS a
            # real deadline, and recomputing would silently overwrite it. Mirrors the
            # per-row split: "Re-activate" recomputes, admin "Send back" does not.
            if (row.get("task_status") or "").strip() == NOT_APPLICABLE:
                values["deadline"] = reactivation_deadlines.get(name)
        else:
            values = {"deadline": new_deadline}

        frappe.db.set_value(CHILD_DOCTYPE, name, values)
        updated.append(name)
        new_status = values.get("task_status")
        if new_status:
            updated_by_status[new_status] = updated_by_status.get(new_status, 0) + 1

    if updated:
        # Touch the parent so tracker lists / SWR caches see the change. Mirrors
        # the master-cascade in commission_report_tasks.on_update.
        frappe.db.set_value(PARENT_DOCTYPE, tracker, {"modified": now()}, update_modified=False)
        frappe.db.commit()

    return {
        "tracker": tracker,
        "action": action,
        "updated": updated,
        "updated_by_status": updated_by_status,
        "skipped": skipped,
    }
