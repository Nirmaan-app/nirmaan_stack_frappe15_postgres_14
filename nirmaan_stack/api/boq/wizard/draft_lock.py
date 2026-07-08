# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Draft-tier single-editor lock (Config + Review) -- Phase B1 / ADR-0011.

Reuses the pricing single-editor lock ENGINE (pricing_lock.acquire_or_refresh /
read_lock_info / release / broadcast_lock_changed) with a DRAFT sentinel version = 0.
Real committed versions start at 1 (commit_pipeline._next_commit_version), so the draft
identity sha1(boq \\x00 sheet \\x00 0) is DISJOINT from every pricing-lock identity -- no new
doctype, no migration. A distinct BOQ_DRAFT_LOCKED marker lets the frontend tell a draft
reject from a pricing reject.

The draft lock spans BOTH Config and Review of one (boq, sheet_name). It is acquired in
every draft WRITE endpoint (update_sheet_draft config writers + review_screen edit /
restructure / revert + the AI-accept writers) AFTER the existing freeze guards
(_guard_sheet_not_parsing / _guard_sheet_not_finalized / _guard_sheet_not_frozen) and
BEFORE the write. It is NOT keyed on wizard_status (which flips Config Done <-> Parsed
mid-edit); the version=0 sentinel is stable across the whole draft lifecycle. Annotation-
only writes (save_review_remark, dismiss_row_flags) do NOT acquire.

Realtime: acquire / takeover / release broadcast boq:lock_changed with committed_version=0,
so the config + review screens flip read-only / free live (same event, filtered by version).
"""
from __future__ import annotations

import frappe
from frappe.utils import now_datetime

from nirmaan_stack.api.boq.wizard import pricing_lock

# Sentinel version for the draft tier -- real committed versions start at 1, so this never
# collides with a pricing-lock identity.
DRAFT_LOCK_VERSION = 0
_DRAFT_MARKER = "BOQ_DRAFT_LOCKED"


def acquire_or_refresh(boq: str, sheet_name: str, user: str, now) -> str:
    """Draft-tier acquire / refresh / reject / takeover (delegates to the pricing engine with
    version=0 + the BOQ_DRAFT_LOCKED marker + "edited" wording). Returns the action string;
    OTHER + FRESH throws with BOQ_DRAFT_LOCKED. Writes go through the CALLER's transaction."""
    return pricing_lock.acquire_or_refresh(
        boq, sheet_name, DRAFT_LOCK_VERSION, user, now,
        marker=_DRAFT_MARKER, activity="edited",
    )


def read_lock_info(boq: str, sheet_name: str, user: str, now) -> dict | None:
    """PURE read of the draft lock_info (never acquires). Same shape as read_lock_info."""
    return pricing_lock.read_lock_info(boq, sheet_name, DRAFT_LOCK_VERSION, user, now)


def release(boq: str, sheet_name: str, user: str, is_admin: bool = False) -> str | None:
    """Release the draft lock (holder / admin, idempotent). Returns released /
    released_by_admin / None."""
    return pricing_lock.release(boq, sheet_name, DRAFT_LOCK_VERSION, user, is_admin)


def broadcast_lock_changed(boq: str, sheet_name: str, action: str, locked_by) -> None:
    """Broadcast boq:lock_changed for the draft tier (committed_version=0). The CALLER must
    frappe.db.commit() first (commit-before-publish)."""
    pricing_lock.broadcast_lock_changed(boq, sheet_name, DRAFT_LOCK_VERSION, action, locked_by)


def _is_nirmaan_admin(user: str) -> bool:
    """Administrator or a Nirmaan Admin Profile user (used only for the force-release path)."""
    if user == "Administrator":
        return True
    return frappe.db.get_value("Nirmaan Users", user, "role_profile") == "Nirmaan Admin Profile"


def _validate(boq_name, sheet_name) -> None:
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")


@frappe.whitelist(methods=["POST"])
def acquire_draft_lock(boq_name=None, sheet_name=None):
    """Acquire (or heartbeat-refresh / stale-takeover) the DRAFT single-editor lock for a
    (boq, sheet_name VERBATIM #152), broadcasting boq:lock_changed on a real acquisition /
    takeover. Called by the config + review screens on FIRST edit-intent and periodically
    (~30s) as a heartbeat. OTHER + FRESH throws BOQ_DRAFT_LOCKED. Returns {ok, action, lock_info}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.draft_lock.acquire_draft_lock"""
    _validate(boq_name, sheet_name)
    user = frappe.session.user
    now = now_datetime()
    action = acquire_or_refresh(boq_name, sheet_name, user, now)
    frappe.db.commit()  # commit BEFORE publish so a re-reading client sees the new state
    if action in ("acquired", "took_over"):
        broadcast_lock_changed(boq_name, sheet_name, action, user)
    return {
        "ok": True,
        "action": action,
        "lock_info": read_lock_info(boq_name, sheet_name, user, now),
    }


@frappe.whitelist(methods=["POST"])
def release_draft_lock(boq_name=None, sheet_name=None):
    """Release the DRAFT single-editor lock on leave (the config / review screens fire this via
    navigator.sendBeacon on unload + on unmount). Idempotent + tolerant. The holder releases
    their own; an admin may force-release another's. Broadcasts boq:lock_changed {released}.
    Returns {ok, action}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.draft_lock.release_draft_lock"""
    _validate(boq_name, sheet_name)
    user = frappe.session.user
    action = release(boq_name, sheet_name, user, is_admin=_is_nirmaan_admin(user))
    frappe.db.commit()
    if action:
        broadcast_lock_changed(boq_name, sheet_name, "released", None)
    return {"ok": True, "action": action}


@frappe.whitelist()
def get_draft_lock_info(boq_name=None, sheet_name=None):
    """PURE read of the draft lock state for (boq, sheet_name VERBATIM #152) -- the config +
    review screens call this on mount (+ after a boq:lock_changed / reconnect) to gate
    read-only and name the holder. NEVER acquires. Returns {lock_info, editable}, where
    `editable` is False ONLY when the draft is held FRESH by ANOTHER user (mirrors the pricing
    get_priced_rows editable = free OR mine OR stale computation)."""
    _validate(boq_name, sheet_name)
    user = frappe.session.user
    info = read_lock_info(boq_name, sheet_name, user, now_datetime())
    editable = info is None or info["is_locked_by_me"] or info["is_stale"]
    return {"lock_info": info, "editable": editable}
