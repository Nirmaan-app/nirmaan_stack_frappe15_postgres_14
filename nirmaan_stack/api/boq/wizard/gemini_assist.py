# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Gemini BoQ AI-pass endpoint + worker + accept/reject/revert (DUAL-AI, ADR-0003).

This is the GEMINI HALF of the dual-provider BoQ AI assist. It is a faithful CLONE
of Nitesh's Claude machinery (api/boq/wizard/ai_assist.py) with the ai_* namespace
swapped for gemini_*, wired to the Gemini service (services/boq_gemini_assist.py).

Nitesh's files are NEVER edited -- this module IMPORTS the reusable Claude helper
(_row_has_children) and the shared review_screen guards + chokepoint, and provides
its own gemini_* surface alongside them.

Public API (whitelisted endpoints):
  run_gemini_pass(boq_name, sheet_name, mode="resume") -> dict
  get_gemini_pass_status(boq_name, sheet_name)         -> dict
  accept_gemini_suggestion(boq_name, sheet_name, row_index,
                           accept_classification=False, accept_parent=False) -> dict
  reject_gemini_suggestion(boq_name, sheet_name, row_index) -> dict
  revert_gemini_acceptance(boq_name, sheet_name, row_index) -> dict

Internal:
  _run_gemini_pass_worker(boq_name, sheet_name, user)   background worker
  _apply_gemini_suggestions(...)                        set_value scalar-bypass write-back
  _publish_gemini_event(...)                            boq:gemini_pass_done choke-point

KEY DUAL-AI INVARIANTS (ADR-0003 secs 4, 5, 7; REVISED by ADR-0006):
  - EXACTLY ONE accepted Source per row, enforced by BLOCK-THEN-REVERT (ADR-0006). An AI
    apply is allowed ONLY on a row at the parser baseline; accept_gemini_suggestion THROWS
    a ValidationError on any standing override (a Claude acceptance OR a manual edit) -- the
    user must Revert to parser first (the unified review_screen.revert_to_parser). The prior
    cross-provider PRE-REVERT (silently folding a standing Claude acceptance into the gemini
    accept) is RETIRED, along with the revert asymmetry: every accept is now captured against
    a clean parser baseline, so every revert lands on parser.
  - DISPLAY SIX, ACCEPT FOUR. Gemini may SUGGEST all 6 parser classes, but accepting a
    classification is restricted to the 4 assignable classes (line_item/preamble/note/
    spacer). subtotal_marker / header_repeat are detection-only and rejected on accept.
  - RE-RUN MIRRORS NITESH. A re-run stale-clears every row carrying a gemini status;
    human_* is sticky; a row whose chosen_source was "gemini" demotes to "manual".
