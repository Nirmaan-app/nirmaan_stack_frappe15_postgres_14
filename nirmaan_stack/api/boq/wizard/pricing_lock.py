# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Single-editor pricing lock -- atomic acquire-on-first-edit (Phase 5, lock slice A).

The lock is taken when a user FIRST saves a rate (save_cell_price) for a committed
(boq, sheet_name [VERBATIM #152], committed_version). Reading a sheet acquires nothing.

EXACTLY-ONE-WINNER (the load-bearing guarantee): the lock store ("BoQ Sheet Pricing
Lock") names each row by a DETERMINISTIC hash of the identity, so two near-simultaneous
first-edits both try to INSERT the SAME primary key. Postgres rejects the second with a
unique/PK violation that Frappe surfaces as `frappe.exceptions.DuplicateEntryError`;
exactly one INSERT wins and the loser re-reads the winning row and is routed to the
reject / takeover branch. This is the app's idiomatic atomicity primitive (a unique
identity enforced at the DB, mirroring the invariant-by-write-path convention).

EXPIRY (A2 / ADR-0011): the lock is STALE when now - last_edit_at exceeds
LOCK_STALE_SECONDS (~2 min). A holder save OR a periodic client heartbeat
(acquire_pricing_lock, ~30s) refreshes last_edit_at; a DIFFERENT user may take over a
STALE lock. A clean leave releases immediately (release_pricing_lock via sendBeacon);
a crash frees within the TTL.

REALTIME (A2 / ADR-0011): acquire / takeover / release broadcast `boq:lock_changed`
(broadcast_lock_changed) so every OPEN pricing screen flips read-only / free live -- the
server throw stays the durable enforcement, the event is the UX accelerator.

The reject (held-by-another, fresh) raises a decodable error prefixed with the stable
marker _LOCK_HELD_MARKER so the frontend can switch on it. The reject path WRITES NOTHING
-- save_cell_price gates on this BEFORE any freeze/insert, so a rejected save mutates no
pricing state.
"""
from __future__ import annotations

import hashlib

import frappe
from frappe.utils import get_datetime, now_datetime

# Holder-name resolution reused verbatim from the PR editing lock (handles the
# "Administrator" literal + the Nirmaan Users fallback). DO NOT reimplement.
from nirmaan_stack.api.pr_editing_lock import _get_user_full_name

_LOCK = "BoQ Sheet Pricing Lock"

# Expiry: STALE when (now - last_edit_at) > this. A holder save OR a client heartbeat
# (~30s) refreshes last_edit_at; a DIFFERENT user may take over a STALE lock. ~2 min so a
# crashed holder (no sendBeacon release) frees the sheet fast while an active editor's
# ~30s heartbeat keeps it alive (~4x margin). (D4 / ADR-0011)
LOCK_STALE_SECONDS = 120  # 2 minutes (heartbeat-driven)

# Stable token at the START of the reject message so the frontend (slice B) can detect a
# lock-rejection distinctly from any other save error.
_LOCK_HELD_MARKER = "BOQ_PRICING_LOCKED"

# Savepoint name for the atomic acquire insert -- a PK collision aborts only this
# savepoint (Postgres aborts the in-flight statement), so the request transaction stays
# usable for the re-read after we roll back to it.
_ACQUIRE_SAVEPOINT = "boq_pricing_lock_acquire"


def _locks_enabled() -> bool:
    """Break-glass off-switch (D13 / ADR-0011). Lock ENFORCEMENT is ON unless a server-side
    flag disables it (site_config "boq_locks_disabled": 1) -- lets an admin kill all BoQ
    lock enforcement in one place during a prod incident, no deploy. Default = enforcing."""
    return not frappe.conf.get("boq_locks_disabled")


def broadcast_lock_changed(boq: str, sheet_name: str, version, action: str, locked_by) -> None:
    """Broadcast a `boq:lock_changed` event so every open pricing screen updates live.

    COMMIT-BEFORE-PUBLISH: the CALLING endpoint must frappe.db.commit() BEFORE calling this
    (so a re-reading client sees the committed lock state). BROADCAST -- no user/doctype/
    docname targeting (like commission editing_lock): the set of other users viewing this
    sheet is unknown, so screen-scoped listeners filter on (boq, sheet_name,
    committed_version) and suppress their own events (locked_by === currentUser). sheet_name
    rides VERBATIM (#152)."""
    frappe.publish_realtime(
        event="boq:lock_changed",
        message={
            "boq": boq,
            "sheet_name": sheet_name,
            "committed_version": int(version),
            "action": action,  # "acquired" | "released" | "taken_over"
            "locked_by": locked_by,
            "locked_by_name": _get_user_full_name(locked_by) if locked_by else None,
            "timestamp": now_datetime().isoformat(),
        },
    )


def _lock_identity(boq: str, sheet_name: str, version) -> str:
    """The deterministic primary-key name for one lock identity.

    A SHA-1 hex of (boq, sheet_name VERBATIM, committed_version) joined by NUL bytes --
    so "Elec " and "Elec" (trailing space, #152) are DISTINCT identities, and arbitrary
    sheet-name characters / length never break the primary key. This is the atomic key:
    a duplicate insert on the same identity collides on the PK."""
    raw = f"{boq}\x00{sheet_name}\x00{int(version)}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _read_lock(boq: str, sheet_name: str, version) -> dict | None:
    """The current lock row for one identity, or None if no lock exists."""
    name = _lock_identity(boq, sheet_name, version)
    row = frappe.db.get_value(
        _LOCK,
        name,
        ["name", "boq", "sheet_name", "committed_version", "locked_by", "last_edit_at"],
        as_dict=True,
    )
    return row or None


def _is_stale(lock: dict | None, now) -> bool:
    """True when the lock is absent or older than LOCK_STALE_SECONDS (edit-driven)."""
    if not lock or not lock.get("last_edit_at"):
        return True
    return (now - get_datetime(lock["last_edit_at"])).total_seconds() > LOCK_STALE_SECONDS


def acquire_or_refresh(boq: str, sheet_name: str, version, user: str, now) -> str:
    """Acquire / refresh / reject / takeover -- the CORE single-editor decision.

    Returns the ACTION taken (existing save-path callers may ignore it; the realtime
    endpoints use it to decide whether to broadcast boq:lock_changed):
      "disabled"  -- break-glass off-switch engaged; enforcement skipped, nothing written.
      "acquired"  -- FREE -> we won the atomic insert and now hold the lock.
      "refreshed" -- MINE -> last_edit_at bumped (idempotent keep-alive / heartbeat).
      "took_over" -- OTHER + STALE -> we reclaimed a stale lock.
    OTHER + FRESH throws (marker + holder name) and WRITES NOTHING.

    Four branches (writes go through the CALLER's transaction; the caller owns the commit):
      1. FREE (no lock row)  -> INSERT (atomic; a concurrent first-edit collides on the
                                deterministic PK -> caught, re-read, fall through).
      2. MINE                -> refresh last_edit_at = now.
      3. OTHER, NOT stale     -> REJECT (frappe.throw). No write.
      4. OTHER, STALE         -> TAKEOVER (locked_by = user, last_edit_at = now)."""
    # Break-glass: skip ALL enforcement when disabled server-side (D13). Nothing is
    # written, so the caller's save proceeds unguarded (pre-lock last-write-wins fallback).
    if not _locks_enabled():
        return "disabled"

    name = _lock_identity(boq, sheet_name, version)
    lock = _read_lock(boq, sheet_name, version)

    # -- Branch 1: FREE -> attempt the atomic insert -----------------------------------
    if lock is None:
        try:
            frappe.db.savepoint(_ACQUIRE_SAVEPOINT)
            doc = frappe.new_doc(_LOCK)
            doc.boq = boq
            doc.sheet_name = sheet_name  # VERBATIM (#152)
            doc.committed_version = int(version)
            doc.locked_by = user
            doc.last_edit_at = now
            doc.insert(ignore_permissions=True)
            return "acquired"  # we won the insert -> we are the holder
        except frappe.exceptions.DuplicateEntryError:
            # A concurrent first-edit beat us to this PK. Roll back ONLY the failed
            # insert (keeps the request transaction usable), then re-read the winner and
            # fall through to the lock-exists branches below.
            frappe.db.rollback(save_point=_ACQUIRE_SAVEPOINT)
            lock = _read_lock(boq, sheet_name, version)
            if lock is None:
                # The colliding row vanished between insert and re-read -- genuinely
                # unexpected; surface it rather than silently swallow.
                raise

    # -- Branch 2: MINE -> refresh expiry ----------------------------------------------
    if lock["locked_by"] == user:
        frappe.db.set_value(_LOCK, name, "last_edit_at", now, update_modified=False)
        return "refreshed"

    # -- Branch 4: OTHER + STALE -> takeover -------------------------------------------
    if _is_stale(lock, now):
        frappe.db.set_value(
            _LOCK, name, {"locked_by": user, "last_edit_at": now}, update_modified=False
        )
        return "took_over"

    # -- Branch 3: OTHER + FRESH -> reject (writes nothing) ----------------------------
    holder_name = _get_user_full_name(lock["locked_by"])
    frappe.throw(
        f"{_LOCK_HELD_MARKER}: This sheet is being priced by {holder_name}. "
        f"Your change was not saved. Reload once they finish to continue.",
        title="Sheet locked",
    )


def release(boq: str, sheet_name: str, version, user: str, is_admin: bool = False) -> str | None:
    """Release the single-editor lock (A2 / ADR-0011). Returns:
      "released"          -- the holder released their own lock,
      "released_by_admin" -- an admin force-released another user's lock (D5),
      None                -- no lock, or held by another non-admin (no-op).
    Idempotent + tolerant (safe for a sendBeacon on tab close): deletes the lock row so
    the identity is free again. Enforcement-gated: a no-op when the break-glass is off."""
    if not _locks_enabled():
        return None
    lock = _read_lock(boq, sheet_name, version)
    if lock is None:
        return None
    if lock["locked_by"] == user:
        frappe.db.delete(_LOCK, {"name": _lock_identity(boq, sheet_name, version)})
        return "released"
    if is_admin:
        frappe.db.delete(_LOCK, {"name": _lock_identity(boq, sheet_name, version)})
        return "released_by_admin"
    return None


def read_lock_info(boq: str, sheet_name: str, version, user: str, now) -> dict | None:
    """The structured lock_info for get_priced_rows -- PURE READ (never acquires/mutates).

    Returns None when the sheet+version is FREE (no lock row), else:
      {locked_by_user, locked_by_name, is_locked_by_me, last_edit_at (iso), is_stale}."""
    lock = _read_lock(boq, sheet_name, version)
    if lock is None:
        return None
    last_edit = lock.get("last_edit_at")
    return {
        "locked_by_user": lock["locked_by"],
        "locked_by_name": _get_user_full_name(lock["locked_by"]),
        "is_locked_by_me": lock["locked_by"] == user,
        "last_edit_at": last_edit.isoformat() if hasattr(last_edit, "isoformat") else (last_edit or None),
        "is_stale": _is_stale(lock, now),
    }
