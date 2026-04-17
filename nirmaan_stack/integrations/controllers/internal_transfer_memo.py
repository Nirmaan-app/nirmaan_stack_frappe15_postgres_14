# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Internal Transfer Memo (ITM) lifecycle controller: enforces state machine,
cross-project availability invariants, approval authorization and stamps."""

import frappe
from frappe.utils import flt, now


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ADMIN_ROLE = "Nirmaan Admin Profile"

# Statuses where items are actively "reserving" qty from the source RIR.
NON_TERMINAL_STATUSES = ("Pending Approval", "Approved")

# Statuses where deletion is blocked (dispatch/delivery has begun).
DELETE_BLOCKED_STATUSES = ("Dispatched", "Partially Delivered", "Delivered")

# Post-approval statuses — skip latest-RIR invariant after approval so later RIRs
# don't retroactively invalidate the memo.
POST_APPROVAL_STATUSES = (
    "Approved",
    "Rejected",
    "Dispatched",
    "Partially Delivered",
    "Delivered",
)

# Statuses managed by DN delivery — _derive_memo_status_from_items must not override.
DISPATCH_AND_DELIVERY_STATUSES = ("Dispatched", "Partially Delivered", "Delivered")

# Valid state transitions: old_status -> set of allowed new statuses.
ALLOWED_TRANSITIONS = {
    None: {"Pending Approval"},
    "Pending Approval": {"Pending Approval", "Approved", "Rejected"},
    "Approved": {"Approved", "Dispatched"},
    "Rejected": {"Rejected"},
    "Dispatched": {"Dispatched", "Partially Delivered", "Delivered"},
    "Partially Delivered": {"Partially Delivered", "Delivered"},
    "Delivered": {"Delivered"},
}


# ---------------------------------------------------------------------------
# Hooks
# ---------------------------------------------------------------------------

def validate(doc, method):
    """Enforce invariants, state machine and concurrency guards on every save."""
    _validate_basic_invariants(doc)
    _validate_source_rir(doc)

    old_status = _get_old_status(doc)
    new_status = doc.status

    _validate_state_transition(doc, old_status, new_status)

    if _should_run_availability_guard(doc, old_status, new_status):
        _validate_availability(doc)

    _stamp_lifecycle_fields(doc, old_status, new_status)
    _derive_memo_status_from_items(doc)
    _recompute_totals(doc)


def before_delete(doc, method):
    """Block deletion after dispatch; gate deletion to creator or admins."""
    if doc.status in DELETE_BLOCKED_STATUSES:
        frappe.throw("Cannot delete a dispatched or delivered Internal Transfer Memo.")

    user = frappe.session.user
    roles = frappe.get_roles(user)
    is_admin = user == "Administrator" or ADMIN_ROLE in roles
    is_owner = doc.owner == user

    if not (is_admin or is_owner):
        frappe.throw("You do not have permission to delete this Internal Transfer Memo.")


def after_insert(doc, method):
    """Emit itm:new event and sync parent Transfer Request status."""
    _derive_request_status(doc.transfer_request)
    recipients = _get_admins() | {doc.requested_by}
    message = {"itm": doc.name, "status": doc.status}
    frappe.db.commit()
    for user in recipients:
        if user:
            frappe.publish_realtime(event="itm:new", message=message, user=user)


def on_update(doc, method):
    """Sync parent Transfer Request status and emit real-time events."""
    _derive_request_status(doc.transfer_request)
    _emit_transition_events(doc)


# ---------------------------------------------------------------------------
# Validate helpers
# ---------------------------------------------------------------------------

def _validate_basic_invariants(doc):
    if doc.source_project and doc.target_project and doc.source_project == doc.target_project:
        frappe.throw("Source and target projects must differ.")

    if not doc.items:
        frappe.throw("At least one item is required.")

    for row in doc.items:
        qty = flt(row.transfer_quantity)
        rate = flt(row.estimated_rate)
        if qty <= 0:
            frappe.throw(
                f"Row {row.idx}: transfer quantity must be greater than zero."
            )
        if rate < 0:
            frappe.throw(
                f"Row {row.idx}: estimated rate cannot be negative."
            )


def _validate_source_rir(doc):
    """Source RIR must be the latest submitted RIR of source_project — skipped
    once the memo has already been approved/rejected so future RIR submissions
    don't retroactively invalidate it."""
    if not doc.source_project or not doc.source_rir:
        return

    if not doc.is_new() and doc.status in POST_APPROVAL_STATUSES:
        return

    latest = frappe.db.sql(
        """
        SELECT name FROM "tabRemaining Items Report"
        WHERE project = %(project)s AND status = 'Submitted'
        ORDER BY report_date DESC, creation DESC
        LIMIT 1
        """,
        {"project": doc.source_project},
        as_dict=False,
    )

    if not latest:
        frappe.throw("Source project has no submitted Remaining Items Report.")

    latest_rir = latest[0][0]
    if doc.source_rir != latest_rir:
        frappe.throw(
            f"Source RIR must be the latest submitted RIR for the source project "
            f"(latest: {latest_rir})."
        )