"""
from __future__ import annotations

import json
from typing import Any

import frappe

# Gemini settings + secret (Document AI Settings home; perm-bypassing readers).
from nirmaan_stack.services.extraction.files import (
    get_boq_classifier_settings,
    get_gemini_api_key,
)
# Shared review-screen guards + the write chokepoint (sets chosen_source from reason).
from nirmaan_stack.api.boq.wizard.review_screen import (
    _SHEET_FINALIZED,
    _apply_and_save_row_edit,
    _get_sheet_wizard_status,
    _guard_row_at_parser_baseline,
    _guard_sheet_not_frozen,
    resolve_effective,
)
# Reused Claude endpoint helpers -- IMPORTED, never edited (ADR-0003 sec 8):
#   _row_has_children -- effective-parent child detection (provider-agnostic).
# (R3a / ADR-0006: revert_ai_acceptance is no longer imported here -- the cross-provider
# pre-revert is retired; an apply onto a standing Claude acceptance is BLOCKED, not folded.)
from nirmaan_stack.api.boq.wizard.ai_assist import (
    _coerce_bool,
    _row_has_children,
)
from nirmaan_stack.api.boq.wizard.update_sheet_draft import _guard_sheet_not_parsing
from nirmaan_stack.services import boq_gemini_assist
from nirmaan_stack.services.boq_gemini_assist import _NonRetryable

logger = frappe.logger("boq_gemini")

_REVIEW_ROW = "BoQ Review Row"
_SHEET_DRAFT = "BoQ Sheet Draft"

# Per-sheet status fallback (Redis). NB: unlike Claude there is NO result cache here
# (a re-run is cheap to re-enqueue and the dual-AI spec does not ask for one) -- only
# the missed-socket status fallback, mirroring _AI_STATUS_PREFIX.
_GEMINI_STATUS_PREFIX = "boq_gemini_status"
_GEMINI_STATUS_TTL_SEC = 3600  # 1 hour -- ample for a client to poll the fallback

# Defaults that mean "no Gemini suggestion" on a BoQ Review Row (mirrors _AI_DEFAULTS;
# gemini_suggested_parent / _level use the -1 sentinel, status/suggestion None/0).
_GEMINI_DEFAULTS: dict[str, Any] = {
    "gemini_suggested_classification": None,
    "gemini_classification_confidence": None,
    "gemini_suggested_parent": -1,
    "gemini_suggested_is_root": 0,
    "gemini_parent_confidence": None,
    # -1 sentinel (NOT None): gemini_suggested_level is a Frappe Int -> a NOT NULL DEFAULT 0
    # column, so a None write on the stale-clear violates the constraint. Mirrors _AI_DEFAULTS.
    "gemini_suggested_level": -1,
    "gemini_explanation": None,
    "gemini_suggestion_status": None,
}

# Field list the worker fetches for the service payload (build_row_payload reads these)
# PLUS the gemini status field the stale-clear + chosen_source-demotion logic needs.
_GEMINI_FETCH_FIELDS = [
    "name", "row_index", "source_row_number", "description", "sl_no_value", "unit",
    "qty_total", "rate_supply", "rate_install", "rate_combined",
    "amount_total", "amount_supply", "amount_install",
    "preamble_candidate_score", "is_rate_only", "is_synthetic",
    "gemini_suggestion_status", "chosen_source",
]

# The 4 assignable classes (DISPLAY SIX, ACCEPT FOUR). A Gemini classification accept is
# rejected when the suggested class is outside this set (subtotal_marker / header_repeat).
# Mirrors review_screen._ASSIGNABLE_CLASSIFICATIONS (re-stated to avoid importing a private
# constant; identical content -- the commit pipeline's priceable/grid-only gates depend on it).
_ACCEPTABLE_CLASSES = frozenset({"line_item", "preamble", "note", "spacer"})


# ---------------------------------------------------------------------------
# Status keys + sheet-draft helpers (mirror ai_assist)
# ---------------------------------------------------------------------------

def _gemini_status_key(boq_name: str, sheet_name: str) -> str:
    """Missed-socket status fallback key (per sheet -- the pass is per-sheet)."""
    return f"{_GEMINI_STATUS_PREFIX}::{boq_name}::{sheet_name}"


def _draft_name(boq_name: str, sheet_name: str):
    """Resolve the BoQ Sheet Draft child name (sheet_name VERBATIM #152)."""
    return frappe.db.get_value(
        _SHEET_DRAFT,
        {"parent": boq_name, "parenttype": "BOQs", "sheet_name": sheet_name},
        "name",
    )


def _set_gemini_in_progress(boq_name: str, sheet_name: str, value: int) -> None:
    """Set gemini_in_progress on the matching sheet draft. No commit. Missing row skipped."""
    child = _draft_name(boq_name, sheet_name)
    if child:
        frappe.db.set_value(_SHEET_DRAFT, child, "gemini_in_progress", value)


def _get_gemini_in_progress(boq_name: str, sheet_name: str) -> int:
    child = _draft_name(boq_name, sheet_name)
    if not child:
        return 0
    return int(frappe.db.get_value(_SHEET_DRAFT, child, "gemini_in_progress") or 0)


def _get_parse_in_progress(boq_name: str, sheet_name: str) -> int:
    """Non-throwing read of parse_in_progress (the {ok:False} pre-flight idiom)."""
    child = _draft_name(boq_name, sheet_name)
    if not child:
        return 0
    return int(frappe.db.get_value(_SHEET_DRAFT, child, "parse_in_progress") or 0)


# ---------------------------------------------------------------------------
# Row fetch
# ---------------------------------------------------------------------------

def _fetch_review_rows_for_gemini(boq_name: str, sheet_name: str) -> list[dict]:
    """Fetch this sheet's review rows (explicit gemini_* field list). Unlike the Claude
    fetch, the Gemini service reads ONLY raw facts (build_row_payload) and never the
    parser's verdict, so resolve_effective is NOT merged in here -- the payload builder
    must see the FACTS, not effective_*."""
    return frappe.db.get_all(
        _REVIEW_ROW,
        filters={"boq": boq_name, "sheet_name": sheet_name},
        fields=_GEMINI_FETCH_FIELDS,
        order_by="row_index asc",
    )


# ---------------------------------------------------------------------------
# Write-back (set_value scalar bypass -- no doc.save, no edit_log side-effects)
# ---------------------------------------------------------------------------

def _apply_gemini_suggestions(
    boq_name: str, sheet_name: str, rows: list[dict], suggestions: list[dict]
) -> int:
    """Write the Gemini suggestions onto the matching BoQ Review Rows.

    Mirrors _apply_ai_suggestions: stale-clears any prior gemini suggestion on this sheet
    FIRST (a re-run must not leave orphaned Pending gemini suggestions), then applies the
    new ones via frappe.db.set_value (scalar bypass). The pass no longer outputs a level:
    gemini_suggested_level is stored as the -1 "no suggestion" sentinel (commit derives the
    real level via derive_effective_levels, ADR-0009).

    RE-RUN DEMOTION (ADR-0003 sec 7): a row whose chosen_source was "gemini" but which is
    being stale-cleared (its live gemini suggestion is wiped) demotes chosen_source to
    "manual" -- the accepted human_* decision stands but is no longer backed by a live
    Gemini suggestion. human_* is NOT touched (sticky).

    Returns the count of rows written. Caller commits.
    """
    name_by_index: dict = {}
    for r in rows:
        ridx = r.get("row_index")
        if ridx is None:
            continue
        name_by_index[ridx] = r.get("name")

    # Stale-clear: reset gemini_* to defaults on every row that currently carries a gemini
    # suggestion status. Demote chosen_source "gemini" -> "manual" on those rows.
    for r in rows:
        if r.get("gemini_suggestion_status") and r.get("name"):
            clear_payload = dict(_GEMINI_DEFAULTS)
            if r.get("chosen_source") == "gemini":
                clear_payload["chosen_source"] = "manual"
            frappe.db.set_value(_REVIEW_ROW, r["name"], clear_payload)

    written = 0
    for s in suggestions:
        row_index = s.get("id")
        name = name_by_index.get(row_index)
        if not name:
            logger.warning(
                "boq_gemini: suggestion for row_index %r has no matching row on sheet %r; skipping",
                row_index, sheet_name,
            )
            continue
        frappe.db.set_value(_REVIEW_ROW, name, {
            "gemini_suggested_classification": s.get("gemini_suggested_classification"),
            "gemini_classification_confidence": s.get("gemini_classification_confidence"),
            "gemini_suggested_parent": s.get("gemini_suggested_parent"),
            "gemini_suggested_is_root": s.get("gemini_suggested_is_root"),
            "gemini_parent_confidence": s.get("gemini_parent_confidence"),
            # The Gemini pass no longer outputs a level -- the real level is derived at
            # commit (derive_effective_levels, ADR-0009). Store the -1 "no suggestion"
            # sentinel (the Int column is NOT NULL).
            "gemini_suggested_level": -1,
            "gemini_explanation": s.get("gemini_explanation") or "",
            "gemini_suggestion_status": "Pending",
        })
        written += 1

    return written


# ---------------------------------------------------------------------------
# The run-pass endpoint
# ---------------------------------------------------------------------------

@frappe.whitelist()
def run_gemini_pass(boq_name: str = None, sheet_name: str = None, mode: str = "resume") -> dict:
    """Run the Gemini structure-suggestion pass for one sheet. Mirrors run_ai_pass.

    Guards (return without enqueuing):
      {"ok": False, "error": "not_parsed"}     -- the sheet has no review rows yet.
      {"ok": False, "error": "gemini_disabled"}-- Document AI Settings.boq_ai_enabled is off.
      {"ok": False, "error": "frozen"}         -- the sheet is "Finalized" (read-only).
      {"ok": False, "error": "parsing"}        -- a parse is rebuilding this sheet's rows.
      {"ok": False, "error": "in_progress"}    -- a gemini pass is already running (unless start_over).

    Otherwise enqueues the worker (queue="long"), sets gemini_in_progress=1 AFTER a
    successful enqueue (own commit), returns {"ok": True, "enqueued": True}.

    mode: "resume" (default) | "start_over". start_over bypasses the in-progress guard
    (used to recover a wedged flag); both run a full fresh pass (the worker stale-clears).

    URL: /api/method/nirmaan_stack.api.boq.wizard.gemini_assist.run_gemini_pass
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

    # Enable gate (Document AI Settings, perm-bypassing, fails closed to False).
    if not get_boq_classifier_settings().get("boq_ai_enabled"):
        return {"ok": False, "error": "gemini_disabled"}

    # FREEZE GUARD: a "Finalized" sheet is read-only. BEFORE any apply (the worker's
    # stale-clear would mutate a frozen sheet). {ok:False} pre-flight idiom (not the
    # throwing _guard_sheet_not_frozen) -- read the status directly.
    if _get_sheet_wizard_status(boq_name, sheet_name) == _SHEET_FINALIZED:
        return {"ok": False, "error": "frozen"}
    # PARSING GUARD: don't start a Gemini pass while the parse worker is rebuilding rows.
    if _get_parse_in_progress(boq_name, sheet_name):
        return {"ok": False, "error": "parsing"}

    start_over = (mode or "resume").strip().lower() == "start_over"
    if not start_over and _get_gemini_in_progress(boq_name, sheet_name):
        return {"ok": False, "error": "in_progress"}

    # Enqueue a fresh pass. Raw (un-namespaced) job id, mirroring run_ai_pass / run_parse.
    raw_job_id = frappe.generate_hash(length=32)
    job = frappe.enqueue(
        "nirmaan_stack.api.boq.wizard.gemini_assist._run_gemini_pass_worker",
        queue="long",
        timeout=600,
        job_id=raw_job_id,
        user=frappe.session.user,
        boq_name=boq_name,
        sheet_name=sheet_name,
    )

    # SET only after a successful enqueue so a failed enqueue doesn't leave state stuck.
    _set_gemini_in_progress(boq_name, sheet_name, 1)
    frappe.db.commit()

    # Invalidate any PRIOR run's terminal status payload (the Redis missed-socket fallback set
    # by _publish_gemini_event) so the frontend's Layer-2 poll resolves THIS pass, not the last
    # one's outcome. Without this, re-running after a failure re-shows the old error banner: the
    # poll reads get_gemini_pass_status -> stale cached {status:"error"} while the new run is
    # still in flight. Best-effort (Redis, outside the DB txn) -- must never fail the enqueue.
    try:
        frappe.cache().delete_value(_gemini_status_key(boq_name, sheet_name))
    except Exception:
        pass

    return {"ok": True, "enqueued": True, "job_id": job.id if job else None}


@frappe.whitelist()
def get_gemini_pass_status(boq_name: str = None, sheet_name: str = None) -> dict:
    """Missed-socket recovery: the terminal Gemini-pass outcome for a sheet, if recorded.

    Mirrors get_ai_pass_status. _publish_gemini_event records its outcome in the Redis
    fallback keyed by (boq, sheet); this returns it, else the idle shape with the live
    gemini_in_progress flag.

    URL: /api/method/nirmaan_stack.api.boq.wizard.gemini_assist.get_gemini_pass_status
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")

    cached = frappe.cache().get_value(_gemini_status_key(boq_name, sheet_name))
    if cached:
        return cached
    return {
        "status": "idle_or_unknown",
        "gemini_in_progress": _get_gemini_in_progress(boq_name, sheet_name),
    }


# ---------------------------------------------------------------------------
# Accept / reject / revert (clone the ai_assist shapes, swap ai_ -> gemini_)
# ---------------------------------------------------------------------------

@frappe.whitelist(methods=["POST"])
def accept_gemini_suggestion(
    boq_name: str = None,
    sheet_name: str = None,
    row_index=None,
    accept_classification=False,
    accept_parent=False,
) -> dict:
    """Accept a Gemini suggestion (NON-MODAL scope: classification and/or a CHILDLESS-row
    parent). CLONE of accept_ai_suggestion with the gemini_* namespace, PLUS the dual-AI
    ACCEPT-FOUR rule (classification accept restricted to the 4 assignable classes) and the
    R3a / ADR-0006 BLOCK guard (throws on any standing override -- the user reverts to parser
    first via review_screen.revert_to_parser; the prior cross-provider pre-revert is retired).

    Writes the HUMAN layer to the gemini values (via the shared _apply_and_save_row_edit
    chokepoint -- which ALSO sets chosen_source="gemini" from the reason string) AND flips
    gemini_suggestion_status="Accepted" + persists gemini_accept_snapshot LAST, in one commit.

    SCOPE GUARD: a parent OR classification change on a row WITH children routes to the
    RestructureModal -> save_review_restructure(mark_gemini_accepted=True). Childless only here.

    Returns {ok, row_index, gemini_suggestion_status, edited_at, effective_classification,
    effective_parent_index}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.gemini_assist.accept_gemini_suggestion
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

    # An accept WRITES the human layer -> respect the same read-only backstops.
    _guard_sheet_not_frozen(boq_name, sheet_name)
    _guard_sheet_not_parsing(boq_name, sheet_name)

    try:
        row_index = int(row_index)
    except (ValueError, TypeError):
        frappe.throw("row_index must be an integer.", title="Invalid row_index")

    # R3a / ADR-0006 block-then-revert: an AI apply is allowed ONLY on a row at the parser
    # baseline. If the row carries a standing override (a Claude acceptance, an existing
    # Gemini acceptance, OR a manual human edit), BLOCK -- the user must Revert to parser
    # first. This REPLACES the prior cross-provider pre-revert (which silently folded a
    # standing Claude acceptance into this gemini accept).
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

    # SCOPE GUARD: a parent accept on a row WITH children is the modal path.
    if accept_parent and _row_has_children(boq_name, sheet_name, row_index):
        frappe.throw(
            "This row has children; accepting a parent change for it must go through "
            "the restructure step. Use 'Change parent' instead.",
            title="Restructure required",
        )
    # SCOPE GUARD: a classification accept on a row WITH children is ALSO the modal path
    # (its children need re-disposition). Mirrors the Claude rule.
    if accept_classification and _row_has_children(boq_name, sheet_name, row_index):
        frappe.throw(
            "This row has children; accepting a classification change for it must go "
            "through the restructure step so its children can be re-placed.",
            title="Restructure required",
        )

    # ACCEPT-FOUR (DISPLAY SIX, ACCEPT FOUR -- ADR-0003 sec 5): a Gemini classification
    # accept is allowed ONLY for the 4 assignable classes. subtotal_marker / header_repeat
    # are detection-only display classes and can never be promoted into the human layer.
    if accept_classification:
        g_cls = doc.gemini_suggested_classification
        if g_cls and g_cls not in _ACCEPTABLE_CLASSES:
            frappe.throw(
                "Gemini suggests a detection-only class "
                f"({g_cls}) which cannot be accepted.",
                title="Cannot accept this class",
            )

    # R3a / ADR-0006: NO cross-provider pre-revert. The block guard above already rejected
    # any standing override (incl. a standing Claude acceptance), so this row is at the parser
    # baseline -- the snapshot captured below is the TRUE baseline by construction.
    # Snapshot the row's pre-accept human layer. Childless path -> children=[]. Captured
    # BEFORE the helper writes; persisted LAST.
    accept_snapshot = {
        "row": {
            "hc": doc.human_classification or None,
            "hp": doc.human_parent,
            "hr": 1 if doc.human_is_root else 0,
        },
        "children": [],
    }

    # Capture-then-flip: write the human layer with the gemini layer dormant (its status is
    # not yet "Accepted"), so each helper captures the TRUE pre-accept effective from-value.
    edited_at = None
    if accept_classification:
        g_cls = doc.gemini_suggested_classification
        if not g_cls:
            frappe.throw(
                "This row has no Gemini classification suggestion to accept.",
                title="Nothing to accept",
            )
        _apply_and_save_row_edit(
            doc, boq_name, sheet_name, "human_classification", g_cls,
            reason="Gemini classification suggestion accepted",
        )
        edited_at = doc.edited_at

    if accept_parent:
        if int(doc.gemini_suggested_is_root or 0) == 1:
            # Root suggestion -> human-root override (set_root: human_is_root=1, parent=-1).
            _apply_and_save_row_edit(
                doc, boq_name, sheet_name, "human_parent", None,
                reason="Gemini parent suggestion accepted (root)", set_root=True,
            )
        else:
            g_parent = doc.gemini_suggested_parent
            if g_parent is None or int(g_parent) < 0:
                frappe.throw(
                    "This row has no Gemini parent suggestion to accept.",
                    title="Nothing to accept",
                )
            g_parent = int(g_parent)
            if g_parent == row_index:
                frappe.throw("A row cannot be its own parent.", title="Self-parent rejected")
            if not frappe.db.exists(
                _REVIEW_ROW,
                {"boq": boq_name, "sheet_name": sheet_name, "row_index": g_parent},
            ):
                frappe.throw(
                    f"Suggested parent row_index {g_parent} does not exist in sheet "
                    f"'{sheet_name}'.",
                    title="Invalid parent",
                )
            _apply_and_save_row_edit(
                doc, boq_name, sheet_name, "human_parent", g_parent,
                reason="Gemini parent suggestion accepted",
            )
        edited_at = doc.edited_at

    # Capture-then-flip: flip gemini_suggestion_status LAST (after every helper captured its
    # from-value with the gemini layer dormant). set_value runs IN this request transaction,
    # so the commit below makes the human_* writes + this flip ATOMIC.
    doc.gemini_suggestion_status = "Accepted"
    frappe.db.set_value(
        _REVIEW_ROW, doc.name, "gemini_suggestion_status", "Accepted", update_modified=False
    )
    # Persist the revert snapshot LAST (after the helper writes, whose chokepoint cleared it
    # on each human edit). Childless path -> no child back-pointers to stamp.
    frappe.db.set_value(
        _REVIEW_ROW, doc.name, "gemini_accept_snapshot", json.dumps(accept_snapshot),
        update_modified=False,
    )

    frappe.db.commit()

    eff = resolve_effective(doc)
    return {
        "ok": True,
        "row_index": row_index,
        "gemini_suggestion_status": doc.gemini_suggestion_status,
        "edited_at": edited_at,
        "effective_classification": eff["effective_classification"],
        "effective_parent_index": eff["effective_parent_index"],
    }


@frappe.whitelist(methods=["POST"])
def reject_gemini_suggestion(
    boq_name: str = None, sheet_name: str = None, row_index=None
) -> dict:
    """Reject a Gemini suggestion: set gemini_suggestion_status="Rejected" ONLY.

    CLONE of reject_ai_suggestion. A reject is NOT a data edit -- it does NOT touch
    human_*, does NOT stamp edited_at/edit_log, does NOT change chosen_source. Uses
    frappe.db.set_value so no doc.save side-effects fire. The suggested values are LEFT
    in the gemini_* fields (only the status changes). sheet_name VERBATIM (#152).

    Returns {ok, row_index, gemini_suggestion_status}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.gemini_assist.reject_gemini_suggestion
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

    frappe.db.set_value(_REVIEW_ROW, row_name, "gemini_suggestion_status", "Rejected")
    frappe.db.commit()

    return {"ok": True, "row_index": row_index, "gemini_suggestion_status": "Rejected"}


# ---------------------------------------------------------------------------
# Revert a Gemini acceptance (clone revert_ai_acceptance, swap ai_ -> gemini_)
# ---------------------------------------------------------------------------

def _restore_parent_if_changed_gemini(doc, boq_name, sheet_name, pre, reason) -> None:
    """Restore human_parent/human_is_root on `doc` to the snapshot (`pre`) values, ONLY when
    they differ from the current stored values. Uses the shared chokepoint (which sets
    chosen_source to baseline from the "reverted" reason). Mirror of ai_assist's helper."""
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


def _restore_row_human_layer_gemini(doc, boq_name, sheet_name, row_pre, reason) -> None:
    """Restore the accepted ROW's human_classification (when changed) + parent (when changed)."""
    snap_hc = row_pre.get("hc")  # None -> clears back to the parser classification
    cur_hc = doc.human_classification or None
    if cur_hc != snap_hc:
        _apply_and_save_row_edit(
            doc, boq_name, sheet_name, "human_classification", snap_hc, reason=reason,
        )
    _restore_parent_if_changed_gemini(doc, boq_name, sheet_name, row_pre, reason)


@frappe.whitelist(methods=["POST"])
def revert_gemini_acceptance(
    boq_name: str = None, sheet_name: str = None, row_index=None
) -> dict:
    """Revert a prior Gemini acceptance: restore the row (and any children the accept moved)
    to their captured pre-accept BASELINE state, RE-OFFER the suggestion
    (gemini_suggestion_status -> Pending), and clear the gemini snapshot.

    CLONE of revert_ai_acceptance using gemini_accept_snapshot / gemini_snapshot_owner. The
    restore writes go through the chokepoint with reason "Gemini acceptance reverted", so
    chosen_source resolves to baseline ("manual" if a human override remains, else "parser").
    Capture-then-flip IN REVERSE: the human-layer restores run while gemini_suggestion_status
    is still "Accepted"; THEN the status flips to "Pending" and the snapshot is cleared, in
    one commit. Guards _not_frozen + _not_parsing. sheet_name VERBATIM (#152).

    Returns {ok, row_index, gemini_suggestion_status: "Pending", reverted_children: [...]}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.gemini_assist.revert_gemini_acceptance
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

    doc = frappe.get_doc(_REVIEW_ROW, row_name)
    raw = doc.gemini_accept_snapshot
    snapshot = raw if isinstance(raw, dict) else (json.loads(raw) if raw else None)
    if not snapshot:
        frappe.throw(
            "There is nothing to revert -- this row has no Gemini-accept snapshot.",
            title="Nothing to revert",
        )

    row_pre = snapshot.get("row") or {}
    children_pre = snapshot.get("children") or []

    # 1. Restore the accepted row's human layer (while status is still "Accepted").
    _restore_row_human_layer_gemini(
        doc, boq_name, sheet_name, row_pre, reason="Gemini acceptance reverted",
    )

    # 2. Restore each moved child's parent + clear its gemini back-pointer.
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
        _restore_parent_if_changed_gemini(
            child_doc, boq_name, sheet_name, ch,
            reason="Gemini acceptance reverted (parent restore)",
        )
        frappe.db.set_value(
            _REVIEW_ROW, child_name, "gemini_snapshot_owner", -1, update_modified=False
        )
        reverted_children.append(ci)

    # 3. Flip the status back to Pending (re-offer) and clear the snapshot. One commit.
    doc.gemini_suggestion_status = "Pending"
    frappe.db.set_value(
        _REVIEW_ROW, doc.name,
        {"gemini_suggestion_status": "Pending", "gemini_accept_snapshot": None},
        update_modified=False,
    )

    frappe.db.commit()

    return {
        "ok": True,
        "row_index": row_index,
        "gemini_suggestion_status": "Pending",
        "reverted_children": reverted_children,
    }


# ---------------------------------------------------------------------------
# The worker
# ---------------------------------------------------------------------------

def _run_gemini_pass_worker(boq_name: str, sheet_name: str, user: str = None) -> None:
    """Background worker: fetch rows -> build payloads -> Gemini service -> write-back ->
    publish. Mirrors _run_ai_pass_worker structure.

    gemini_in_progress is CLEARED inside _publish_gemini_event (the choke-point), NOT here,
    so every exit path clears it. On failure: log + rollback + publish error + RAISE.

    Event published (user-targeted): 'boq:gemini_pass_done'
      success: {status, boq_name, sheet_name, rows_done, token_total}
      error:   {status, boq_name, sheet_name, error_code}   (gemini_failed | internal)
    """
    if user:
        frappe.set_user(user)

    try:
        rows = _fetch_review_rows_for_gemini(boq_name, sheet_name)

        # Re-read settings in the worker -- it is a fresh process. The service builds its
        # own client (build_gemini_client) from these settings + the encrypted key.
        settings = get_boq_classifier_settings()
        client = boq_gemini_assist.build_gemini_client(settings)
        model = settings.get("gemini_model")

        payloads = [boq_gemini_assist.build_row_payload(dict(r)) for r in rows]
        suggestions, token_total = boq_gemini_assist.classify_sheet(
            client, model, settings, payloads
        )

        written = _apply_gemini_suggestions(boq_name, sheet_name, rows, suggestions)

        # Commit BEFORE publish (CLAUDE.md rule: commit-before-publish avoids races).
        frappe.db.commit()
        _publish_gemini_event(
            boq_name, sheet_name, "success", user=user,
            rows_done=written, token_total=token_total,
        )

    except Exception as exc:
        frappe.log_error(
            title=f"BoQ Gemini pass worker: failed for {boq_name} / {sheet_name}",
            message=frappe.get_traceback(),
        )
        try:
            frappe.db.rollback()
        except Exception:
            pass
        error_code = "gemini_failed" if isinstance(exc, _NonRetryable) else "internal"
        _publish_gemini_event(boq_name, sheet_name, "error", user=user, error_code=error_code)
        raise


# ---------------------------------------------------------------------------
# Publish (choke-point: clears gemini_in_progress + commits, on EVERY exit path)
# ---------------------------------------------------------------------------

def _publish_gemini_event(
    boq_name: str,
    sheet_name: str,
    status: str,
    user: str | None = None,
    **kwargs: Any,
) -> None:
    """Publish boq:gemini_pass_done targeted to the enqueueing user (if known).

    Every completion path funnels through here so one choke-point clears
    gemini_in_progress uniformly. The error path calls frappe.db.rollback() BEFORE this;
    the set_value + commit below starts a fresh transaction not subject to it (mirrors
    _publish_ai_event)."""
    _set_gemini_in_progress(boq_name, sheet_name, 0)
    frappe.db.commit()

    payload = {"status": status, "boq_name": boq_name, "sheet_name": sheet_name, **kwargs}

    # Missed-socket fallback (best-effort, Redis -- survives the error-path rollback,
    # must never fail the job). Keyed per sheet so get_gemini_pass_status can recover it.
    try:
        frappe.cache().set_value(
            _gemini_status_key(boq_name, sheet_name), payload,
            expires_in_sec=_GEMINI_STATUS_TTL_SEC,
        )
    except Exception:
        pass

    publish_kwargs: dict[str, Any] = {}
    if user:
        publish_kwargs["user"] = user
    frappe.publish_realtime("boq:gemini_pass_done", payload, **publish_kwargs)
