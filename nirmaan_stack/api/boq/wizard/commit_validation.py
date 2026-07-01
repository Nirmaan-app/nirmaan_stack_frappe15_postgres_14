"""
BoQ commit-validation -- the PRE-COMMIT preflight derivation + node-plan validator
(Phase 5, commit-preflight slice 1).

WHY THIS MODULE EXISTS
  Commit validation moves BEFORE the destructive DB write. Instead of committing the
  node tree and letting the BOQ Nodes controller surface soft msgprints (which the user
  never sees during an async commit, and which fire AFTER the irreversible write), we
  derive a NODE PLAN from the finalized review rows and validate it up front, so the
  frontend can preview every error + warning and the user can acknowledge them before
  anything is written. This module owns:

    * the SHARED level derivation (moved verbatim from commit_pipeline so the real
      commit and the preflight can never diverge),
    * a SHARED cls -> node_type + level derivation called by BOTH the real-commit
      builder (_build_node_pass1) and the preflight plan-builder,
    * build_sheet_node_plan  -- read finalized review rows -> a pure plan (NO frappe
      doc, NO insert, NO Excel/S3 -- node-level checks derive ENTIRELY from review rows),
    * validate_node_plan     -- the error/warning findings over a plan,
    * the SHARED relaxed-#7 preamble-parent predicate (used by BOTH this validator AND
      the BOQ Nodes controller's durable backstop), and
    * the FROZEN preflight response shape that the (phase-2) commit_preflight endpoint
      returns.

INVARIANTS (carried from the commit pipeline)
  * CAPTURE-ONLY (Slice 2.5): reviewed values are carried VERBATIM -- this module never
    recomputes amount = qty x rate and never overwrites a parent rate.
  * sheet_name is matched VERBATIM (#152) -- trailing/leading spaces exist; never strip.
  * The -1 sentinel means "no parent" for human_parent (handled inside resolve_effective).
  * General-specs sheets get only the faithful grid -- NO node tree -> the preflight gives
    them 0 errors / 0 warnings (the caller skips build for a non-finalized disposition).
  * Reads BoQ Review Rows ONLY -- no openpyxl, no S3 fetch.

FROZEN PREFLIGHT RESPONSE SHAPE (commit_preflight, phase 2 -- this module OWNS the contract)
  {"per_sheet": [
      {"sheet_name": str,
       "disposition": str,                # "finalized" | "general_specs"
       "errors":   [finding, ...],        # blocking
       "warnings": [finding, ...]},       # advisory
      ...
  ]}
  finding = {
      "kind":              "error" | "warning",
      "code":              str,           # stable machine code
      "sheet_name":        str,
      "source_row_number": int | None,    # the user-facing Excel row (None for a group)
      "description":       str | None,    # truncated ~60 chars (None for a group)
      "message":           str,           # plain-English, terminology "section heading"/"item"
      "what_to_do":        str,           # short remediation tail
      "group_key":         str,           # de-dupe / grouping key
      "count":             int,           # rows folded into this finding (1 unless grouped)
  }
"""
from __future__ import annotations

import json
from typing import Any

import frappe

from nirmaan_stack.api.boq.wizard.review_screen import (
    resolve_effective,
    _get_sheet_area_dimensions,
)

# ---------------------------------------------------------------------------
# Effective-classification constants (single source of truth; commit_pipeline
# imports these so the real commit and the preflight share one taxonomy).
# ---------------------------------------------------------------------------
_PREAMBLE_CLS = "preamble"
_LINE_ITEM_CLS = "line_item"
_SPACER_CLS = "spacer"
# Priceable classes -> Preamble / Line Item node_type. Everything else committed -> Other.
_PRICEABLE_CLASSIFICATIONS = frozenset({_PREAMBLE_CLS, _LINE_ITEM_CLS})
# Classes NOT turned into nodes (grid-only). Only spacer.
_GRID_ONLY_CLASSIFICATIONS = frozenset({_SPACER_CLS})

