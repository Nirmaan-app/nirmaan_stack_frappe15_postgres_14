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

EXPIRY is edit-driven (no heartbeat): the lock is STALE when now - last_edit_at exceeds
LOCK_STALE_SECONDS (300s = 5 min). Each successful holder save refreshes last_edit_at.
A DIFFERENT user may take over a STALE lock.

The reject (held-by-another, fresh) raises a decodable error prefixed with the stable
marker _LOCK_HELD_MARKER so the frontend (slice B) can switch on it. The reject path
WRITES NOTHING -- save_cell_price gates on this BEFORE any freeze/insert, so a rejected
save mutates no pricing state.
"""
from __future__ import annotations

import hashlib

import frappe
from frappe.utils import get_datetime, now_datetime

# Holder-name resolution reused verbatim from the PR editing lock (handles the
# "Administrator" literal + the Nirmaan Users fallback). DO NOT reimplement.
from nirmaan_stack.api.pr_editing_lock import _get_user_full_name

_LOCK = "BoQ Sheet Pricing Lock"

# Edit-driven expiry: STALE when (now - last_edit_at) > this. No heartbeat.
LOCK_STALE_SECONDS = 300  # 5 minutes

# Stable token at the START of the reject message so the frontend (slice B) can detect a
# lock-rejection distinctly from any other save error.
_LOCK_HELD_MARKER = "BOQ_PRICING_LOCKED"

# Savepoint name for the atomic acquire insert -- a PK collision aborts only this
# savepoint (Postgres aborts the in-flight statement), so the request transaction stays
# usable for the re-read after we roll back to it.
_ACQUIRE_SAVEPOINT = "boq_pricing_lock_acquire"


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


def acquire_or_refresh(boq: str, sheet_name: str, version, user: str, now) -> None:
    """Acquire / refresh / reject / takeover -- the CORE single-editor decision.

    Four branches:
      1. FREE (no lock row)        -> INSERT the lock (the atomic step). A concurrent
                                      first-edit collides on the deterministic PK; we
                                      catch DuplicateEntryError, re-read the winner, and
                                      fall through to branch 2/3/4 with that row.
      2. MINE                      -> refresh last_edit_at = now, proceed.
      3. OTHER, NOT stale          -> REJECT (frappe.throw, marker + holder name). No write.
      4. OTHER, STALE              -> TAKEOVER (locked_by = user, last_edit_at = now), proceed.

    Writes go through frappe.db within the CALLER's transaction; the caller owns the
    single commit (save_cell_price). The reject branch writes NOTHING (so a rejected save
    mutates no pricing state)."""
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
            return  # we won the insert -> we are the holder
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
        return

    # -- Branch 4: OTHER + STALE -> takeover -------------------------------------------
    if _is_stale(lock, now):
        frappe.db.set_value(
            _LOCK, name, {"locked_by": user, "last_edit_at": now}, update_modified=False
        )
        return

    # -- Branch 3: OTHER + FRESH -> reject (writes nothing) ----------------------------
    holder_name = _get_user_full_name(lock["locked_by"])
    frappe.throw(
        f"{_LOCK_HELD_MARKER}: This sheet is being priced by {holder_name}. "
        f"Your change was not saved. Reload once they finish to continue.",
        title="Sheet locked",
    )


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
