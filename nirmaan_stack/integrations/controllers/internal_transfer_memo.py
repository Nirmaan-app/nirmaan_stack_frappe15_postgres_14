# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Internal Transfer Memo (ITM) lifecycle controller.

ITMs are created by the ITR approval flow (approve_itr_items) and start
in "Approved" status. This controller handles dispatch → delivery lifecycle only.
Approval logic lives in the ITR controller and approve_itr_items API.
"""

import frappe
from frappe.utils import flt, now


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ADMIN_ROLE = "Nirmaan Admin Profile"

# Roles allowed to dispatch an Approved ITM. Mirrors `ITM_DISPATCH_ROLES`
# on the frontend so UI gating and backend enforcement stay in sync.
DISPATCH_ROLES = (
    "Nirmaan Admin Profile",
    "Nirmaan Procurement Executive Profile",
)

# Statuses where deletion is blocked (dispatch/delivery has begun).
DELETE_BLOCKED_STATUSES = ("Dispatched", "Partially Delivered", "Delivered")

# Valid state transitions: old_status -> set of allowed new statuses.
ALLOWED_TRANSITIONS = {
    None: {"Approved"},  # Created by ITR approval
    "Approved": {"Approved", "Dispatched"},
    "Dispatched": {"Dispatched", "Partially Delivered", "Delivered"},
    "Partially Delivered": {"Partially Delivered", "Delivered"},
    "Delivered": {"Delivered"},
}


# ---------------------------------------------------------------------------
# Hooks
# ---------------------------------------------------------------------------

def validate(doc, method):
    """Enforce invariants and state machine on every save."""
    _validate_basic_invariants(doc)

    old_status = _get_old_status(doc)
    new_status = doc.status

    _validate_state_transition(doc, old_status, new_status)
    _stamp_lifecycle_fields(doc, old_status, new_status)
    _recompute_totals(doc)


def before_delete(doc, method):
    """Block deletion after dispatch."""
    if doc.status in DELETE_BLOCKED_STATUSES:
        frappe.throw("Cannot delete a dispatched or delivered Internal Transfer Memo.")

    user = frappe.session.user
    roles = frappe.get_roles(user)
    is_admin = user == "Administrator" or ADMIN_ROLE in roles
    is_owner = doc.owner == user

    if not (is_admin or is_owner):
        frappe.throw("You do not have permission to delete this Internal Transfer Memo.")


def on_update(doc, method):
    """Emit real-time events and adjust warehouse stock on status transitions."""
    _adjust_warehouse_stock_on_dispatch(doc)
    _emit_transition_events(doc)


def _adjust_warehouse_stock_on_dispatch(doc):
    """When ITM source=Warehouse transitions Approved → Dispatched, deduct stock."""
    before = doc.get_doc_before_save()
    if not before:
        return
    old_status = before.status
    new_status = doc.status
    if old_status == "Approved" and new_status == "Dispatched":
        source_type = getattr(doc, "source_type", None) or "Project"
        if source_type == "Warehouse":
            from nirmaan_stack.integrations.controllers.warehouse_stock import (
                adjust_on_dispatch_from_warehouse,
            )
            adjust_on_dispatch_from_warehouse(doc)


# ---------------------------------------------------------------------------
# Validate helpers
# ---------------------------------------------------------------------------

def _validate_basic_invariants(doc):
    source_type = getattr(doc, "source_type", None) or "Project"
    target_type = getattr(doc, "target_type", None) or "Project"

    if target_type == "Project" and not doc.target_project:
        frappe.throw("Target Project is required for project transfers.")
    if source_type == "Warehouse" and target_type == "Warehouse":
        frappe.throw("Source and target cannot both be Warehouse.")
    if (
        source_type == "Project" and target_type == "Project"
        and doc.source_project and doc.target_project
        and doc.source_project == doc.target_project
    ):
        frappe.throw("Source and target projects must differ.")

    if not doc.items:
        frappe.throw("At least one item is required.")

    for row in doc.items:
        qty = flt(row.transfer_quantity)
        if qty <= 0:
            frappe.throw(f"Row {row.idx}: transfer quantity must be greater than zero.")


def _get_old_status(doc):
    if doc.is_new():
        return None
    before = doc.get_doc_before_save()
    if before is not None:
        return before.status
    return frappe.db.get_value(doc.doctype, doc.name, "status")


def _validate_state_transition(doc, old_status, new_status):
    allowed = ALLOWED_TRANSITIONS.get(old_status)
    if allowed is None or new_status not in allowed:
        frappe.throw(
            f"Invalid status transition: {old_status or 'None'} → {new_status}"
        )

    if old_status == "Approved" and new_status == "Dispatched":
        _require_dispatcher(
            "Only administrators or procurement executives may dispatch "
            "Internal Transfer Memos."
        )


def _require_admin(message):
    user = frappe.session.user
    if user == "Administrator":
        return
    if ADMIN_ROLE in frappe.get_roles(user):
        return
    frappe.throw(message, frappe.PermissionError)


def _require_dispatcher(message):
    """Permit users whose ``role_profile_name`` is in ``DISPATCH_ROLES``
    (or the special ``Administrator`` user).

    We compare against the user's *role profile* (the same string the frontend
    uses via ``useUserData`` / ``data.role_profile``) — NOT ``frappe.get_roles``.
    Frappe role profiles assign multiple underlying roles to a user, and
    ``get_roles`` returns those underlying roles which don't include the
    profile name itself. Comparing against ``role_profile_name`` directly
    keeps frontend gating and backend enforcement reading from the same value.
    """
    user = frappe.session.user
    if user == "Administrator":
        return
    role_profile = frappe.db.get_value("User", user, "role_profile_name")
    if role_profile in DISPATCH_ROLES:
        return
    frappe.throw(message, frappe.PermissionError)


def _stamp_lifecycle_fields(doc, old_status, new_status):
    if doc.is_new() and not doc.requested_by:
        doc.requested_by = frappe.session.user

    if old_status == "Approved" and new_status == "Dispatched":
        doc.dispatched_by = frappe.session.user
        doc.dispatched_on = now()


def _recompute_totals(doc):
    items = doc.items or []
    doc.total_items = len(items)
    doc.total_quantity = sum(flt(r.transfer_quantity) for r in items)
    doc.estimated_value = sum(
        flt(r.transfer_quantity) * flt(r.estimated_rate) for r in items
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
    target_type = getattr(doc, "target_type", None) or "Project"
    if old_status == "Approved" and new_status == "Dispatched":
        event = "itm:dispatched"
        if target_type == "Warehouse":
            recipients = _get_admins() | {doc.requested_by}
        else:
            recipients = _get_project_users(doc.target_project) | {doc.requested_by}
    elif new_status in ("Delivered", "Partially Delivered"):
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