# The EXACT inputs resolve_effective reads in the COMMIT context: the human > parser subset
# with NO ai_* fields. CRITICAL PARITY INVARIANT -- an AI acceptance FOLDS the accepted axis
# into the human_* layer (accept_ai_suggestion), so the committed tree resolves from
# human > parser ONLY. Feeding resolve_effective the ai_* fields would re-apply an UN-accepted
# AI suggestion on a PARTIALLY-accepted row (e.g. classification accepted but parent not) and
# DIVERGE from the real commit -- producing a false or missed preflight error. The real commit
# (_REVIEW_ROW_FIELDS in commit_pipeline) spreads THIS SAME constant, so the preview and the
# write can never resolve a different effective tree. (gemini_* is not read by
# resolve_effective and also folds-to-human, so it is correctly absent here too.)
RESOLVE_EFFECTIVE_COMMIT_INPUT_FIELDS = [
    "classification", "level", "preamble_level_override", "parent_index",
    "human_classification", "human_parent", "human_is_root",
]

# BoQ Review Row fields the plan-builder reads = the SHARED resolve_effective inputs (above)
# + the identity / content / money fields carried verbatim onto the plan. NO ai_* (parity).
_PLAN_REVIEW_ROW_FIELDS = [
    "name", "row_index", "source_row_number",
    *RESOLVE_EFFECTIVE_COMMIT_INPUT_FIELDS,
    # content / money carried verbatim onto the plan
    "sl_no_value", "description", "unit", "make_model",
    "qty_total", "qty_by_area",
    "rate_supply", "rate_install", "rate_combined",
]

# ---------------------------------------------------------------------------
# Level derivation (ADR-0009: level is DERIVED from the effective tree -- single
# source of truth shared by the #7 plan validator, the committed BOQ Nodes.level,
# and the review screen's effective_level, so validation/commit/display cannot disagree).
# ---------------------------------------------------------------------------

def derive_effective_levels(node_rows) -> tuple[dict, list]:
    """Derive each node row's level from the EFFECTIVE (human-edited) tree (ADR-0009).

    `level` is NO LONGER the frozen parser-era absolute depth -- it is the nesting depth
    over the effective-parent chain, so re-parenting a preamble CASCADES the level of that
    row AND every descendant (they shift in lockstep). This is the single derivation feeding
    (a) the #7 preamble-parent check, (b) the committed BOQ Nodes.level (commit pipeline),
    and (c) the review screen's effective_level -- they can never diverge.

    node_rows: the existing list of (d, eff) pairs where eff carries
    effective_classification + effective_parent_index, and d carries row_index (the
    parent-pointer space; effective_parent_index is the PARENT row's row_index, or None).

    For EACH row, walk UP the effective_parent_index chain (hop-cap 60 + seen-set cycle
    guard, mirroring _chain_has_cycle / the frontend ParentChain walk), counting how many
    ANCESTORS are preambles:
        preamble row        -> level = 1 + (preamble-ancestor count)  (root preamble = 1,
                               +1 per nesting tier)
        any non-preamble    -> level = None  (line_item / note / subtotal_marker / ... carry
                               NO level -- the system convention is that only preambles have
                               a level; a non-preamble is level-less)

    The walk is ORDER-INDEPENDENT (it counts ancestors, never reading a pre-computed parent
    level) and identical for every call site. levels_by_idx carries an entry for EVERY node
    (None for non-preambles) so callers can look up any row's level uniformly.

    Also build consistency_warnings -- a TRIPWIRE (owner instruction: KEEP all checks): for
    a preamble whose effective parent is ITSELF a preamble, if the derived level !=
    parent_level + 1, emit a warning dict shaped like the OLD level_warnings entry
    ({row_index, source_row_number, computed_level, parent_level}) so validate_node_plan's
    existing #22 branch consumes it UNCHANGED. Under correct derivation this NEVER fires (a
    preamble child of a preamble always derives parent_level + 1); a future regression that
    produced an inconsistent level would trip it loudly.

    Returns (levels_by_idx, consistency_warnings).
    """
    eff_by_idx = {d["row_index"]: e for d, e in node_rows}

    levels_by_idx: dict = {}
    for d, e in node_rows:
        idx = d["row_index"]
        if e["effective_classification"] != _PREAMBLE_CLS:
            levels_by_idx[idx] = None  # any non-preamble is level-less (convention)
            continue
        # Count PREAMBLE ancestors up the effective-parent chain (cycle-safe).
        preamble_ancestors = 0
        seen: set = {idx}
        cur = e.get("effective_parent_index")
        hops = 0
        while cur is not None and hops < 60:
            if cur in seen:
                break  # cycle guard (mirrors _chain_has_cycle)
            seen.add(cur)
            anc = eff_by_idx.get(cur)
            if anc is None:
                break  # parent points outside the node set -> chain ends
            if anc["effective_classification"] == _PREAMBLE_CLS:
                preamble_ancestors += 1
            cur = anc.get("effective_parent_index")
            hops += 1
        levels_by_idx[idx] = 1 + preamble_ancestors

    # Consistency tripwire -- a preamble under a preamble must derive parent_level + 1.
    consistency_warnings: list = []
    for d, e in node_rows:
        if e["effective_classification"] != _PREAMBLE_CLS:
            continue
        ep = e.get("effective_parent_index")
        if ep is None:
            continue
        parent_eff = eff_by_idx.get(ep)
        if parent_eff is None or parent_eff["effective_classification"] != _PREAMBLE_CLS:
            continue  # only a preamble-under-preamble has a comparable parent level
        idx = d["row_index"]
        if levels_by_idx[idx] != levels_by_idx[ep] + 1:
            consistency_warnings.append({
                "row_index": idx,
                "source_row_number": d.get("source_row_number"),
                "computed_level": levels_by_idx[idx],
                "parent_level": levels_by_idx[ep],
            })
    return levels_by_idx, consistency_warnings


