# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""BoQ AI-pass endpoint + background worker + socket + write-back + cache (Slice AI-2c).

Wires the stateless AI-2b service (services/boq_ai_assist.run_ai_pass) into the live
flow, MIRRORING the parse flow (parse_run.run_parse / _run_parse_worker /
_publish_parse_event) exactly. BACKEND ONLY -- the frontend is AI-3.

Public API:
  run_ai_pass(boq_name, sheet_name) -> dict          [whitelisted endpoint]
  get_ai_pass_status(boq_name, sheet_name) -> dict    [whitelisted, missed-socket recovery]

Internal:
  _run_ai_pass_worker(boq_name, sheet_name, user)     background worker
  _apply_ai_suggestions(...)                          set_value scalar-bypass write-back
  _publish_ai_event(...)                              boq:ai_pass_done choke-point

DESIGN NOTES
------------
* In-flight tracking uses ONLY BoQ Sheet Draft.ai_in_progress (no ai_job_id /
  ai_enqueued_at field exists; AI-2c does NOT add one). It is set AFTER a successful
  enqueue (own commit) and CLEARED inside _publish_ai_event (the choke-point, own
  commit), so every worker exit path -- success and every error -- clears it.
* Per-sheet result cache keyed on (boq, sheet, last_parsed_at): a re-parse bumps
  last_parsed_at -> key miss -> a fresh pass. A cache HIT in the endpoint applies the
  cached suggestions synchronously (no enqueue, no API cost) -- the "second click on
  the same parse" path.
* ROOT-SUGGESTION CONTRACT GAP (see _apply_ai_suggestions): the AI-2b service returns
  ai_suggested_parent == -1 for a ROOT suggestion, but resolve_effective (AI-1) treats
  -1 as "no suggestion". There is no schema-supported way to store "suggest root" yet.
  INTERIM (this slice): store -1 + ai_suggested_level=-1 (so resolve_effective no-ops
  the parent) while preserving any classification suggestion + explanation, and warn.
  The real fix (an ai_suggested_is_root Check mirroring human_is_root, consumed by
  resolve_effective) is a follow-up slice -- it touches the doctype JSON +
  review_screen.py, both outside AI-2c's file scope.
