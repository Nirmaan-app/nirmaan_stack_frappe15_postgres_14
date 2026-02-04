"""
PR Editing Lock API

Provides Redis-based locking mechanism for Procurement Request editing
to prevent concurrent edits by multiple users.

Lock expiry: 15 minutes (auto-expire stale locks)
Heartbeat interval: 5 minutes (clients call extend_lock)
"""

import frappe
from frappe import _
from frappe.utils import now_datetime
from typing import TypedDict, Optional


# Constants
LOCK_EXPIRY_SECONDS = 15 * 60  # 15 minutes
HEARTBEAT_INTERVAL_SECONDS = 5 * 60  # 5 minutes (client-side)


class LockInfo(TypedDict):
    """Structure for lock information"""
    user: str
    user_name: str
    timestamp: str


class LockResponse(TypedDict):
    """Standard response structure for lock operations"""
    success: bool
    message: str
    lock_info: Optional[LockInfo]


def _get_cache_key(pr_name: str) -> str:
    """Generate consistent cache key for PR editing lock"""
    return f"pr_editing_lock:{pr_name}"


def _get_current_lock(pr_name: str) -> Optional[LockInfo]:
    """Retrieve current lock information from Redis cache"""
    cache_key = _get_cache_key(pr_name)
    return frappe.cache().get_value(cache_key)


def _set_lock(pr_name: str, lock_info: LockInfo) -> None:
    """Set lock in Redis cache with expiry"""
    cache_key = _get_cache_key(pr_name)
    frappe.cache().set_value(cache_key, lock_info, expires_in_sec=LOCK_EXPIRY_SECONDS)


def _clear_lock(pr_name: str) -> None:
    """Remove lock from Redis cache"""
    cache_key = _get_cache_key(pr_name)
    frappe.cache().delete_value(cache_key)


def _get_user_full_name(user: str) -> str:
    """Get user's full name, with fallback to user ID"""
    if user == "Administrator":
        return "Administrator"

    full_name = frappe.db.get_value("User", user, "full_name")
    if full_name:
        return full_name

    # Fallback: check Nirmaan Users
    nirmaan_name = frappe.db.get_value("Nirmaan Users", user, "full_name")
    return nirmaan_name or user


def _emit_lock_event(event: str, pr_name: str, user: str, user_name: str) -> None:
    """
    Emit Socket.IO event for real-time lock status updates.

    Events:
    - pr:editing:started - When a user acquires a lock
    - pr:editing:stopped - When a user releases a lock
    """
    frappe.db.commit()  # Commit before realtime to avoid race conditions

    frappe.publish_realtime(
        event=event,
        message={
            "pr_name": pr_name,
            "user": user,
            "user_name": user_name,
            "timestamp": now_datetime().isoformat()
        },
        doctype="Procurement Requests",
        docname=pr_name
    )


@frappe.whitelist()
def acquire_lock(pr_name: str) -> LockResponse:
    """
    Acquire editing lock for a Procurement Request using Redis cache.

    Args:
        pr_name: The name/ID of the Procurement Request document

    Returns:
        LockResponse with success status, message, and lock_info

    Behavior:
        - If no lock exists, acquires lock for current user
        - If lock held by same user, extends the lock (idempotent)
        - If lock held by another user, returns error with their info

    Lock expires automatically after 15 minutes if not extended.
    """
    if not pr_name:
        frappe.throw(_("PR name is required"))

    # Validate PR exists
    if not frappe.db.exists("Procurement Requests", pr_name):
        frappe.throw(_("Procurement Request {0} does not exist").format(pr_name))

    current_user = frappe.session.user
    current_user_name = _get_user_full_name(current_user)
    current_lock = _get_current_lock(pr_name)

    # Case 1: No existing lock - acquire it
    if not current_lock:
        lock_info: LockInfo = {
            "user": current_user,
            "user_name": current_user_name,
            "timestamp": now_datetime().isoformat()
        }
        _set_lock(pr_name, lock_info)
        _emit_lock_event("pr:editing:started", pr_name, current_user, current_user_name)

        return {
            "success": True,
            "message": _("Lock acquired successfully"),
            "lock_info": lock_info
        }

    # Case 2: Lock held by same user - extend it (idempotent)
    if current_lock.get("user") == current_user:
        # Update timestamp and extend TTL
        lock_info: LockInfo = {
            "user": current_user,
            "user_name": current_user_name,
            "timestamp": now_datetime().isoformat()
        }
        _set_lock(pr_name, lock_info)

        return {
            "success": True,
            "message": _("Lock extended successfully"),
            "lock_info": lock_info
        }

    # Case 3: Lock held by another user - return error
    lock_holder = current_lock.get("user_name") or current_lock.get("user")
    return {
        "success": False,
        "message": _("PR is currently being edited by {0}").format(lock_holder),
        "lock_info": current_lock
    }


