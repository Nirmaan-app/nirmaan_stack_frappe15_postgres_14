"""
Commission Report editing lock API.

Redis-based "someone is editing this report right now" lock for a single
Commission Report Task Child Table row, so the approval queue can WARN (and
block) an approver while a team member has the report open in the edit wizard.

Mirrors api/pr_editing_lock.py but is deliberately ISOLATED (its own Redis key
namespace + its own socket events) so the production PR-approval lock is never
touched. Keyed by the child-row name — the SAME value the edit wizard uses as
its `childRowName` route param and the approval dialog uses as `task.name`.

Lock expiry: 15 minutes (auto-expire stale locks).
Heartbeat interval: 5 minutes (clients call extend_lock).

Events are BROADCAST (no doctype/docname/user targeting) because the editor and
the approval queue live on different pages — listeners filter by `task_name`.
"""

import frappe
from frappe import _
from frappe.utils import now_datetime
from typing import TypedDict, Optional


# Constants
LOCK_EXPIRY_SECONDS = 15 * 60  # 15 minutes
HEARTBEAT_INTERVAL_SECONDS = 5 * 60  # 5 minutes (client-side)

TASK_DOCTYPE = "Commission Report Task Child Table"


class LockInfo(TypedDict):
    """Structure for lock information."""
    user: str
    user_name: str
    timestamp: str


class LockResponse(TypedDict):
    """Standard response structure for lock operations."""
    success: bool
    message: str
    lock_info: Optional[LockInfo]


def _get_cache_key(task_name: str) -> str:
    """Generate a consistent cache key for a commission report editing lock."""
    return f"commission_report_lock:{task_name}"


def _get_current_lock(task_name: str) -> Optional[LockInfo]:
    """Retrieve current lock information from Redis cache."""
    return frappe.cache().get_value(_get_cache_key(task_name))


def _set_lock(task_name: str, lock_info: LockInfo) -> None:
    """Set lock in Redis cache with expiry."""
    frappe.cache().set_value(_get_cache_key(task_name), lock_info, expires_in_sec=LOCK_EXPIRY_SECONDS)


def _clear_lock(task_name: str) -> None:
    """Remove lock from Redis cache."""
    frappe.cache().delete_value(_get_cache_key(task_name))


def _get_user_full_name(user: str) -> str:
    """Get user's full name, with fallback to user ID."""
    if user == "Administrator":
        return "Administrator"

    full_name = frappe.db.get_value("User", user, "full_name")
    if full_name:
        return full_name

    nirmaan_name = frappe.db.get_value("Nirmaan Users", user, "full_name")
    return nirmaan_name or user


def _emit_lock_event(event: str, task_name: str, user: str, user_name: str) -> None:
    """
    Broadcast a Socket.IO event for real-time lock status updates.

    Events:
    - commission:editing:started - When a user acquires a lock
    - commission:editing:stopped - When a user releases a lock

    Broadcast (no doctype/docname/user) so the approval queue page — which does
    not have the child-row doc "open" in a Frappe room — still receives it;
    listeners filter on `task_name`.
    """
    frappe.publish_realtime(
        event=event,
        message={
            "task_name": task_name,
            "user": user,
            "user_name": user_name,
            "timestamp": now_datetime().isoformat(),
        },
    )


@frappe.whitelist()
def acquire_lock(task_name: str) -> LockResponse:
    """
    Acquire the editing lock for a Commission Report task row.

    Behaviour:
        - No lock -> acquire for the current user.
        - Lock held by same user -> extend (idempotent).
        - Lock held by another user -> return error with their info.

    Lock expires automatically after 15 minutes if not extended.
    """
    if not task_name:
        frappe.throw(_("Task name is required"))

    if not frappe.db.exists(TASK_DOCTYPE, task_name):
        frappe.throw(_("Commission report task {0} does not exist").format(task_name))

    current_user = frappe.session.user
    current_user_name = _get_user_full_name(current_user)
    current_lock = _get_current_lock(task_name)

    # Case 1: No existing lock - acquire it
    if not current_lock:
        lock_info: LockInfo = {
            "user": current_user,
            "user_name": current_user_name,
            "timestamp": now_datetime().isoformat(),
        }
        _set_lock(task_name, lock_info)
        _emit_lock_event("commission:editing:started", task_name, current_user, current_user_name)

        return {
            "success": True,
            "message": _("Lock acquired successfully"),
            "lock_info": lock_info,
        }

    # Case 2: Lock held by same user - extend it (idempotent)
    if current_lock.get("user") == current_user:
        lock_info: LockInfo = {
            "user": current_user,
            "user_name": current_user_name,
            "timestamp": now_datetime().isoformat(),
        }
        _set_lock(task_name, lock_info)

        return {
            "success": True,
            "message": _("Lock extended successfully"),
            "lock_info": lock_info,
        }

    # Case 3: Lock held by another user - return error
    lock_holder = current_lock.get("user_name") or current_lock.get("user")
    return {
        "success": False,
        "message": _("This report is currently being edited by {0}").format(lock_holder),
        "lock_info": current_lock,
    }