def derive_node_type_and_level(d: dict, eff: dict, levels_by_idx: dict) -> tuple[str, Any]:
    """SHARED cls -> (node_type, level) derivation. Called by BOTH the real-commit
    builder (_build_node_pass1) AND the preflight plan-builder so they cannot diverge.

      preamble  -> ("Preamble", derived level)   (>=1, the effective-tree nesting depth
                   from derive_effective_levels, ADR-0009)
      line_item -> ("Line Item", None)           (a non-preamble carries NO level -- system
                   convention; the controller throws if a Line Item has a level set)
      other     -> ("Other", None)               (note/subtotal_marker/header_repeat)

    The Preamble level is the DERIVED effective-tree depth (ADR-0009), NOT the frozen parser
    level. Non-preambles stay level-less (None), exactly as before.
    """
    cls = eff["effective_classification"]
    if cls == _PREAMBLE_CLS:
        return "Preamble", levels_by_idx.get(d.get("row_index"), 1)
    if cls == _LINE_ITEM_CLS:
        return "Line Item", None
    return "Other", None


# ---------------------------------------------------------------------------
# SHARED relaxed-#7 preamble-parent predicate (used by the controller AND validator).
# ---------------------------------------------------------------------------

def preamble_parent_ok(node_level: Any, parent_node_type: Any, parent_level: Any) -> bool:
    """Is a Preamble's parent acceptable? (RELAXED #7.)

    L0 / L1 preambles are UNCONSTRAINED (always OK). A Preamble with level > 1 is OK iff
    its parent is a section heading (node_type == "Preamble") that is STRICTLY shallower
    (parent_level < node_level).

    THE RELAX: the old rule required the parent be EXACTLY one level above
    (parent_level == node_level - 1); now any strictly-shallower heading qualifies, so an
    L3 directly under an L1 is allowed. This is the single definition used by BOTH the
    BOQ Nodes controller (durable frappe.throw backstop) and validate_node_plan.
    """
    if node_level is None or node_level <= 1:
        return True
    return (
        parent_node_type == "Preamble"
        and parent_level is not None
        and parent_level < node_level
    )