"""
from __future__ import annotations

from typing import Any

import frappe

from nirmaan_stack.api.boq.wizard.ai_settings import (
    get_boq_ai_api_key,
    get_boq_ai_settings,
)
from nirmaan_stack.api.boq.wizard.review_screen import resolve_effective
from nirmaan_stack.services import boq_ai_assist
from nirmaan_stack.services.boq_ai_assist import _NonRetryable

logger = frappe.logger("boq_ai")

_REVIEW_ROW = "BoQ Review Row"
_SHEET_DRAFT = "BoQ Sheet Draft"

# Per-sheet AI-pass result cache + missed-socket status fallback (Redis).
_AI_CACHE_PREFIX = "boq_ai_pass"
_AI_CACHE_TTL_SEC = 6 * 3600  # 6 hours -- ample for a "second click on the same parse"
_AI_STATUS_PREFIX = "boq_ai_status"
_AI_STATUS_TTL_SEC = 3600  # 1 hour -- ample for a client to poll the fallback

# Defaults that mean "no AI suggestion" on a BoQ Review Row (mirrors the AI-1 schema
# intent: ai_suggested_parent / ai_suggested_level use the -1 sentinel, rest None/empty).
_AI_DEFAULTS: dict[str, Any] = {
    "ai_suggested_classification": None,
    "ai_classification_confidence": None,
    "ai_suggested_parent": -1,
    "ai_parent_confidence": None,
    "ai_suggested_level": -1,
    "ai_explanation": None,
    "ai_suggestion_status": None,
}

# The explicit field list the worker fetches: the structural fields the AI-2b service
# reads via build_rows_payload PLUS the human + ai_* fields resolve_effective needs.
# (get_review_rows.all_fields does NOT include the raw ai_* columns -- 1b.)
_AI_FETCH_FIELDS = [
    "name", "row_index", "source_row_number", "classification", "level",
    "parent_index", "sl_no_value", "description", "unit",
    "human_classification", "human_parent", "human_is_root",
    "ai_suggestion_status", "ai_suggested_classification", "ai_suggested_parent",
]


# ---------------------------------------------------------------------------
# Cache / status keys
# ---------------------------------------------------------------------------

def _ai_cache_key(boq_name: str, sheet_name: str, last_parsed_at: Any) -> str:
    """Result-cache key. A re-parse bumps last_parsed_at -> a fresh (missed) key."""
    return f"{_AI_CACHE_PREFIX}::{boq_name}::{sheet_name}::{last_parsed_at}"


def _ai_status_key(boq_name: str, sheet_name: str) -> str:
    """Missed-socket status fallback key (per sheet -- the AI pass is per-sheet,
    unlike the per-BoQ-job parse fallback)."""
    return f"{_AI_STATUS_PREFIX}::{boq_name}::{sheet_name}"


# ---------------------------------------------------------------------------
# Sheet-draft helpers
# ---------------------------------------------------------------------------

def _draft_name(boq_name: str, sheet_name: str):
    """Resolve the BoQ Sheet Draft child name (sheet_name VERBATIM #152)."""
    return frappe.db.get_value(
        _SHEET_DRAFT,
        {"parent": boq_name, "parenttype": "BOQs", "sheet_name": sheet_name},
        "name",
    )


def _set_ai_in_progress(boq_name: str, sheet_name: str, value: int) -> None:
    """Set ai_in_progress on the matching sheet draft. No commit. Missing row skipped."""
    child = _draft_name(boq_name, sheet_name)
    if child:
        frappe.db.set_value(_SHEET_DRAFT, child, "ai_in_progress", value)


def _get_ai_in_progress(boq_name: str, sheet_name: str) -> int:
    child = _draft_name(boq_name, sheet_name)
    if not child:
        return 0
    return int(frappe.db.get_value(_SHEET_DRAFT, child, "ai_in_progress") or 0)


def _get_last_parsed_at(boq_name: str, sheet_name: str):
    child = _draft_name(boq_name, sheet_name)
    if not child:
        return None
    return frappe.db.get_value(_SHEET_DRAFT, child, "last_parsed_at")


# ---------------------------------------------------------------------------
# Row fetch + level derivation
# ---------------------------------------------------------------------------

def _fetch_review_rows_for_ai(boq_name: str, sheet_name: str) -> list[dict]:
    """Fetch this sheet's review rows (explicit ai_* field list) and merge in the
    resolve_effective values so build_rows_payload + level derivation see effective_*."""
    raw_rows = frappe.db.get_all(
        _REVIEW_ROW,
        filters={"boq": boq_name, "sheet_name": sheet_name},
        fields=_AI_FETCH_FIELDS,
        order_by="row_index asc",
    )
    rows: list[dict] = []
    for r in raw_rows:
        d = dict(r)
        d.update(resolve_effective(d))
        rows.append(d)
    return rows


def _effective_level(idx, eff_parent_by_index: dict, cap: int = 500) -> int:
    """Level of the node at row_index `idx`, derived by walking the effective-parent
    chain to root (root = level 1). Returns -1 on a broken/cyclic/dangling chain.

    Defensive: bounded by `cap` and a visited-set so a cycle can never spin."""
    if idx is None or idx not in eff_parent_by_index:
        return -1
    seen = {idx}
    level = 1
    cur = idx
    while True:
        parent = eff_parent_by_index.get(cur)
        if parent is None:           # reached a root
            return level
        if parent in seen or parent not in eff_parent_by_index or level > cap:
            return -1                # cycle / dangling parent / runaway
        seen.add(parent)
        level += 1
        cur = parent


# ---------------------------------------------------------------------------
# Write-back (set_value scalar bypass -- no doc.save, no edit_log side-effects)
# ---------------------------------------------------------------------------

def _apply_ai_suggestions(
    boq_name: str, sheet_name: str, rows: list[dict], suggestions: list[dict]
) -> int:
    """Write the AI suggestions onto the matching BoQ Review Rows.

    Clears any STALE prior suggestions on this sheet FIRST (so a re-run never leaves
    orphaned Pending suggestions on rows the new pass didn't flag), then applies the
    new ones via frappe.db.set_value (scalar bypass -- no doc.save / edit_log).

    Returns the count of rows written. Caller commits.
    """
    name_by_index: dict = {}
    eff_parent_by_index: dict = {}
    for r in rows:
        ridx = r.get("row_index")
        if ridx is None:
            continue
        name_by_index[ridx] = r.get("name")
        eff_parent_by_index[ridx] = r.get("effective_parent_index")

    # Stale-clear: reset ai_* to defaults on every row of the sheet that currently
    # carries a suggestion status (a re-run must not leave orphaned suggestions).
    for r in rows:
        if r.get("ai_suggestion_status") and r.get("name"):
            frappe.db.set_value(_REVIEW_ROW, r["name"], dict(_AI_DEFAULTS))

    written = 0
    for s in suggestions:
        row_index = s.get("row_index")
        name = name_by_index.get(row_index)
        if not name:
            logger.warning(
                "boq_ai: suggestion for row_index %r has no matching row on sheet %r; skipping",
                row_index, sheet_name,
            )
            continue

        sug_parent = s.get("ai_suggested_parent")  # None=NO_CHANGE, -1=root, >=0=real
        if sug_parent is None:
            # NO_CHANGE: store the no-suggestion sentinel; level = the row's current level.
            stored_parent = -1
            level = _effective_level(row_index, eff_parent_by_index)
        elif sug_parent == -1:
            # ROOT suggestion -- CONTRACT GAP (see module docstring). Interim: drop the
            # parent change (store -1, no derivable applied level) but keep any
            # classification suggestion + the explanation; warn loudly.
            stored_parent = -1
            level = -1
            logger.warning(
                "boq_ai: root parent suggestion for row_index %r on sheet %r NOT applied "
                "(resolve_effective cannot represent a root suggestion; -1 means "
                "no-suggestion). Classification suggestion + explanation preserved.",
                row_index, sheet_name,
            )
        else:
            # Real parent (internal row_index). Level = parent's effective level + 1.
            stored_parent = sug_parent
            parent_level = _effective_level(sug_parent, eff_parent_by_index)
            level = (parent_level + 1) if parent_level >= 1 else -1

        frappe.db.set_value(_REVIEW_ROW, name, {
            "ai_suggested_classification": s.get("ai_suggested_classification"),
            "ai_classification_confidence": s.get("ai_classification_confidence"),
            "ai_suggested_parent": stored_parent,
            "ai_parent_confidence": s.get("ai_parent_confidence"),
            "ai_suggested_level": level,
            "ai_explanation": s.get("ai_explanation") or "",
            "ai_suggestion_status": "Pending",
        })
        written += 1

    return written


# ---------------------------------------------------------------------------
# The endpoint
# ---------------------------------------------------------------------------

@frappe.whitelist()
def run_ai_pass(boq_name: str = None, sheet_name: str = None) -> dict:
    """Run (or recover the cached result of) the AI structure-suggestion pass for one sheet.

    Guards (return without enqueuing):
      {"ok": False, "error": "not_parsed"}   -- the sheet has no review rows yet.
      {"ok": False, "error": "ai_disabled"}  -- BOQ Upload Review AI Settings.enabled is off.
      {"ok": False, "error": "no_api_key"}   -- no Anthropic key configured.

    Cache HIT (same last_parsed_at): applies the cached suggestions synchronously and
      returns {"ok": True, "cached": True, "count": N} -- NO enqueue, NO API cost.

    Otherwise enqueues the worker, sets ai_in_progress=1 AFTER a successful enqueue (own
      commit), and returns {"ok": True, "enqueued": True}.

    URL: /api/method/nirmaan_stack.api.boq.wizard.ai_assist.run_ai_pass
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    # Parsed-guard: a sheet with no review rows has not been parsed -- nothing to review.
    row_count = frappe.db.count(
        _REVIEW_ROW, {"boq": boq_name, "sheet_name": sheet_name}
    )
    if not row_count:
        return {"ok": False, "error": "not_parsed"}

    settings = get_boq_ai_settings()
    if not settings.get("enabled"):
        return {"ok": False, "error": "ai_disabled"}

    api_key = get_boq_ai_api_key()
    if not api_key:
        return {"ok": False, "error": "no_api_key"}

    # Cache check: "second click on the same parse" -> apply cached, no API cost.
    last_parsed_at = _get_last_parsed_at(boq_name, sheet_name)
    if last_parsed_at:
        cached = frappe.cache().get_value(
            _ai_cache_key(boq_name, sheet_name, last_parsed_at)
        )
        if cached is not None:
            rows = _fetch_review_rows_for_ai(boq_name, sheet_name)
            count = _apply_ai_suggestions(boq_name, sheet_name, rows, cached)
            frappe.db.commit()
            return {"ok": True, "cached": True, "count": count}

    # Cache miss -> enqueue a fresh pass. Raw (un-namespaced) job id, mirroring run_parse.
    raw_job_id = frappe.generate_hash(length=32)
    job = frappe.enqueue(
        "nirmaan_stack.api.boq.wizard.ai_assist._run_ai_pass_worker",
        queue="long",
        timeout=600,
        job_id=raw_job_id,
        user=frappe.session.user,
        boq_name=boq_name,
        sheet_name=sheet_name,
    )

    # SET only after a successful enqueue so a failed enqueue doesn't leave state stuck.
    _set_ai_in_progress(boq_name, sheet_name, 1)
    frappe.db.commit()
    return {"ok": True, "enqueued": True, "job_id": job.id if job else None}


@frappe.whitelist()
def get_ai_pass_status(boq_name: str = None, sheet_name: str = None) -> dict:
    """Missed-socket recovery: the terminal AI-pass outcome for a sheet, if recorded.

    The boq:ai_pass_done realtime event is room-targeted and not replayed -- a client
    that missed it polls this. _publish_ai_event records its outcome in the Redis
    fallback keyed by (boq, sheet); this returns it, else the idle shape with the live
    ai_in_progress flag.

    URL: /api/method/nirmaan_stack.api.boq.wizard.ai_assist.get_ai_pass_status
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")

    cached = frappe.cache().get_value(_ai_status_key(boq_name, sheet_name))
    if cached:
        return cached
    return {
        "status": "idle_or_unknown",
        "ai_in_progress": _get_ai_in_progress(boq_name, sheet_name),
    }


# ---------------------------------------------------------------------------
# The worker
# ---------------------------------------------------------------------------

def _run_ai_pass_worker(boq_name: str, sheet_name: str, user: str = None) -> None:
    """Background worker: fetch rows -> resolve_effective -> AI-2b service -> write-back
    -> cache -> publish. Mirrors _run_parse_worker structure.

    ai_in_progress is CLEARED inside _publish_ai_event (the choke-point), NOT here, so
    every exit path clears it. On failure: log + rollback + publish error + RAISE (so
    RQ marks the job failed -- matches _run_parse_worker).

    Event published (user-targeted): 'boq:ai_pass_done'
      success: {status, boq_name, sheet_name, count}
      error:   {status, boq_name, sheet_name, error_code}   (ai_failed | internal)
    """
    if user:
        frappe.set_user(user)

    try:
        rows = _fetch_review_rows_for_ai(boq_name, sheet_name)

        # Re-read settings + key in the worker -- it is a fresh process.
        settings = get_boq_ai_settings()
        api_key = get_boq_ai_api_key()

        suggestions = boq_ai_assist.run_ai_pass(sheet_name, rows, settings, api_key)

        _apply_ai_suggestions(boq_name, sheet_name, rows, suggestions)

        # Cache the RAW suggestions keyed on the current last_parsed_at.
        last_parsed_at = _get_last_parsed_at(boq_name, sheet_name)
        if last_parsed_at:
            try:
                frappe.cache().set_value(
                    _ai_cache_key(boq_name, sheet_name, last_parsed_at),
                    suggestions,
                    expires_in_sec=_AI_CACHE_TTL_SEC,
                )
            except Exception:
                pass  # caching must never fail the pass

        # Commit BEFORE publish (CLAUDE.md rule: commit-before-publish avoids races).
        frappe.db.commit()
        _publish_ai_event(
            boq_name, sheet_name, "success", user=user, count=len(suggestions)
        )

    except Exception as exc:
        frappe.log_error(
            title=f"BoQ AI pass worker: failed for {boq_name} / {sheet_name}",
            message=frappe.get_traceback(),
        )
        try:
            frappe.db.rollback()
        except Exception:
            pass
        error_code = "ai_failed" if isinstance(exc, _NonRetryable) else "internal"
        _publish_ai_event(boq_name, sheet_name, "error", user=user, error_code=error_code)
        raise


# ---------------------------------------------------------------------------
# Publish (choke-point: clears ai_in_progress + commits, on EVERY exit path)
# ---------------------------------------------------------------------------

def _publish_ai_event(
    boq_name: str,
    sheet_name: str,
    status: str,
    user: str | None = None,
    **kwargs: Any,
) -> None:
    """Publish boq:ai_pass_done targeted to the enqueueing user (if known).

    Every completion path funnels through here so one choke-point clears
    ai_in_progress uniformly. The error path calls frappe.db.rollback() BEFORE this;
    that rollback is already done, so the set_value + commit below starts a fresh
    transaction not subject to it (mirrors _publish_parse_event)."""
    _set_ai_in_progress(boq_name, sheet_name, 0)
    frappe.db.commit()

    payload = {"status": status, "boq_name": boq_name, "sheet_name": sheet_name, **kwargs}

    # Missed-socket fallback (best-effort, Redis -- survives the error-path rollback,
    # must never fail the job). Keyed per sheet so get_ai_pass_status can recover it.
    try:
        frappe.cache().set_value(
            _ai_status_key(boq_name, sheet_name), payload, expires_in_sec=_AI_STATUS_TTL_SEC
        )
    except Exception:
        pass

    publish_kwargs: dict[str, Any] = {}
    if user:
        publish_kwargs["user"] = user
    frappe.publish_realtime("boq:ai_pass_done", payload, **publish_kwargs)