@frappe.whitelist()
def release_lock(pr_name: str) -> LockResponse:
    """
    Release editing lock for a Procurement Request.

    Args:
        pr_name: The name/ID of the Procurement Request document

    Returns:
        LockResponse with success status and message

    Behavior:
        - Only the user holding the lock can release it
        - Admins can force-release any lock
        - If no lock exists, returns success (idempotent)
    """
    if not pr_name:
        frappe.throw(_("PR name is required"))

    current_user = frappe.session.user
    current_user_name = _get_user_full_name(current_user)
    current_lock = _get_current_lock(pr_name)

    # Case 1: No lock exists - return success (idempotent)
    if not current_lock:
        return {
            "success": True,
            "message": _("No active lock found"),
            "lock_info": None
        }

    lock_holder = current_lock.get("user")

    # Case 2: Current user holds the lock - release it
    if lock_holder == current_user:
        _clear_lock(pr_name)
        _emit_lock_event("pr:editing:stopped", pr_name, current_user, current_user_name)

        return {
            "success": True,
            "message": _("Lock released successfully"),
            "lock_info": None
        }

    # Case 3: Admin can force-release any lock
    is_admin = current_user == "Administrator"
    if not is_admin:
        user_role = frappe.db.get_value("Nirmaan Users", current_user, "role_profile")
        is_admin = user_role == "Nirmaan Admin Profile"

    if is_admin:
        _clear_lock(pr_name)
        # Emit event with the original lock holder's info
        _emit_lock_event(
            "pr:editing:stopped",
            pr_name,
            current_lock.get("user"),
            current_lock.get("user_name", "Unknown")
        )

        return {
            "success": True,
            "message": _("Lock force-released by admin"),
            "lock_info": None
        }

    # Case 4: Another user holds the lock - cannot release
    lock_holder_name = current_lock.get("user_name") or lock_holder
    return {
        "success": False,
        "message": _("Cannot release lock held by {0}").format(lock_holder_name),
        "lock_info": current_lock
    }


@frappe.whitelist()
def check_lock(pr_name: str) -> LockResponse:
    """
    Check current lock status for a Procurement Request without acquiring.

    Args:
        pr_name: The name/ID of the Procurement Request document

    Returns:
        LockResponse with current lock status

    Use this to check if PR is being edited before attempting to acquire lock.
    """
    if not pr_name:
        frappe.throw(_("PR name is required"))

    current_lock = _get_current_lock(pr_name)
    current_user = frappe.session.user

    if not current_lock:
        return {
            "success": True,
            "message": _("PR is available for editing"),
            "lock_info": None
        }

    lock_holder = current_lock.get("user")
    lock_holder_name = current_lock.get("user_name") or lock_holder

    # Check if current user holds the lock
    if lock_holder == current_user:
        return {
            "success": True,
            "message": _("You have the editing lock"),
            "lock_info": current_lock
        }

    return {
        "success": False,
        "message": _("PR is currently being edited by {0}").format(lock_holder_name),
        "lock_info": current_lock
    }


@frappe.whitelist()
def extend_lock(pr_name: str) -> LockResponse:
    """
    Heartbeat to extend an existing lock (called every 5 minutes by client).

    Args:
        pr_name: The name/ID of the Procurement Request document

    Returns:
        LockResponse with success status

    Behavior:
        - Only extends if current user holds the lock
        - Resets the 15-minute expiry timer
        - If lock doesn't exist or held by another user, returns error

    Clients should call this every 5 minutes while actively editing.
    """
    if not pr_name:
        frappe.throw(_("PR name is required"))

    current_user = frappe.session.user
    current_user_name = _get_user_full_name(current_user)
    current_lock = _get_current_lock(pr_name)

    # Case 1: No lock exists - cannot extend
    if not current_lock:
        return {
            "success": False,
            "message": _("No active lock to extend. Please acquire a new lock."),
            "lock_info": None
        }

    lock_holder = current_lock.get("user")

    # Case 2: Current user holds the lock - extend it
    if lock_holder == current_user:
        lock_info: LockInfo = {
            "user": current_user,
            "user_name": current_user_name,
            "timestamp": now_datetime().isoformat()
        }
        _set_lock(pr_name, lock_info)

        return {
            "success": True,
            "message": _("Lock extended successfully"),
            "lock_info": lock_info
        }

    # Case 3: Another user holds the lock - cannot extend
    lock_holder_name = current_lock.get("user_name") or lock_holder
    return {
        "success": False,
        "message": _("Lock is held by {0}").format(lock_holder_name),
        "lock_info": current_lock
    }