# ---------------------------------------------------------------------------
# Plan builder -- finalized review rows -> a pure node plan (NO doc, NO insert).
# ---------------------------------------------------------------------------

def build_sheet_node_plan(boq_name: str, sheet_name: str) -> tuple[list, list]:
    """Derive the node PLAN for ONE finalized sheet from its BoQ Review Rows.

    Reads the review rows (sheet_name VERBATIM #152, ordered by row_index), resolves
    effective values (resolve_effective), DROPS grid-only classifications (spacer),
    derives each node's level from the effective tree (derive_effective_levels, ADR-0009),
    and emits one plan dict per node:

      {row_index, source_row_number, node_type, level, parent_index, description,
       qty, supply_rate, install_rate, combined_rate,
       qty_by_area: [{area_name, qty}, ...], row_class}

    NO frappe doc is built and NOTHING is inserted -- this is the read-only derivation
    the preflight validates. Returns (plan, consistency_warnings); consistency_warnings
    feeds the #22 finding inside validate_node_plan (a TRIPWIRE -- never fires under correct
    derivation).
    """
    raw_rows = frappe.db.get_all(
        "BoQ Review Row",
        filters={"boq": boq_name, "sheet_name": sheet_name},  # verbatim (#152)
        fields=_PLAN_REVIEW_ROW_FIELDS,
        order_by="row_index asc",
    )

    node_rows: list[tuple[dict, dict]] = []
    for r in raw_rows:
        d = dict(r)
        # qty_by_area arrives from db.get_all as a JSON string -- parse to a flat dict.
        qba = d.get("qty_by_area")
        if isinstance(qba, str) and qba:
            try:
                d["qty_by_area"] = json.loads(qba)
            except (ValueError, TypeError):
                d["qty_by_area"] = {}
        eff = resolve_effective(d)
        if eff["effective_classification"] in _GRID_ONLY_CLASSIFICATIONS:
            continue  # spacer -> grid-only (no node)
        node_rows.append((d, eff))

    levels_by_idx, consistency_warnings = derive_effective_levels(node_rows)

    plan: list[dict] = []
    for d, eff in node_rows:
        node_type, level = derive_node_type_and_level(d, eff, levels_by_idx)
        qba = d.get("qty_by_area")
        qty_by_area: list[dict] = []
        if isinstance(qba, dict):
            for area_name, qv in qba.items():
                qty_by_area.append({"area_name": area_name, "qty": qv})
        plan.append({
            "row_index": d.get("row_index"),
            "source_row_number": d.get("source_row_number"),
            "node_type": node_type,
            "level": level,
            "parent_index": eff["effective_parent_index"],
            "description": d.get("description"),
            "qty": d.get("qty_total"),
            "supply_rate": d.get("rate_supply"),
            "install_rate": d.get("rate_install"),
            "combined_rate": d.get("rate_combined"),
            "qty_by_area": qty_by_area,
            "row_class": eff["effective_classification"],
        })
    return plan, consistency_warnings


# ---------------------------------------------------------------------------
# Finding construction (plain-English; "section heading" not Preamble, "item" not Line Item)
# ---------------------------------------------------------------------------

_DESC_TRUNCATE = 60


def _truncate(text: Any, limit: int = _DESC_TRUNCATE) -> str:
    """Truncate a description to ~limit chars for display in a finding (… elision)."""
    if not text:
        return ""
    text = str(text)
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _row_prefix(p: dict) -> str:
    """The leading 'Row {n} · "{desc}"' of a per-row finding message."""
    return f"Row {p.get('source_row_number')} · “{_truncate(p.get('description'))}”"