def _get_old_status(doc):
    if doc.is_new():
        return None

    before = doc.get_doc_before_save()
    if before is not None:
        return before.status

    # Fallback — before-save snapshot isn't always populated (e.g. nested saves).
    return frappe.db.get_value(doc.doctype, doc.name, "status")


def _validate_state_transition(doc, old_status, new_status):
    allowed = ALLOWED_TRANSITIONS.get(old_status)
    if allowed is None or new_status not in allowed:
        frappe.throw(
            f"Invalid status transition: {old_status or 'None'} → {new_status}"
        )

    # Approve/reject: require admin role.
    if old_status == "Pending Approval" and new_status in ("Approved", "Rejected"):
        _require_admin(
            "Only administrators may approve or reject Internal Transfer Memos."
        )

    # Dispatch: require admin role; auto-reject any remaining Pending items.
    if old_status == "Approved" and new_status == "Dispatched":
        _require_admin(
            "Only administrators may dispatch Internal Transfer Memos."
        )
        for row in doc.items:
            if getattr(row, "status", None) == "Pending":
                row.status = "Rejected"
                row.rejection_reason = "Not reviewed before dispatch"
        doc.dispatched_by = frappe.session.user
        doc.dispatched_on = now()


def _require_admin(message):
    user = frappe.session.user
    if user == "Administrator":
        return
    if ADMIN_ROLE in frappe.get_roles(user):
        return
    frappe.throw(message, frappe.PermissionError)


def _should_run_availability_guard(doc, old_status, new_status):
    if doc.is_new():
        return True
    if old_status == "Pending Approval" and new_status == "Approved":
        return True
    return False


def _validate_availability(doc):
    """Ensure each (item_id, source_project) line fits inside available qty,
    excluding the current doc from the reserved tally.  Only items with
    status Pending or Approved reserve quantity — rejected items are skipped."""
    exclude = None if doc.is_new() else doc.name

    # Aggregate requested qty per item_id (only non-rejected items).
    requested_by_item = {}
    for row in doc.items:
        item_id = row.item_id
        if not item_id:
            continue
        item_status = getattr(row, "status", "Pending")
        if item_status not in ("Pending", "Approved"):
            continue
        requested_by_item[item_id] = requested_by_item.get(item_id, 0.0) + flt(row.transfer_quantity)

    violations = []
    for item_id, requested in requested_by_item.items():
        available = available_quantity(
            item_id=item_id,
            source_project=doc.source_project,
            exclude_itm=exclude,
        )
        if requested - available > 1e-6:
            conflicts = conflicting_itms(
                item_id=item_id,
                source_project=doc.source_project,
                exclude_itm=exclude,
            )
            violations.append(
                {
                    "item_id": item_id,
                    "requested": requested,
                    "available": available,
                    "conflicts": conflicts,
                }
            )

    if not violations:
        return

    lines = ["Insufficient available quantity for the following items:"]
    for v in violations:
        base = (
            f"  • {v['item_id']}: requested {v['requested']:g}, "
            f"available {v['available']:g}"
        )
        if v["conflicts"]:
            base += f" — reserved by: {', '.join(v['conflicts'])}"
        lines.append(base)
    frappe.throw("\n".join(lines))


def _stamp_lifecycle_fields(doc, old_status, new_status):
    if doc.is_new() and not doc.requested_by:
        doc.requested_by = frappe.session.user

    if old_status == "Pending Approval" and new_status == "Approved":
        doc.approved_by = frappe.session.user
        doc.approved_on = now()


def _derive_memo_status_from_items(doc):
    """Compute memo status from child item statuses.  Only applies to
    pre-dispatch statuses — Dispatched/Partially Delivered/Delivered are
    managed by the DN delivery system and must not be overridden."""
    if doc.status in DISPATCH_AND_DELIVERY_STATUSES:
        return

    item_statuses = [getattr(r, "status", "Pending") for r in (doc.items or [])]
    if not item_statuses:
        return

    if any(s == "Pending" for s in item_statuses):
        doc.status = "Pending Approval"
    elif all(s == "Rejected" for s in item_statuses):
        doc.status = "Rejected"
    elif any(s == "Approved" for s in item_statuses):
        doc.status = "Approved"


def _recompute_totals(doc):
    items = doc.items or []
    doc.total_items = len(items)
    doc.total_quantity = sum(flt(r.transfer_quantity) for r in items)
    doc.estimated_value = sum(
        flt(r.transfer_quantity) * flt(r.estimated_rate) for r in items
    )
    doc.approved_items = sum(
        1 for r in items if getattr(r, "status", None) == "Approved"
    )


def _derive_request_status(request_name):
    """Sync the parent Transfer Request status from its linked memos."""
    if not request_name:
        return

    memos = frappe.get_all(
        "Internal Transfer Memo",
        filters={"transfer_request": request_name},
        fields=["status"],
    )
    if not memos:
        return

    has_pending = any(m.status == "Pending Approval" for m in memos)
    all_rejected = all(m.status == "Rejected" for m in memos)

    if has_pending:
        new_status = "Pending"
    elif all_rejected:
        new_status = "Rejected"
    else:
        new_status = "Completed"

    frappe.db.set_value(
        "Internal Transfer Request", request_name, "status",
        new_status, update_modified=False,
    )