@frappe.whitelist()
def release_lock(task_name: str) -> LockResponse:
    """
    Release the editing lock for a Commission Report task row.

    Behaviour:
        - Only the lock holder can release it.
        - Admins can force-release any lock.
        - If no lock exists, returns success (idempotent).

    Not validated against doctype existence so release stays idempotent even if
    the row was deleted (e.g. a stale sendBeacon on tab close).
    """
    if not task_name:
        frappe.throw(_("Task name is required"))

    current_user = frappe.session.user
    current_user_name = _get_user_full_name(current_user)
    current_lock = _get_current_lock(task_name)

    # Case 1: No lock exists - return success (idempotent)
    if not current_lock:
        return {
            "success": True,
            "message": _("No active lock found"),
            "lock_info": None,
        }

    lock_holder = current_lock.get("user")

    # Case 2: Current user holds the lock - release it
    if lock_holder == current_user:
        _clear_lock(task_name)
        _emit_lock_event("commission:editing:stopped", task_name, current_user, current_user_name)

        return {
            "success": True,
            "message": _("Lock released successfully"),
            "lock_info": None,
        }

    # Case 3: Admin can force-release any lock
    is_admin = current_user == "Administrator"
    if not is_admin:
        user_role = frappe.db.get_value("Nirmaan Users", current_user, "role_profile")
        is_admin = user_role == "Nirmaan Admin Profile"

    if is_admin:
        _clear_lock(task_name)
        _emit_lock_event(
            "commission:editing:stopped",
            task_name,
            current_lock.get("user"),
            current_lock.get("user_name", "Unknown"),
        )

        return {
            "success": True,
            "message": _("Lock force-released by admin"),
            "lock_info": None,
        }

    # Case 4: Another user holds the lock - cannot release
    lock_holder_name = current_lock.get("user_name") or lock_holder
    return {
        "success": False,
        "message": _("Cannot release lock held by {0}").format(lock_holder_name),
        "lock_info": current_lock,
    }


@frappe.whitelist()
def check_lock(task_name: str) -> LockResponse:
    """
    Read the current lock status for a Commission Report task row WITHOUT
    acquiring it. Used by the approval dialog to learn who is editing.
    """
    if not task_name:
        frappe.throw(_("Task name is required"))

    current_lock = _get_current_lock(task_name)
    current_user = frappe.session.user

    if not current_lock:
        return {
            "success": True,
            "message": _("This report is available for editing"),
            "lock_info": None,
        }

    lock_holder = current_lock.get("user")
    lock_holder_name = current_lock.get("user_name") or lock_holder

    if lock_holder == current_user:
        return {
            "success": True,
            "message": _("You have the editing lock"),
            "lock_info": current_lock,
        }

    return {
        "success": False,
        "message": _("This report is currently being edited by {0}").format(lock_holder_name),
        "lock_info": current_lock,
    }


@frappe.whitelist()
def extend_lock(task_name: str) -> LockResponse:
    """
    Heartbeat to extend an existing lock (called every 5 minutes by the client).

    Behaviour:
        - Only extends if the current user holds the lock.
        - Resets the 15-minute expiry timer.
        - If the lock is missing or held by another user, returns error.
    """
    if not task_name:
        frappe.throw(_("Task name is required"))

    current_user = frappe.session.user
    current_user_name = _get_user_full_name(current_user)
    current_lock = _get_current_lock(task_name)

    # Case 1: No lock exists - cannot extend
    if not current_lock:
        return {
            "success": False,
            "message": _("No active lock to extend. Please acquire a new lock."),
            "lock_info": None,
        }

    lock_holder = current_lock.get("user")

    # Case 2: Current user holds the lock - extend it
    if lock_holder == current_user:
        lock_info: LockInfo = {
            "user": current_user,
            "user_name": current_user_name,
            "timestamp": now_datetime().isoformat(),
        }
        _set_lock(task_name, lock_info)

        return {
            "success": True,
            "message": _("Lock extended successfully"),
            "lock_info": lock_info,
        }

    # Case 3: Another user holds the lock - cannot extend
    lock_holder_name = current_lock.get("user_name") or lock_holder
    return {
        "success": False,
        "message": _("Lock is held by {0}").format(lock_holder_name),
        "lock_info": current_lock,
    }