def _row_finding(kind: str, code: str, sheet_name: str, p: dict,
                 body: str, what_to_do: str) -> dict:
    """Build a per-row finding (count=1, group_key keyed by row_index)."""
    return {
        "kind": kind,
        "code": code,
        "sheet_name": sheet_name,
        "source_row_number": p.get("source_row_number"),
        "description": _truncate(p.get("description")),
        "message": f"{_row_prefix(p)} — {body}",
        "what_to_do": what_to_do,
        "group_key": f"{code}:{p.get('row_index')}",
        "count": 1,
    }


# ---------------------------------------------------------------------------
# Validator -- a node plan -> {"errors": [...], "warnings": [...]}.
# ---------------------------------------------------------------------------

def validate_node_plan(
    plan: list,
    declared_areas: Any,
    sheet_name: str,
    level_warnings: list | None = None,
) -> dict:
    """Validate a node plan, returning blocking errors + advisory warnings.

    ERRORS (blocking):
      #7  a section heading (Preamble, level > 1) whose parent fails the relaxed
          preamble_parent_ok rule (parent must be a strictly-shallower section heading).
          Mirrors the controller backstop: only checked when the row HAS an in-plan parent.
      #8  an item (Line Item) whose in-plan parent is not a section heading.

    WARNINGS (advisory):
      #15 a section heading nested unusually deep (level > 5).
      #16 a section heading that carries its own qty/any-rate AND has >=1 child in the plan.
      #20 a qty_by_area area name not in declared_areas -- identical area names across
          rows are folded into ONE finding with a row count (only checked when the BoQ
          declares areas at all).
      #22 the level-less-preamble "squeeze" findings carried in from build_sheet_node_plan.
      orphan -- an item with no in-plan parent group.

    declared_areas may be a list/set/None. level_warnings is the second element of the
    build_sheet_node_plan return (defaults to none).
    """
    errors: list[dict] = []
    warnings: list[dict] = []
    by_index = {p["row_index"]: p for p in plan}

    # Precompute the set of row_indexes that ARE someone's parent (for #16's "has child").
    parent_idxs = {p["parent_index"] for p in plan if p.get("parent_index") is not None}

    for p in plan:
        idx = p["row_index"]
        nt = p["node_type"]
        lvl = p["level"]
        parent_idx = p.get("parent_index")
        parent = by_index.get(parent_idx) if parent_idx is not None else None

        # --- ERROR #7: relaxed preamble-parent rule (only when an in-plan parent exists) ---
        if nt == "Preamble" and lvl is not None and lvl > 1 and parent is not None:
            if not preamble_parent_ok(lvl, parent.get("node_type"), parent.get("level")):
                errors.append(_row_finding(
                    "error", "preamble_parent_level", sheet_name, p,
                    body="this sub-heading isn't filed under a higher-level section heading.",
                    what_to_do="Re-parent it under a higher-level heading in review.",
                ))

        # --- ERROR #8: an item's parent must be a section heading ---
        if nt == "Line Item" and parent is not None and parent.get("node_type") != "Preamble":
            errors.append(_row_finding(
                "error", "line_item_parent_not_preamble", sheet_name, p,
                body="this item sits under a non-heading row (another item or a note) instead of a section heading.",
                what_to_do="Move it under a section heading in review.",
            ))

        # --- WARNING #15: section heading nested unusually deep ---
        if nt == "Preamble" and lvl is not None and lvl > 5:
            warnings.append(_row_finding(
                "warning", "preamble_level_deep", sheet_name, p,
                body=f"this section heading is nested unusually deep (level {lvl}).",
                what_to_do="Check the heading hierarchy in review.",
            ))

        # --- WARNING #16: a priced section heading that also has children ---
        if nt == "Preamble":
            priced = any([
                p.get("qty"), p.get("supply_rate"),
                p.get("install_rate"), p.get("combined_rate"),
            ])
            if priced and idx in parent_idxs:
                warnings.append(_row_finding(
                    "warning", "preamble_priced_with_children", sheet_name, p,
                    body="this section heading carries its own quantity/rate but also contains sub-rows.",
                    what_to_do="Usually only the lowest-level rows carry quantities — verify in review.",
                ))

        # --- WARNING orphan: an item not grouped under any section heading ---
        if nt == "Line Item" and parent is None:
            warnings.append(_row_finding(
                "warning", "orphan_line_item", sheet_name, p,
                body="this item isn't grouped under any section heading.",
                what_to_do="Check its parenting in review.",
            ))

    # --- WARNING #20: undeclared areas, grouped by area name (only when areas are declared) ---
    declared = set(declared_areas) if declared_areas else set()
    if declared:
        undeclared_counts: dict[str, int] = {}
        for p in plan:
            for cell in p.get("qty_by_area") or []:
                a = cell.get("area_name")
                if a and a not in declared:
                    undeclared_counts[a] = undeclared_counts.get(a, 0) + 1
        for area_name, count in undeclared_counts.items():
            warnings.append({
                "kind": "warning",
                "code": "undeclared_area",
                "sheet_name": sheet_name,
                "source_row_number": None,
                "description": None,
                "message": (
                    f"{count} row(s) use area “{area_name}” which isn’t in this "
                    f"BoQ’s declared areas — likely a typo."
                ),
                "what_to_do": "Fix the area name in review, or add it to the BoQ’s areas.",
                "group_key": f"undeclared_area:{area_name}",
                "count": count,
            })

    # --- WARNING #22: level-less-preamble squeeze findings carried in from build ---
    for lw in (level_warnings or []):
        p = by_index.get(lw.get("row_index"), {})
        desc = _truncate(p.get("description"))
        n = lw.get("source_row_number")
        warnings.append({
            "kind": "warning",
            "code": "levelless_preamble_squeeze",
            "sheet_name": sheet_name,
            "source_row_number": n,
            "description": desc,
            "message": (
                f"Row {n} · “{desc}” — this section heading's computed "
                f"position (level {lw.get('computed_level')}) doesn't sit above its parent "
                f"(level {lw.get('parent_level')})."
            ),
            "what_to_do": "Verify the heading hierarchy in review.",
            "group_key": f"levelless_preamble_squeeze:{lw.get('row_index')}",
            "count": 1,
        })

    return {"errors": errors, "warnings": warnings}