# ---------------------------------------------------------------------------
# Real-time event helpers
# ---------------------------------------------------------------------------

def _emit_transition_events(doc):
    """Emit Socket.IO events based on ITM status transitions."""
    before = doc.get_doc_before_save()
    if not before:
        return

    old_status = before.status
    new_status = doc.status
    if old_status == new_status:
        return

    event = None
    if old_status == "Pending Approval" and new_status == "Approved":
        event = "itm:approved"
        recipients = _get_project_users(doc.target_project) | {doc.requested_by}
    elif old_status == "Pending Approval" and new_status == "Rejected":
        event = "itm:rejected"
        recipients = {doc.requested_by}
    elif old_status == "Approved" and new_status == "Dispatched":
        event = "itm:dispatched"
        recipients = _get_project_users(doc.target_project) | {doc.requested_by}
    elif old_status == "Dispatched" and new_status in ("Delivered", "Partially Delivered"):
        event = "itm:delivered"
        recipients = {doc.requested_by}

    if not event:
        return

    message = {"itm": doc.name, "status": new_status}
    frappe.db.commit()
    for user in recipients:
        if user:
            frappe.publish_realtime(event=event, message=message, user=user)


def _get_admins():
    """Return set of users with the Admin role profile."""
    return {
        r.parent for r in frappe.get_all(
            "Has Role", filters={"role": ADMIN_ROLE, "parenttype": "User"},
            fields=["parent"],
        )
    }


def _get_project_users(project):
    """Return set of users with User Permission for a project."""
    if not project:
        return set()
    return {
        r.user for r in frappe.get_all(
            "User Permission",
            filters={"allow": "Projects", "for_value": project},
            fields=["user"],
        )
    }


# ---------------------------------------------------------------------------
# Shared helpers (used by picker/lifecycle APIs)
# ---------------------------------------------------------------------------

def available_quantity(item_id, source_project, exclude_itm=None):
    """Available transfer qty for (item_id, source_project) in the latest
    submitted RIR, net of qty already reserved by non-terminal ITMs.

    Only items with status Pending or Approved count as reserved.
    Returns 0.0 when no submitted RIR exists for the source project, or when
    the item has no entry in that RIR.
    """
    if not item_id or not source_project:
        return 0.0

    latest_rir_qty = frappe.db.sql(
        """
        SELECT COALESCE(SUM(rie.remaining_quantity), 0)
        FROM "tabRemaining Item Entry" rie
        JOIN "tabRemaining Items Report" rir ON rie.parent = rir.name
        WHERE rir.project = %(src)s
          AND rir.status = 'Submitted'
          AND rir.name = (
            SELECT name FROM "tabRemaining Items Report"
            WHERE project = %(src)s AND status = 'Submitted'
            ORDER BY report_date DESC, creation DESC LIMIT 1
          )
          AND rie.item_id = %(item)s
        """,
        {"src": source_project, "item": item_id},
    )
    rir_qty = flt(latest_rir_qty[0][0]) if latest_rir_qty else 0.0

    reserved = frappe.db.sql(
        """
        SELECT COALESCE(SUM(itmi.transfer_quantity), 0)
        FROM "tabInternal Transfer Memo Item" itmi
        JOIN "tabInternal Transfer Memo" itm ON itmi.parent = itm.name
        WHERE itm.source_project = %(src)s
          AND itm.status IN ('Pending Approval', 'Approved')
          AND itmi.item_id = %(item)s
          AND itmi.status IN ('Pending', 'Approved')
          AND (%(exclude)s IS NULL OR itm.name != %(exclude)s)
        """,
        {"src": source_project, "item": item_id, "exclude": exclude_itm},
    )
    reserved_qty = flt(reserved[0][0]) if reserved else 0.0

    return rir_qty - reserved_qty


def conflicting_itms(item_id, source_project, exclude_itm=None):
    """Return names of non-terminal ITMs that reserve qty of this
    (item, source_project) pair — used for human-readable error messages."""
    if not item_id or not source_project:
        return []

    rows = frappe.db.sql(
        """
        SELECT DISTINCT itm.name
        FROM "tabInternal Transfer Memo Item" itmi
        JOIN "tabInternal Transfer Memo" itm ON itmi.parent = itm.name
        WHERE itm.source_project = %(src)s
          AND itm.status IN ('Pending Approval', 'Approved')
          AND itmi.item_id = %(item)s
          AND itmi.status IN ('Pending', 'Approved')
          AND (%(exclude)s IS NULL OR itm.name != %(exclude)s)
        ORDER BY itm.name
        """,
        {"src": source_project, "item": item_id, "exclude": exclude_itm},
    )
    return [r[0] for r in rows] if rows else []
