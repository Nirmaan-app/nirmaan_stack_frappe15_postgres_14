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

import json
from typing import Any

import frappe

from nirmaan_stack.api.boq.wizard.ai_settings import (
    get_boq_ai_api_key,
    get_boq_ai_settings,
)
from nirmaan_stack.api.boq.wizard.review_screen import (
    _SHEET_FINALIZED,
    _apply_and_save_row_edit,
    _get_sheet_wizard_status,
    _guard_row_at_parser_baseline,
    _guard_sheet_not_frozen,
    resolve_effective,
)
from nirmaan_stack.api.boq.wizard.update_sheet_draft import _guard_sheet_not_parsing
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
    "ai_suggested_is_root": 0,
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
    "ai_suggested_is_root",
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


def _get_parse_in_progress(boq_name: str, sheet_name: str) -> int:
    """Non-throwing read of the sheet draft's parse_in_progress flag (the {ok:False}
    pre-flight idiom run_ai_pass uses, vs the throwing _guard_sheet_not_parsing)."""
    child = _draft_name(boq_name, sheet_name)
    if not child:
        return 0
    return int(frappe.db.get_value(_SHEET_DRAFT, child, "parse_in_progress") or 0)


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

        # AI-2d: ai_suggested_is_root is the FIRST branch -- a root suggestion is now
        # fully representable. -1 on ai_suggested_parent means ONLY "no parent-index
        # suggestion"; the root signal lives in the flag. (Replaces the AI-2c interim
        # which stored -1/level=-1 and warned that root could not be applied.)
        is_root = bool(s.get("ai_suggested_is_root"))
        sug_parent = s.get("ai_suggested_parent")  # None=NO_CHANGE, >=0=real (root via flag)
        if is_root:
            # Root suggestion: row becomes top-level. Genuine root level = 1 (per
            # _effective_level, where a node with no parent is level 1).
            stored_parent = -1
            stored_is_root = 1
            level = 1
        elif sug_parent is None:
            # NO_CHANGE: store the no-suggestion sentinel; level = the row's current level.
            stored_parent = -1
            stored_is_root = 0
            level = _effective_level(row_index, eff_parent_by_index)
        else:
            # Real parent (internal row_index). Level = parent's effective level + 1.
            stored_parent = sug_parent
            stored_is_root = 0
            parent_level = _effective_level(sug_parent, eff_parent_by_index)
            level = (parent_level + 1) if parent_level >= 1 else -1

        frappe.db.set_value(_REVIEW_ROW, name, {
            "ai_suggested_classification": s.get("ai_suggested_classification"),
            "ai_classification_confidence": s.get("ai_classification_confidence"),
            "ai_suggested_parent": stored_parent,
            "ai_suggested_is_root": stored_is_root,
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
      {"ok": False, "error": "frozen"}       -- the sheet is "Finalized" (read-only); AI-3c-2d.
      {"ok": False, "error": "parsing"}      -- a parse is rebuilding this sheet's rows.

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

    # FREEZE GUARD (AI-3c-2d): a "Finalized" sheet is read-only. run_ai_pass was added later
    # and was never gated -- a fresh pass would run _apply_ai_suggestions's stale-clear and WIPE
    # the ai_suggestion_status of already-Accepted rows, a real mutation of a read-only sheet.
    # Placed BEFORE the cache check below (the cache-hit path ALSO calls _apply_ai_suggestions),
    # so neither the synchronous cache path nor the enqueue path can touch a frozen sheet.
    # run_ai_pass uses the {ok:False} pre-flight idiom (not the throwing _guard_sheet_not_frozen),
    # so we read the status directly via _get_sheet_wizard_status.
    if _get_sheet_wizard_status(boq_name, sheet_name) == _SHEET_FINALIZED:
        return {"ok": False, "error": "frozen"}
    # PARSING GUARD: don't start an AI pass while the parse worker is rebuilding these rows
    # (mirrors the _guard_sheet_not_parsing the accept/reject/revert endpoints enforce, in the
    # non-throwing {ok:False} idiom).
    if _get_parse_in_progress(boq_name, sheet_name):
        return {"ok": False, "error": "parsing"}

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

    # Invalidate any PRIOR run's terminal status payload (the Redis missed-socket fallback set
    # by _publish_ai_event) so the frontend's poll resolves THIS pass, not the last one's outcome.
    # Without this, re-running after a failure re-shows the old error banner: the poll reads
    # get_ai_pass_status -> stale cached {status:"error"} while the new run is still in flight.
    # Best-effort (Redis, outside the DB txn) -- must never fail the enqueue. (Parity with
    # run_gemini_pass; the cache-hit path above returns early and records no status payload.)
    try:
        frappe.cache().delete_value(_ai_status_key(boq_name, sheet_name))
    except Exception:
        pass

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
# Accept / reject (AI-3b-1: NON-MODAL paths -- classification + childless parent)
# ---------------------------------------------------------------------------

def _coerce_bool(v: Any) -> bool:
    """Coerce an HTTP form value ('1'/'true'/'yes') or a real bool to bool."""
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "yes")
    return bool(v)


def _row_has_children(boq_name: str, sheet_name: str, row_index: int) -> bool:
    """True iff any OTHER row in the sheet has this row as its EFFECTIVE parent.

    Mirrors ReviewTree's hasChildrenSet (effective_parent_index walk) on the backend.
    Uses resolve_effective so an already-Accepted AI parent on another row counts as a
    real child (a Pending suggestion does NOT change effective_parent_index, so it
    correctly does not). sheet_name VERBATIM (#152)."""
    sheet_rows = frappe.db.get_all(
        _REVIEW_ROW,
        filters={"boq": boq_name, "sheet_name": sheet_name},
        fields=[
            "row_index", "classification", "human_classification",
            "parent_index", "human_parent", "human_is_root",
            "ai_suggestion_status", "ai_suggested_classification",
            "ai_suggested_parent", "ai_suggested_is_root",
        ],
    )
    for r in sheet_rows:
        if int(r.row_index) == row_index:
            continue
        if resolve_effective(r).get("effective_parent_index") == row_index:
            return True
    return False


@frappe.whitelist(methods=["POST"])
def accept_ai_suggestion(
    boq_name: str = None,
    sheet_name: str = None,
    row_index=None,
    accept_classification=False,
    accept_parent=False,
) -> dict:
    """Accept an AI suggestion (NON-MODAL scope: classification and/or a CHILDLESS-row
    parent). Writes the HUMAN layer to the AI values (via the shared
    _apply_and_save_row_edit chokepoint -- the same human-write + provenance path
    save_review_edit uses) AND flips ai_suggestion_status="Accepted" in the SAME
    save/commit, so the row ends with human_* set AND status Accepted (the frontend
    then renders "AI Accepted" and the badge clears).

    SCOPE GUARD (AI-3b-1): accepting a PARENT change is allowed ONLY when the row has no
    children -- a row-with-children parent change must go through the RestructureModal
    (AI-3b-2). A childless row has no descendants, so making it a child of any row cannot
    create a cycle; that is why the cycle-guard save_review_edit runs is unnecessary here.

    accept_classification / accept_parent are booleans (HTTP "1"/"true"/"yes" coerced);
    at least one must be true. sheet_name VERBATIM (#152).

    Returns {ok, row_index, ai_suggestion_status, edited_at, effective_classification,
    effective_parent_index}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.ai_assist.accept_ai_suggestion
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if row_index is None:
        frappe.throw("row_index is required.", title="Missing field: row_index")
    accept_classification = _coerce_bool(accept_classification)
    accept_parent = _coerce_bool(accept_parent)
    if not (accept_classification or accept_parent):
        frappe.throw(
            "Nothing to accept -- enable at least one of classification or parent.",
            title="Nothing to accept",
        )
    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    # An accept WRITES the human layer -> respect the same read-only backstops as
    # save_review_edit (a Finalized sheet, or one whose parse is in flight).
    _guard_sheet_not_frozen(boq_name, sheet_name)
    _guard_sheet_not_parsing(boq_name, sheet_name)

    try:
        row_index = int(row_index)
    except (ValueError, TypeError):
        frappe.throw("row_index must be an integer.", title="Invalid row_index")

    # R3a / ADR-0006 block-then-revert: an AI apply is allowed ONLY on a row at the parser
    # baseline. If the row carries a standing override (a Gemini acceptance OR a manual
    # human edit), BLOCK -- the user must Revert to parser first. (A standing CLAUDE
    # acceptance also blocks: re-accepting an already-accepted Claude suggestion is itself a
    # no-op-or-overwrite, so the same gate applies.) This replaces the prior silent overwrite.
    _guard_row_at_parser_baseline(boq_name, sheet_name, row_index)

    row_name = frappe.db.get_value(
        _REVIEW_ROW,
        {"boq": boq_name, "sheet_name": sheet_name, "row_index": row_index},
        "name",
    )
    if not row_name:
        frappe.throw(
            f"Row with row_index={row_index} not found in sheet '{sheet_name}'.",
            title="Row not found",
        )

    doc = frappe.get_doc(_REVIEW_ROW, row_name)

    # SCOPE GUARD: a parent accept on a row WITH children is the AI-3b-2 (modal) path.
    if accept_parent and _row_has_children(boq_name, sheet_name, row_index):
        frappe.throw(
            "This row has children; accepting a parent change for it must go through "
            "the restructure step (coming in a later slice). Use 'Change parent' instead.",
            title="Restructure required",
        )

    # AI-3c-3 SCOPE GUARD: a CLASSIFICATION accept on a row WITH children is ALSO the modal
    # path. Reclassifying a parent-capable row (e.g. preamble) to a non-parent class (note/
    # spacer/line_item) while it still has children would leave them under a now-non-parent
    # row -- a broken tree. (Post-S2: the shared structural check now flags an item under ANY
    # non-heading parent -- note/spacer included -- via #8 line_item_parent_not_preamble, and the
    # finalize gate hard-blocks it; the modal still re-places the children cleanly up front.) The
    # children need disposition via the
    # RestructureModal -> save_review_restructure (the frontend routes there). Mirrors the
    # manual onPickClass rule: ANY with-children reclassify goes through the modal.
    if accept_classification and _row_has_children(boq_name, sheet_name, row_index):
        frappe.throw(
            "This row has children; accepting a classification change for it must go "
            "through the restructure step so its children can be re-placed.",
            title="Restructure required",
        )

    # AI-3c-2a: snapshot the row's pre-accept human layer for a future revert. This is the
    # CHILDLESS accept path (the with-children guards above already threw), so children=[].
    # Captured BEFORE the helper writes (the true pre-accept state); persisted LAST in the
    # flip block below so the chokepoint's invalidation clears during the helper writes do
    # not wipe it (capture-last to dodge the self-clear).
    accept_snapshot = {
        "row": {
            "hc": doc.human_classification or None,
            "hp": doc.human_parent,
            "hr": 1 if doc.human_is_root else 0,
        },
        "children": [],
    }

    # AI-3c-1: the status flip is deferred to AFTER the human writes (capture-then-flip).
    # _apply_and_save_row_edit reads the edit_log from-value via resolve_effective, which
    # honors the AI layer the moment ai_suggestion_status == "Accepted". Flipping it here
    # (before the helpers) made resolve_effective return the AI value the helper was about
    # to write -> from == to -> a no-op edit_log entry. The flip now happens below, before
    # the single commit, so each helper captures the TRUE pre-accept effective from-value.
    edited_at = None
    if accept_classification:
        ai_cls = doc.ai_suggested_classification
        if not ai_cls:
            frappe.throw(
                "This row has no AI classification suggestion to accept.",
                title="Nothing to accept",
            )
        _apply_and_save_row_edit(
            doc, boq_name, sheet_name, "human_classification", ai_cls,
            reason="AI classification suggestion accepted",
        )
        edited_at = doc.edited_at

    if accept_parent:
        if int(doc.ai_suggested_is_root or 0) == 1:
            # Root suggestion -> human-root override (set_root: human_is_root=1, parent=-1).
            _apply_and_save_row_edit(
                doc, boq_name, sheet_name, "human_parent", None,
                reason="AI parent suggestion accepted (root)", set_root=True,
            )
        else:
            ai_parent = doc.ai_suggested_parent
            if ai_parent is None or int(ai_parent) < 0:
                frappe.throw(
                    "This row has no AI parent suggestion to accept.",
                    title="Nothing to accept",
                )
            ai_parent = int(ai_parent)
            if ai_parent == row_index:
                frappe.throw("A row cannot be its own parent.", title="Self-parent rejected")
            if not frappe.db.exists(
                _REVIEW_ROW,
                {"boq": boq_name, "sheet_name": sheet_name, "row_index": ai_parent},
            ):
                frappe.throw(
                    f"Suggested parent row_index {ai_parent} does not exist in sheet "
                    f"'{sheet_name}'.",
                    title="Invalid parent",
                )
            _apply_and_save_row_edit(
                doc, boq_name, sheet_name, "human_parent", ai_parent,
                reason="AI parent suggestion accepted",
            )
        edited_at = doc.edited_at

    # AI-3c-1 capture-then-flip: now that every helper above captured its from-value with
    # the AI layer dormant, flip the status. set_value runs IN this request transaction, so
    # the commit below makes the human_* writes (helper doc.save) + this flip ATOMIC -- no
    # second independent commit. The in-memory attr is also set so the returned
    # resolve_effective / ai_suggestion_status reflect the Accepted state.
    doc.ai_suggestion_status = "Accepted"
    frappe.db.set_value(
        _REVIEW_ROW, doc.name, "ai_suggestion_status", "Accepted", update_modified=False
    )
    # AI-3c-2a: persist the revert snapshot LAST (after the helper writes, whose chokepoint
    # cleared it on each human edit). Childless path -> no child back-pointers to stamp.
    frappe.db.set_value(
        _REVIEW_ROW, doc.name, "ai_accept_snapshot", json.dumps(accept_snapshot),
        update_modified=False,
    )

    frappe.db.commit()

    eff = resolve_effective(doc)
    return {
        "ok": True,
        "row_index": row_index,
        "ai_suggestion_status": doc.ai_suggestion_status,
        "edited_at": edited_at,
        "effective_classification": eff["effective_classification"],
        "effective_parent_index": eff["effective_parent_index"],
    }


@frappe.whitelist(methods=["POST"])
def reject_ai_suggestion(
    boq_name: str = None, sheet_name: str = None, row_index=None
) -> dict:
    """Reject an AI suggestion: set ai_suggestion_status="Rejected" ONLY.

    A reject is NOT a data edit -- it does NOT touch human_*, does NOT stamp
    edited_at/edit_log (the parser value stays effective, the row stays "Original").
    Uses frappe.db.set_value (the save_review_remark / dismiss_row_flags bypass) so no
    doc.save side-effects fire. The suggested values are LEFT in the ai_* fields (only
    the status changes), preserving the audit of "what the AI suggested"; the badge +
    tint clear because aiSuggestionInfo gates on status === "Pending". sheet_name
    VERBATIM (#152).

    Returns {ok, row_index, ai_suggestion_status}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.ai_assist.reject_ai_suggestion
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if row_index is None:
        frappe.throw("row_index is required.", title="Missing field: row_index")
    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    _guard_sheet_not_frozen(boq_name, sheet_name)
    _guard_sheet_not_parsing(boq_name, sheet_name)

    try:
        row_index = int(row_index)
    except (ValueError, TypeError):
        frappe.throw("row_index must be an integer.", title="Invalid row_index")

    row_name = frappe.db.get_value(
        _REVIEW_ROW,
        {"boq": boq_name, "sheet_name": sheet_name, "row_index": row_index},
        "name",
    )
    if not row_name:
        frappe.throw(
            f"Row with row_index={row_index} not found in sheet '{sheet_name}'.",
            title="Row not found",
        )

    frappe.db.set_value(_REVIEW_ROW, row_name, "ai_suggestion_status", "Rejected")
    frappe.db.commit()

    return {"ok": True, "row_index": row_index, "ai_suggestion_status": "Rejected"}


# ---------------------------------------------------------------------------
# Revert an AI acceptance (AI-3c-2a)
# ---------------------------------------------------------------------------

def _restore_parent_if_changed(doc, boq_name, sheet_name, pre, reason) -> None:
    """Restore human_parent/human_is_root on `doc` to the snapshot (`pre`) values, but ONLY
    when they differ from the current stored values -- so a parent-untouched axis produces no
    spurious edit_log entry. Uses the shared _apply_and_save_row_edit chokepoint (which
    expresses the root case via set_root and the -1 sentinel for "no override")."""
    snap_hp = pre.get("hp", -1)
    snap_hr = 1 if pre.get("hr") else 0
    cur_hp = doc.human_parent if doc.human_parent is not None else -1
    cur_hr = 1 if doc.human_is_root else 0
    if cur_hp == snap_hp and cur_hr == snap_hr:
        return
    if snap_hr == 1:
        _apply_and_save_row_edit(
            doc, boq_name, sheet_name, "human_parent", None, reason=reason, set_root=True,
        )
    else:
        value = snap_hp if (snap_hp is not None and snap_hp >= 0) else None
        _apply_and_save_row_edit(
            doc, boq_name, sheet_name, "human_parent", value, reason=reason,
        )


def _restore_row_human_layer(doc, boq_name, sheet_name, row_pre, reason) -> None:
    """Restore the accepted ROW's human_classification (when changed) + parent (when changed)."""
    snap_hc = row_pre.get("hc")  # None -> clears back to the parser classification
    cur_hc = doc.human_classification or None
    if cur_hc != snap_hc:
        _apply_and_save_row_edit(
            doc, boq_name, sheet_name, "human_classification", snap_hc, reason=reason,
        )
    _restore_parent_if_changed(doc, boq_name, sheet_name, row_pre, reason)


@frappe.whitelist(methods=["POST"])
def revert_ai_acceptance(
    boq_name: str = None, sheet_name: str = None, row_index=None
) -> dict:
    """Revert a prior AI acceptance: restore the row (and any children the accept moved) to
    their captured pre-accept state, RE-OFFER the suggestion (ai_suggestion_status -> Pending),
    and append honest "reverted" edit_log entries.

    Reads the ai_accept_snapshot captured on the AI-accept Save (throws "nothing to revert"
    when absent). edit_log policy (owner-locked): APPEND a "reverted" entry; the accept's
    entries are LEFT intact and edited_at is NOT rolled back (append-only history). Each
    human_* axis is restored ONLY when it actually changed, so a parent-only accept produces
    no spurious classification entry (and vice-versa).

    Capture-then-flip IN REVERSE: the human-layer restores run while ai_suggestion_status is
    still "Accepted", so the helper's edit_log from-value reads the accepted effective value;
    THEN the status flips to "Pending" and the snapshot + child back-pointers are cleared.
    set_value runs in this request transaction, so the single commit makes the restores +
    flip + clear ATOMIC. Guards _not_frozen + _not_parsing (it writes the human layer).
    sheet_name VERBATIM (#152).

    Returns {ok, row_index, ai_suggestion_status: "Pending", reverted_children: [...]}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.ai_assist.revert_ai_acceptance
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if row_index is None:
        frappe.throw("row_index is required.", title="Missing field: row_index")
    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    # A revert WRITES the human layer -> respect the same read-only backstops as the accept.
    _guard_sheet_not_frozen(boq_name, sheet_name)
    _guard_sheet_not_parsing(boq_name, sheet_name)

    try:
        row_index = int(row_index)
    except (ValueError, TypeError):
        frappe.throw("row_index must be an integer.", title="Invalid row_index")

    row_name = frappe.db.get_value(
        _REVIEW_ROW,
        {"boq": boq_name, "sheet_name": sheet_name, "row_index": row_index},
        "name",
    )
    if not row_name:
        frappe.throw(
            f"Row with row_index={row_index} not found in sheet '{sheet_name}'.",
            title="Row not found",
        )

    doc = frappe.get_doc(_REVIEW_ROW, row_name)
    raw = doc.ai_accept_snapshot
    snapshot = raw if isinstance(raw, dict) else (json.loads(raw) if raw else None)
    if not snapshot:
        frappe.throw(
            "There is nothing to revert -- this row has no AI-accept snapshot.",
            title="Nothing to revert",
        )

    row_pre = snapshot.get("row") or {}
    children_pre = snapshot.get("children") or []

    # 1. Restore the accepted row's human layer (while status is still "Accepted").
    _restore_row_human_layer(
        doc, boq_name, sheet_name, row_pre, reason="AI acceptance reverted",
    )

    # 2. Restore each moved child's parent + clear its back-pointer.
    reverted_children: list = []
    for ch in children_pre:
        ci = ch.get("idx")
        if ci is None:
            continue
        ci = int(ci)
        child_name = frappe.db.get_value(
            _REVIEW_ROW,
            {"boq": boq_name, "sheet_name": sheet_name, "row_index": ci},
            "name",
        )
        if not child_name:
            continue
        child_doc = frappe.get_doc(_REVIEW_ROW, child_name)
        _restore_parent_if_changed(
            child_doc, boq_name, sheet_name, ch,
            reason="AI acceptance reverted (parent restore)",
        )
        frappe.db.set_value(
            _REVIEW_ROW, child_name, "ai_snapshot_owner", -1, update_modified=False
        )
        reverted_children.append(ci)

    # 3. Flip the status back to Pending (re-offer) and clear the snapshot. One commit.
    doc.ai_suggestion_status = "Pending"
    frappe.db.set_value(
        _REVIEW_ROW, doc.name,
        {"ai_suggestion_status": "Pending", "ai_accept_snapshot": None},
        update_modified=False,
    )

    frappe.db.commit()

    return {
        "ok": True,
        "row_index": row_index,
        "ai_suggestion_status": "Pending",
        "reverted_children": reverted_children,
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