# ---------------------------------------------------------------------------
# Review-screen bridge -- the SHARED structural ERRORS (#7/#8) as review breaks.
#
# S2 (commit-preflight): the REVIEW screen HARD-BLOCKS finalize on the SAME #7/#8 the
# commit enforces, by reusing build_sheet_node_plan + validate_node_plan here. This is the
# single bridge so review and commit can NEVER diverge -- both derive from one validator over
# one human>parser effective tree (review_screen.check_structural_integrity resolves the same
# ai_*-free field set, so this is byte-for-byte parity with the real commit).
# ---------------------------------------------------------------------------

# The two BLOCKING structural-error codes validate_node_plan emits (#7 / #8), each mapped to a
# SHORT review-screen reason (a condensed form of the finding body + what_to_do; the row context
# "Row N · desc" is supplied by the review tree itself, so it is not repeated here).
_STRUCTURAL_ERROR_REASON_BY_CODE: dict[str, str] = {
    # #7 -- a sub-heading (Preamble, level > 1) not filed under a higher-level section heading.
    "preamble_parent_level": (
        "This sub-heading isn't under a higher-level section heading — "
        "re-parent it under a higher-level heading."
    ),
    # #8 -- an item under a non-heading row. STRICT SUPERSET of the retired line_item_as_parent:
    # also catches an item filed under a note/subtotal, not only under another line_item.
    "line_item_parent_not_preamble": (
        "This item is under a non-heading row (another item or a note) — "
        "move it under a section heading."
    ),
}


def _finding_row_index(finding: dict) -> Any:
    """Recover a per-row finding's row_index from its group_key ("{code}:{row_index}").

    _row_finding (same module) builds group_key = f"{code}:{row_index}"; neither blocking
    error code contains a colon, so the trailing segment IS the integer row_index. Returns
    None if it can't be parsed (defensive -- never raises)."""
    tail = (finding.get("group_key") or "").rpartition(":")[2]
    try:
        return int(tail)
    except (TypeError, ValueError):
        return None


