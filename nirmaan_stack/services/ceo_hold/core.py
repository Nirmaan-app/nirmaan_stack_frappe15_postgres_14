# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""
CEO Hold — the multi-source projection core (the single serialized owner).

A project's CEO Hold can be driven by independent AUTOMATIC conditions (today: a
cashflow-gap exceedance and a >4-pending-delivery count). Each automatic condition is
recorded as one row in the `CEO Hold Reason` doctype, keyed unique per (project, source).
The project's `status="CEO Hold"` + `ceo_hold_by` are DERIVED MIRRORS maintained here.

See docs/adr/0004-multi-source-ceo-hold.md and docs/ceo_hold_delivery_pending_plan.md.

Invariants:
  * A project is on CEO Hold while a MANUAL hold is active (a real-user `ceo_hold_by`)
    OR it has >= 1 active reason row. It leaves CEO Hold only when neither holds.
  * `recompute_ceo_hold` is the ONLY writer of status/ceo_hold_by for system holds. It
    takes the Projects row FOR UPDATE, so the cashflow engine and the action-item
    reconcile can never race on the slot.
  * Every write here uses `frappe.db.set_value(..., update_modified=False)` to bypass the
    manual-only `Projects.validate()` guard and the `on_update` recursion — exactly the
    pattern the cashflow engine has always used. NOTHING here commits; the caller (the
    reconcile pass, or the host save transaction) owns the commit.
  * The MANUAL hold is NOT stored here (auto-only) — it stays on the single status slot,
    nitesh-only, and is already clobber-safe (it never auto-releases).