def structural_errors_for_sheet(boq_name: str, sheet_name: str) -> list[dict]:
    """The BLOCKING structural ERRORS (#7 / #8) for ONE sheet, in the REVIEW break shape.

    Reuses the SHARED commit validators (build_sheet_node_plan + validate_node_plan over the
    human>parser effective tree -- the SAME tree the real commit resolves), keeps ONLY the
    blocking ERROR findings (#7 preamble_parent_level, #8 line_item_parent_not_preamble), and
    re-shapes each into the review break dict:

      {type: <code>, row_index, source_row_number, parent_row_index, reason}

    parent_row_index is the errored plan entry's parent_index (may be None). declared_areas is
    irrelevant to #7/#8 (only the #20 area WARNING reads it) so None is passed -- the soft
    warnings (#15/#16/#20/#22/orphan) are intentionally DROPPED here: the review screen surfaces
    ERRORS ONLY (the soft warnings stay the commit dialog's job). sheet_name VERBATIM (#152)."""
    plan, level_warnings = build_sheet_node_plan(boq_name, sheet_name)
    result = validate_node_plan(plan, None, sheet_name, level_warnings)
    by_index = {p["row_index"]: p for p in plan}

    breaks: list[dict] = []
    for finding in result["errors"]:
        reason = _STRUCTURAL_ERROR_REASON_BY_CODE.get(finding.get("code"))
        if reason is None:
            continue  # not one of the two blocking structural errors
        row_index = _finding_row_index(finding)
        plan_entry = by_index.get(row_index, {})
        breaks.append({
            "type": finding.get("code"),
            "row_index": row_index,
            "source_row_number": finding.get("source_row_number"),
            "parent_row_index": plan_entry.get("parent_index"),
            "reason": reason,
        })
    return breaks


# ---------------------------------------------------------------------------
# Preflight response assembly (this module OWNS the frozen contract; phase 2 wraps it).
# ---------------------------------------------------------------------------

# The frozen response shape commit_preflight returns (string form, for docs/tests).
PREFLIGHT_RESPONSE_SHAPE = (
    "{per_sheet:[{sheet_name, disposition, errors:[finding], warnings:[finding]}]}"
)


def make_preflight_entry(
    sheet_name: str,
    disposition: str,
    errors: list | None = None,
    warnings: list | None = None,
) -> dict:
    """Assemble ONE per_sheet entry of the FROZEN preflight response shape."""
    return {
        "sheet_name": sheet_name,
        "disposition": disposition,
        "errors": list(errors or []),
        "warnings": list(warnings or []),
    }


def evaluate_sheet(
    boq_name: str,
    sheet_name: str,
    disposition: str,
    declared_areas: Any,
) -> dict:
    """Produce ONE per_sheet preflight entry for a sheet.

    General-specs sheets (disposition != "finalized") get only the faithful grid -- NO
    node tree -> ALWAYS 0 errors / 0 warnings (no build, no validate). A finalized sheet
    builds the node plan from its finalized review rows (NO Excel/S3) and validates it.

    This is the single building block the (phase-2) commit_preflight endpoint composes
    into {"per_sheet": [evaluate_sheet(...), ...]}.
    """
    if disposition != "finalized":
        return make_preflight_entry(sheet_name, disposition, [], [])
    plan, level_warnings = build_sheet_node_plan(boq_name, sheet_name)
    result = validate_node_plan(plan, declared_areas, sheet_name, level_warnings)
    return make_preflight_entry(
        sheet_name, disposition, result["errors"], result["warnings"]
    )


# ---------------------------------------------------------------------------
# commit_preflight endpoint (phase 2) -- the thin whitelisted wrapper the commit
# dialog calls BEFORE the irreversible write. It composes evaluate_sheet over the
# requested (or all) commit-eligible sheets into the FROZEN per_sheet shape.
# ---------------------------------------------------------------------------


def _coerce_preflight_subset(sheet_subset: Any) -> list | None:
    """Normalize the optional sheet_subset arg to a list (or None = preflight all).

    Unlike commit_boq._coerce_subset (which REQUIRES a non-empty subset before the
    destructive write), preflight is read-only and tolerant: a missing / empty subset
    means "preflight every commit-eligible sheet". A JSON-string list (the HTTP form)
    or a Python list/tuple are both accepted; anything else throws. Sheet names are
    carried VERBATIM (#152 -- never trimmed)."""
    if sheet_subset is None:
        return None
    if isinstance(sheet_subset, str):
        s = sheet_subset.strip()
        if not s:
            return None
        try:
            sheet_subset = json.loads(s)
        except (ValueError, TypeError):
            frappe.throw(
                "sheet_subset must be a JSON list of sheet names.",
                title="Invalid sheet_subset",
            )
    if not isinstance(sheet_subset, (list, tuple)):
        frappe.throw(
            "sheet_subset must be a list of sheet names.",
            title="Invalid sheet_subset",
        )
    return [s for s in sheet_subset]


@frappe.whitelist(methods=["POST"])
def commit_preflight(boq_name: str = None, sheet_subset: Any = None) -> dict:
    """PRE-COMMIT validation preview for a BoQ's commit-eligible sheets.

    READ-ONLY: derives each finalized sheet's node plan from its BoQ Review Rows and
    validates it (NO Excel/S3 read, NO DB write). General-specs sheets get a grid-only
    disposition and ALWAYS report 0 errors / 0 warnings (no node tree).

    Args:
      boq_name: BOQs docname (required, VERBATIM #152).
      sheet_subset: optional list (or JSON-string list) of sheet names to preflight.
        When omitted, EVERY commit-eligible sheet is preflighted. Names not in the live
        commit gate's eligible set are silently dropped (the dialog only ever ticks
        eligible sheets; the real write path re-checks the gate and is authoritative).

    Returns the FROZEN preflight shape:
      {"per_sheet": [{"sheet_name", "disposition", "errors":[finding], "warnings":[finding]}]}

    Per-sheet order follows the live committable order (the same order the gate returns).
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    # Avoid a module-level cycle (commit_pipeline imports THIS module); import the
    # pure gate rule lazily-at-top here is safe -- commit_gate imports no wizard modules.
    from nirmaan_stack.api.boq.wizard.commit_gate import compute_committable_sheets

    boq_doc = frappe.get_doc("BOQs", boq_name)

    # Live commit gate (same read pattern get_committable_sheets / commit_boq use).
    general_specs_sheet_names: set = {
        row.source_sheet_name
        for row in (boq_doc.general_specs_sheets or [])
        if row.source_sheet_name
    }
    committable = compute_committable_sheets(
        boq_doc.sheet_drafts, general_specs_sheet_names
    )
    disposition_by_sheet = {c["sheet_name"]: c["disposition"] for c in committable}

    requested = _coerce_preflight_subset(sheet_subset)
    if requested is None:
        target_names = [c["sheet_name"] for c in committable]
    else:
        # Intersect with the live committable set, preserving committable order.
        wanted = set(requested)
        target_names = [
            c["sheet_name"] for c in committable if c["sheet_name"] in wanted
        ]

    per_sheet: list[dict] = []
    for sheet_name in target_names:
        disposition = disposition_by_sheet[sheet_name]
        # declared_areas only matters for the finalized (node-tree) path; evaluate_sheet
        # short-circuits general-specs to 0/0 regardless, so read areas only when needed.
        declared_areas = (
            _get_sheet_area_dimensions(boq_name, sheet_name)
            if disposition == "finalized"
            else []
        )
        per_sheet.append(
            evaluate_sheet(boq_name, sheet_name, disposition, declared_areas)
        )
    return {"per_sheet": per_sheet}