"""

import json

import frappe
from frappe.database.database import savepoint
from frappe.exceptions import DuplicateEntryError, UniqueValidationError
from frappe.utils import flt, now_datetime

from nirmaan_stack.constants.authorized_users import CEO_HOLD_SYSTEM_USER

_REASON_DOCTYPE = "CEO Hold Reason"

# Source identifiers — must match the `source` Select options on CEO Hold Reason.
SOURCE_CASHFLOW = "cashflow"
SOURCE_DN = "dn_pending"

# Delivery-pending hold trips STRICTLY above this many POs awaiting delivery (5+).
DN_PENDING_HOLD_THRESHOLD = 4

# Status a project reverts to when the last hold lifts and Version history yields no
# prior user-set status (mirrors the cashflow engine's original fallback).
FALLBACK_REVERT_STATUS = "WIP"

# A duplicate dedup_key can surface as EITHER class depending on cache/timing — the
# in-app pre-check raises UniqueValidationError while the DB unique index raises
# DuplicateEntryError. The get-or-create savepoint must catch BOTH (same rationale as
# the action-item reconciler).
_DUP_ERRORS = (UniqueValidationError, DuplicateEntryError)


# --- reason-row CRUD (own-source only; never commits) ---------------------------- #


def _dedup_key(project, source):
    return f"{project}::{source}"


def set_reason(project, source, text):
    """Upsert the (project, source) reason row.

    On CREATE: set `reason_text` + `set_at` (the stable 'held since').
    On an EXISTING row: refresh `reason_text` in place, leave `set_at` untouched.
    Get-or-create inside a savepoint so a concurrent writer racing the unique index can
    never abort the caller (mirrors reconcile._create_or_reopen). No commit.
    """
    key = _dedup_key(project, source)

    existing = frappe.db.get_value(_REASON_DOCTYPE, {"dedup_key": key}, "name")
    if existing:
        if frappe.db.get_value(_REASON_DOCTYPE, existing, "reason_text") != text:
            frappe.db.set_value(
                _REASON_DOCTYPE, existing, {"reason_text": text}, update_modified=False
            )
        return existing

    created = None
    with savepoint(catch=_DUP_ERRORS):
        doc = frappe.new_doc(_REASON_DOCTYPE)
        doc.project = project
        doc.source = source
        doc.dedup_key = key
        doc.reason_text = text
        doc.set_at = now_datetime()
        doc.insert(ignore_permissions=True, ignore_links=True)
        created = doc.name  # reached only if the INSERT did not raise (no dup)

    if created:
        return created

    # Lost the insert race — the other writer's row exists; refresh its text in place.
    existing = frappe.db.get_value(_REASON_DOCTYPE, {"dedup_key": key}, "name")
    if existing and frappe.db.get_value(_REASON_DOCTYPE, existing, "reason_text") != text:
        frappe.db.set_value(
            _REASON_DOCTYPE, existing, {"reason_text": text}, update_modified=False
        )
    return existing


def clear_reason(project, source):
    """Delete the (project, source) reason row if present. Idempotent. No commit."""
    frappe.db.delete(_REASON_DOCTYPE, {"dedup_key": _dedup_key(project, source)})


def clear_all_reasons(project):
    """Remove EVERY system hold reason for a project. Idempotent. No commit.

    Used when a project becomes terminal/suppressed (Completed/Halted) — it must not be
    held by any automatic condition, and leaving a stale reason would let recompute
    resurrect it to CEO Hold.
    """
    frappe.db.delete(_REASON_DOCTYPE, {"project": project})


def active_sources(project):
    """Set of source strings currently holding the project."""
    rows = frappe.get_all(
        _REASON_DOCTYPE,
        filters={"project": project},
        fields=["source"],
        limit_page_length=0,
    )
    return {row["source"] for row in rows}


def active_reasons(project):
    """List of ``{source, reason_text, set_at}`` (oldest first) for display / messages."""
    return frappe.get_all(
        _REASON_DOCTYPE,
        filters={"project": project},
        fields=["source", "reason_text", "set_at"],
        order_by="set_at asc",
        limit_page_length=0,
    )


# --- reason text builders (no DB) ------------------------------------------------ #


def dn_reason_text(count):
    return (
        f"{count} purchase orders awaiting delivery "
        f"(limit {DN_PENDING_HOLD_THRESHOLD})"
    )


def cashflow_reason_text(gap, limit):
    return f"Cashflow gap ₹{flt(gap):,.0f} exceeds limit ₹{flt(limit):,.0f}"


# --- the single serialized owner ------------------------------------------------- #


def _is_user_owned(owner):
    """A real user actor (a mail-id) vs a system marker / Administrator."""
    return bool(owner) and "@" in owner


def _find_previous_status(project):
    """Most recent USER-driven non-'CEO Hold' status from Version history; else WIP.

    System writes use `set_value(update_modified=False)` which bypasses Version creation,
    so the Version table naturally holds only real-user saves — we still filter on owner
    for defence in depth. (Relocated here from the cashflow controller so this is the one
    home for revert-target resolution; the cashflow controller imports it back.)
    """
    rows = frappe.db.sql(
        """
        SELECT data, owner FROM "tabVersion"
        WHERE ref_doctype = 'Projects' AND docname = %s
        ORDER BY creation DESC
        LIMIT 50
        """,
        (project,),
    )
    for data_str, owner in rows:
        if not _is_user_owned(owner):
            continue
        try:
            d = json.loads(data_str or "{}")
        except (TypeError, ValueError):
            continue
        for change in d.get("changed") or []:
            if change and len(change) >= 3 and change[0] == "status":
                new_val = change[2]
                if new_val and new_val != "CEO Hold":
                    return new_val
    return FALLBACK_REVERT_STATUS


def recompute_ceo_hold(project):
    """Re-derive status/ceo_hold_by from the manual hold + the reason rows.

    The ONLY writer of the status mirror for system holds. Takes the Projects row
    FOR UPDATE (serialising every CEO-Hold write path), then:
      * should_hold = a manual hold is active OR >= 1 reason row exists;
      * hold  -> status='CEO Hold', ceo_hold_by = the real user (manual preserved) else
                 the system marker;
      * release (only when neither holds) -> revert status to the last user-set status,
                 clear ceo_hold_by.
    No commit (caller owns it). Re-locking a row this transaction already locked (the
    reconcile case) is a no-op.
    """
    locked = frappe.db.get_value("Projects", project, "name", for_update=True)
    if locked is None:
        return  # unknown / deleted project — tolerate a stale name

    row = frappe.db.get_value(
        "Projects", project, ["status", "ceo_hold_by"], as_dict=True
    )
    status = row.status
    ceo_hold_by = row.ceo_hold_by

    manual_active = status == "CEO Hold" and _is_user_owned(ceo_hold_by)
    has_system = bool(active_sources(project))
    should_hold = manual_active or has_system

    if should_hold:
        target_by = ceo_hold_by if manual_active else CEO_HOLD_SYSTEM_USER
        updates = {}
        if status != "CEO Hold":
            updates["status"] = "CEO Hold"
        if ceo_hold_by != target_by:
            updates["ceo_hold_by"] = target_by
        if updates:
            frappe.db.set_value("Projects", project, updates, update_modified=False)
    elif status == "CEO Hold":
        frappe.db.set_value(
            "Projects",
            project,
            {"status": _find_previous_status(project), "ceo_hold_by": None},
            update_modified=False,
        )


# --- per-source sync entry points ------------------------------------------------ #


def sync_delivery_pending(project, dn_count):
    """Add / drop the delivery-pending reason for `dn_count` POs, then recompute.

    Called from the action-item reconcile (the count comes free from its `desired` set).
    No commit — the reconcile's single trailing commit flushes this with the action-item
    rows.
    """
    if dn_count > DN_PENDING_HOLD_THRESHOLD:
        set_reason(project, SOURCE_DN, dn_reason_text(dn_count))
    else:
        clear_reason(project, SOURCE_DN)
    recompute_ceo_hold(project)
