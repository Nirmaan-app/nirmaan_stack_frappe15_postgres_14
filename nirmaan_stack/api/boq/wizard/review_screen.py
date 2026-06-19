"""
BoQ review screen -- helpers + whitelisted endpoints (Slice A / B2a).

Public API (unit-testable helpers):
  resolve_effective(row) -> dict
  check_structural_integrity(rows) -> list[dict]
  append_edit_log_entry(existing_log, field, from_val, to_val, user) -> list
  _has_price_signal(row) -> bool                           [Slice B2a]
  _compute_advisory_flags(rows, structural_breaks) -> list [Slice B2a]

Public API (endpoints):
  get_review_rows(boq_name, sheet_name) -> dict          [GET-capable]
  save_review_edit(boq_name, sheet_name, row_index, field, value) -> dict  [POST]
  mark_sheet_parsed_check_done(boq_name, sheet_name, confirm=False) -> dict [POST]
  get_structural_breaks(boq_name, sheet_name) -> dict    [GET-capable; extended B2a]

Layer-separation principle:
  human_classification / human_parent are the HUMAN layer.
  They NEVER overwrite the parser's classification / parent_index.
  Effective value = human override (if set) else parser value (human > parser).
  ai_* fields are deferred to a later slice (C7); model leaves room but builds nothing yet.
"""
from __future__ import annotations

import json
from typing import Any

import frappe

from nirmaan_stack.services.boq_parser.classifier import (
    RowClassification,
    _AMOUNT_ROLE_TO_KIND,
    _RATE_ROLE_TO_KIND,
)
from nirmaan_stack.api.boq.wizard.update_sheet_draft import (
    _guard_sheet_not_parsing,
    get_boq_work_packages,
)


# ---------------------------------------------------------------------------
# Allowed edit fields (save_review_edit)
# ---------------------------------------------------------------------------

_VALID_CLASSIFICATIONS: frozenset[str] = frozenset(rc.value for rc in RowClassification)

# Classes a human may ASSIGN as an edit/restructure TARGET (the "TO" of a
# human_classification change). STRICT SUBSET of _VALID_CLASSIFICATIONS (Slice
# 1b-alpha): subtotal_marker and header_repeat are parser-only DETECTIONS -- they
# remain valid FROM states and reads (the full vocab above) but can never be set
# manually. Used by BOTH save_review_edit's human_classification path and
# save_review_restructure. Do NOT remove _VALID_CLASSIFICATIONS -- FROM/reads use it.
_ASSIGNABLE_CLASSIFICATIONS: frozenset[str] = frozenset({
    "line_item", "preamble", "note", "spacer",
})

_HUMAN_FIELDS: frozenset[str] = frozenset({"human_classification", "human_parent"})
_VALUE_FIELDS: frozenset[str] = frozenset({
    "qty_total",
    "rate_supply",
    "rate_install",
    "rate_combined",
    "amount_total",
    "amount_supply",
    "amount_install",
})
# Plain Data (text) scalar fields editable inline (Slice C-v2b). These are stored
# verbatim as strings -- NOT coerced through float() like _VALUE_FIELDS. Blank
# string clears to None (mirrors the numeric blank-clear). description and
# row_notes are deliberately NOT here -- they stay read-only.
_TEXT_FIELDS: frozenset[str] = frozenset({"unit", "make_model"})
_ALLOWED_EDIT_FIELDS: frozenset[str] = _HUMAN_FIELDS | _VALUE_FIELDS | _TEXT_FIELDS

# Per-area JSON fields editable inline (Slice C-v2d; amount made nested in Slice 2b).
# These are NOT scalar fields -- each is a dict keyed by area name. A per-area edit is
# addressed by the `area` (+ `rate_subkey` for nested fields) params on save_review_edit,
# NOT through _ALLOWED_EDIT_FIELDS (which gates the flat-field path). Shapes:
#   qty_by_area    -- FLAT one-hop  {area: float}
#   rate_by_area   -- NESTED two-hop {area: {supply_rate, install_rate, combined_rate}}
#   amount_by_area -- NESTED two-hop {area: {supply, install, total}}  (Slice 2b)
# The wire param + edit-log key for the inner hop is `rate_subkey` for BOTH nested fields
# (reused generically; for amount it carries the amount kind -- an accepted, pre-existing
# naming misnomer logged as Phase-4 naming debt, NOT renamed in this slice).
# Both shapes round-trip through doc.save() with a BARE dict assign (no json.dumps).
# C-v2d-fix: the sent `area` is validated against the SHEET'S defined areas
# (sheet_config.area_dimensions), NOT this row's existing dict keys. A defined-but-empty
# area is a valid value-edit target -- the key is CREATED if absent. Only an UNDEFINED
# area (or a sheet with no area_dimensions) is rejected. Blank value -> 0.0 with the key
# kept (never deleted -- deleting a key is a structure change, not a value edit).
_FLAT_AREA_FIELDS: frozenset[str] = frozenset({"qty_by_area"})
_RATE_AREA_FIELD = "rate_by_area"
_AMOUNT_AREA_FIELD = "amount_by_area"
# NESTED two-hop per-area fields {area: {kind: float}} -- the write + validation branches
# key on membership HERE, not on a literal field name (Slice 2b).
_NESTED_AREA_FIELDS: frozenset[str] = frozenset({_RATE_AREA_FIELD, _AMOUNT_AREA_FIELD})
_AREA_JSON_FIELDS: frozenset[str] = _FLAT_AREA_FIELDS | _NESTED_AREA_FIELDS
# Legal inner subkeys per nested field -- reuse the parser's authoritative maps, do NOT
# re-copy. rate kinds = {supply_rate, install_rate, combined_rate}; amount kinds =
# {supply, install, total}.
_LEGAL_RATE_SUBKEYS: frozenset[str] = frozenset(_RATE_ROLE_TO_KIND.values())
_LEGAL_AMOUNT_SUBKEYS: frozenset[str] = frozenset(_AMOUNT_ROLE_TO_KIND.values())
# Per-field legal-subkey selection for the nested per-area write/validation path.
_NESTED_FIELD_LEGAL_SUBKEYS: dict[str, frozenset[str]] = {
    _RATE_AREA_FIELD: _LEGAL_RATE_SUBKEYS,
    _AMOUNT_AREA_FIELD: _LEGAL_AMOUNT_SUBKEYS,
}

# Per-row human-only remark cap (Slice C-v2c). Enforced in save_review_remark on
# both sides (frontend live-counter + this hard guard). The remarks field is a
# Small Text column; the cap is code-enforced (Small Text has no DB length).
_REMARK_MAX_LEN = 250

# edit_log is a list-JSON field on BoQ Review Row (Slice A addition).
# Like the 4 list-JSON fields in parse_run._LIST_JSON_FIELDS, it must be
# pre-serialized via json.dumps() before doc.insert() / doc.save().
# This constant is the authoritative record of that requirement for this module.
_EDIT_LOG_FIELD = "edit_log"

# The 4 parser-output list-JSON fields that must be re-serialized before doc.save()
# in save_review_edit. frappe.get_doc() returns them as Python lists; Frappe's
# get_valid_dict rejects Python lists for JSON fieldtype. edit_log is handled
# separately (rebuilt in full above the save call).
_RESAVE_LIST_JSON_FIELDS: frozenset[str] = frozenset({
    "attached_notes", "validation_warnings", "classifier_warnings",
    "preamble_candidate_signals",
})

# JSON fields returned as parsed Python objects in get_review_rows responses
_JSON_LIST_FIELDS: frozenset[str] = frozenset({
    "attached_notes", "validation_warnings", "classifier_warnings",
    "preamble_candidate_signals", "edit_log",
})
_JSON_DICT_FIELDS: frozenset[str] = frozenset({
    "qty_by_area", "amount_by_area", "rate_by_area", "append_notes_raw",
})

# ---------------------------------------------------------------------------
# Column-descriptor constants (_build_column_descriptors)
# ---------------------------------------------------------------------------

# Roles that produce no direct display column in the review screen.
# NOTE (append-to-notes-as-columns slice): `append_to_notes` was REMOVED from this
# set -- it now emits one display column per mapped append-column (in original Excel
# position) via the explicit branch in _build_column_descriptors. `ignore` and
# `reference_images` stay non-display.
_NON_DISPLAY_ROLES: frozenset[str] = frozenset({"ignore", "reference_images"})

# Maps singleton (non-by-area) ColumnRoles to their BoQ Review Row field names.
_SINGLETON_ROLE_TO_FIELD: dict[str, str] = {
    "sl_no": "sl_no_value",
    "description": "description",
    "unit": "unit",
    "make_model": "make_model",
    "row_notes": "row_notes",
    "qty_total": "qty_total",
    "rate_supply": "rate_supply",
    "rate_install": "rate_install",
    "rate_combined": "rate_combined",
    "amount_supply": "amount_supply",
    "amount_install": "amount_install",
    "amount_total": "amount_total",
}


# ---------------------------------------------------------------------------
# Advisory flag constants (Slice B2a)
# ---------------------------------------------------------------------------

# Canonical reason text per flag type.  These are FIXED phrases -- do not
# paraphrase.  The parser flag (type="parser") carries review_reason verbatim
# instead of a canonical override.
_FLAG_REASONS: dict[str, str] = {
    "priced_preamble_no_children": (
        "Preamble carrying a price with no sub-items — check if it's a line item."
    ),
    "zero_amount_line_item": (
        "Has a rate but the amount is zero — check the quantity or amount."
    ),
    "orphan": "Line item with no parent group — check its parenting.",
}

# Scalar price-signal fields checked for flag (i).  rate_by_area is a JSON
# dict (not a scalar Float) and is intentionally excluded here -- a preamble
# with only by-area rates but zero scalar amounts is an edge case that a future
# slice can address; the three scalar rate fields are what the review screen
# currently surfaces.
_PRICE_SIGNAL_FIELDS: tuple[str, ...] = (
    "amount_total", "amount_supply", "amount_install",
    "rate_supply", "rate_install", "rate_combined",
)

# Fields required by get_structural_breaks beyond the minimal integrity set.
# These are fetched in the extended endpoint for advisory flag computation.
_ADVISORY_EXTRA_FIELDS: tuple[str, ...] = (
    "amount_total", "amount_supply", "amount_install",
    "rate_supply", "rate_install", "rate_combined",
    "qty_total", "needs_classification_review", "review_reason",
)

# ---------------------------------------------------------------------------
# Internal utilities
# ---------------------------------------------------------------------------

def _get(row: Any, key: str) -> Any:
    """Uniform field access for Frappe Document objects, frappe._dict, or plain dicts."""
    if isinstance(row, dict):
        return row.get(key)
    return getattr(row, key, None)


def _parse_json_fields(d: dict) -> dict:
    """Parse any JSON string fields to Python objects in-place. Returns the dict."""
    for field in _JSON_LIST_FIELDS | _JSON_DICT_FIELDS:
        val = d.get(field)
        if isinstance(val, str) and val:
            try:
                d[field] = json.loads(val)
            except (ValueError, TypeError):
                pass
    return d


def _chain_has_cycle(row_index: int, rows_by_idx: dict[int, dict]) -> bool:
    """
    True if following effective_parent_index from row_index eventually loops back.

    Uses the 'seen set' approach: if we encounter any already-visited row_index
    while walking up the parent chain, a cycle exists. Starting with row_index in
    the seen set means we detect the specific case where the chain loops back to
    the starting row.
    """
    seen: set[int] = {row_index}
    row = rows_by_idx.get(row_index)
    if row is None:
        return False
    cur = row.get("effective_parent_index")
    while cur is not None:
        if cur in seen:
            return True
        seen.add(cur)
        nxt = rows_by_idx.get(cur)
        if nxt is None:
            break
        cur = nxt.get("effective_parent_index")
    return False


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def resolve_effective(row: Any) -> dict:
    """
    Compute effective field values using the three-layer chain: human > AI-accepted > parser.

    Accepts a Frappe Document, frappe._dict, or a plain dict.

    Layer precedence (Phase 4 P4-1): the AI layer slots BETWEEN human and parser.
    It applies ONLY when ai_suggestion_status == "Accepted"; a None / "" / "Pending" /
    "Rejected" status ignores the ai_suggested_* fields entirely. The human layer always
    wins when present, so this never weakens any existing human-override behaviour.

      effective_classification:
        1. human_classification (non-empty)                 -> human
        2. ai_suggested_classification (status Accepted, set) -> AI
        3. classification                                    -> parser
      effective_parent_index (four-layer precedence, AI-2d):
        1. human_is_root truthy                               -> None (human root)
        2. human_parent >= 0                                  -> human row-override
        3. ai_suggested_is_root (status Accepted)             -> None (AI root)
        4. ai_suggested_parent >= 0 (status Accepted)         -> AI parent
        5. parent_index_norm                                 -> parser

    -1 sentinel convention (parent_index, human_parent, ai_suggested_parent):
      -1 means "no parent / no override / no suggestion". Frappe coerces Int None -> 0 on
      insert and 0 is a valid row index, so None cannot be used as a sentinel at the DB
      boundary. The worker (flatten_resolved_row) writes -1 for root rows; save_review_edit
      writes -1 when human_parent is cleared; the AI service writes -1 for "no suggestion".
      A value >= 0 (incl. 0) is a real value at every layer.
      has_human_parent (Check field) is RETIRED -- the -1-vs-(>=0) distinction carries the
      "is there an override?" meaning unambiguously.

    Returns both effective values and the raw stored values (parent_index, human_parent,
    and the three echoed ai_* fields may be -1/None at the DB layer) so the frontend can
    render the original / suggested / effective values alongside each other.
    has_human_parent is NOT included in the returned dict (field retired).
    """
    classification = _get(row, "classification")
    human_classification = _get(row, "human_classification") or None  # coerce "" -> None
    parent_index = _get(row, "parent_index")
    human_parent = _get(row, "human_parent")
    human_is_root = _get(row, "human_is_root")
    # AI layer (Phase 4 P4-1): only consulted when ai_suggestion_status == "Accepted".
    ai_suggestion_status = _get(row, "ai_suggestion_status")
    ai_suggested_classification = _get(row, "ai_suggested_classification")
    ai_suggested_parent = _get(row, "ai_suggested_parent")
    ai_suggested_is_root = _get(row, "ai_suggested_is_root")
    ai_accepted = ai_suggestion_status == "Accepted"

    # --- effective_classification: human > AI-accepted > parser ---
    if human_classification:
        effective_classification = human_classification
    elif ai_accepted and ai_suggested_classification:
        effective_classification = ai_suggested_classification
    else:
        effective_classification = classification

    # --- effective_parent_index: human-root > human-parent > AI-accepted > parser ---
    # Human-root override (Slice 1b-alpha, Option B): human_is_root is a SEPARATE Check
    # field, orthogonal to human_parent -- it does NOT touch the -1 sentinel value space
    # (agreement #54). When set, the row is effective-root regardless of any AI suggestion
    # or parser parent_index. The consistency invariant (human_is_root=1 => human_parent=-1)
    # is enforced at the write chokepoint (_apply_and_save_row_edit).
    if human_is_root:
        effective_parent_index = None
    else:
        # Translate -1 (and None) to Python None for tree/cycle/orphan logic.
        # UNCHANGED -- the -1 sentinel doctrine is untouched.
        parent_index_norm = None if parent_index in (None, -1) else parent_index
        human_parent_norm = None if human_parent in (None, -1) else human_parent
        ai_parent_norm = None if ai_suggested_parent in (None, -1) else ai_suggested_parent
        # human_parent_norm is not None covers the real-override case, including human_parent=0.
        # Precedence: human_parent > ai_suggested_is_root > ai_suggested_parent > parser.
        # ai_suggested_is_root (AI-2d) is a SEPARATE Check (like human_is_root), orthogonal to
        # the -1 sentinel: when an Accepted suggestion flags root, the row is effective-root
        # regardless of ai_suggested_parent. This is what makes a root suggestion representable
        # (ai_suggested_parent = -1 now means ONLY "no parent-index suggestion", never root).
        if human_parent_norm is not None:
            effective_parent_index = human_parent_norm
        elif ai_accepted and ai_suggested_is_root:
            effective_parent_index = None
        elif ai_accepted and ai_parent_norm is not None:
            effective_parent_index = ai_parent_norm
        else:
            effective_parent_index = parent_index_norm

    return {
        "classification": classification,
        "parent_index": parent_index,
        "human_classification": human_classification,
        "human_parent": human_parent,
        "human_is_root": 1 if human_is_root else 0,
        "effective_classification": effective_classification,
        "effective_parent_index": effective_parent_index,
        # AI layer raw values echoed for the frontend (None when not set).
        "ai_suggestion_status": ai_suggestion_status,
        "ai_suggested_classification": ai_suggested_classification,
        "ai_suggested_parent": ai_suggested_parent,
        "ai_suggested_is_root": 1 if ai_suggested_is_root else 0,
    }


def check_structural_integrity(rows: list[dict]) -> list[dict]:
    """
    Check structural integrity of a parsed sheet using EFFECTIVE values.

    Operates on a list of row dicts; each must contain at least:
      row_index, source_row_number, classification, human_classification,
      parent_index, human_parent.

    Three checks (all operate on EFFECTIVE values from resolve_effective):
      ORPHAN              -- a line_item with effective_parent_index None (no parent group).
                            Preambles and other non-line_item rows with no parent are NOT flagged.
      LINE_ITEM_AS_PARENT -- any row whose effective parent is itself a line_item
                            (line_items cannot be structural parents).
      CYCLE               -- following effective_parent_index from any row eventually
                            loops back to that same row.

    Returns a list of break records (empty list = clean); does NOT modify input rows.
    """
    # Build effective-resolved lookup indexed by row_index
    rows_by_idx: dict[int, dict] = {}
    eff_entries: list[dict] = []

    for row in rows:
        row_index = _get(row, "row_index")
        if row_index is None:
            continue  # skip rows without a valid index
        source_row_number = _get(row, "source_row_number")
        eff = resolve_effective(row)
        entry = {
            "row_index": row_index,
            "source_row_number": source_row_number,
            **eff,
        }
        rows_by_idx[row_index] = entry
        eff_entries.append(entry)

    breaks: list[dict] = []

    for entry in eff_entries:
        row_index = entry["row_index"]
        source_row_number = entry["source_row_number"]
        eff_cls = entry["effective_classification"]
        eff_parent = entry["effective_parent_index"]

        # ORPHAN: a line_item with no parent group.
        # Preambles with no parent are valid top-level groups -- not flagged.
        if eff_cls == "line_item" and eff_parent is None:
            breaks.append({
                "type": "orphan",
                "row_index": row_index,
                "source_row_number": source_row_number,
                "reason": "line_item has no parent group",
            })
            # No parent -> LINE_ITEM_AS_PARENT and CYCLE cannot apply; skip.
            continue

        if eff_parent is not None:
            # LINE_ITEM_AS_PARENT: this row's parent is a line_item.
            parent_entry = rows_by_idx.get(eff_parent)
            if parent_entry and parent_entry.get("effective_classification") == "line_item":
                breaks.append({
                    "type": "line_item_as_parent",
                    "row_index": row_index,
                    "source_row_number": source_row_number,
                    "parent_row_index": eff_parent,
                    "reason": "parent row is a line_item; line_items cannot be parents",
                })

            # CYCLE: following parent chain from this row eventually loops back to it.
            if _chain_has_cycle(row_index, rows_by_idx):
                breaks.append({
                    "type": "cycle",
                    "row_index": row_index,
                    "source_row_number": source_row_number,
                    "reason": "following parent chain from this row creates a cycle",
                })

    return breaks


def append_edit_log_entry(
    existing_log: list | str | None,
    field: str,
    from_val: Any,
    to_val: Any,
    user: str,
    reason: str = None,
    area: str = None,
    rate_subkey: str = None,
) -> list:
    """
    Append one edit entry to the log and return the new log list.

    existing_log may be a Python list, a JSON-encoded string, or None (empty log).
    The caller is responsible for json.dumps() before save (list-JSON field rule).

    Entry shape: {field, from, to, by, at, reason[, area][, rate_subkey]}

    reason (Slice C-v1) is an OPTIONAL free-text note captured per edit. The key
    is always present in the entry for a uniform shape; its value is None when no
    reason was supplied.

    area / rate_subkey (Slice C-v2d) are OPTIONAL structured sub-keys for per-area
    edits (qty_by_area / amount_by_area / rate_by_area). They are added to the entry
    ONLY when supplied -- flat-field entries omit them entirely, so old entries stay
    valid. rate_subkey appears only for rate_by_area edits.
    """
    if existing_log is None:
        log: list = []
    elif isinstance(existing_log, str):
        try:
            log = list(json.loads(existing_log))
        except (ValueError, TypeError):
            log = []
    else:
        log = list(existing_log)  # shallow copy -- do not mutate caller's list

    entry = {
        "field": field,
        "from": from_val,
        "to": to_val,
        "by": user,
        "at": frappe.utils.now(),
        "reason": reason,
    }
    # Slice C-v2d: structured sub-keys -- added only when present (flat entries omit them).
    if area is not None:
        entry["area"] = area
    if rate_subkey is not None:
        entry["rate_subkey"] = rate_subkey
    log.append(entry)
    return log


# ---------------------------------------------------------------------------
# Advisory flag helpers (Slice B2a)
# ---------------------------------------------------------------------------

def _has_price_signal(row: Any) -> bool:
    """
    True if row carries any non-zero value in one of the scalar price-signal
    fields (amounts + scalar rates).  Operates on raw field values; the caller
    is responsible for applying resolve_effective before checking classification.

    rate_by_area is intentionally excluded -- it is a JSON dict, not a scalar,
    and the B2a review screen does not surface by-area rate columns directly.
    """
    for field in _PRICE_SIGNAL_FIELDS:
        v = _get(row, field)
        if v is not None and v > 0:
            return True
    return False


def _compute_advisory_flags(
    rows: list[dict],
    structural_breaks: list[dict],
) -> list[dict]:
    """
    Compute advisory flags for all rows using EFFECTIVE values.

    Four sources:
      priced_preamble_no_children -- (i) preamble with no children AND a price.
          NOTE: the parse-time hierarchy post-pass (_apply_zero_children_preamble
          _demotion_post_pass) demotes all childless priced preambles to line_items
          at parse time, so this flag is DORMANT on freshly-parsed rows.  It only
          fires when a human reclassifies a line_item back to preamble via
          human_classification (Slice C) and the row ends up childless.
      zero_amount_line_item -- (ii) line_item with amount_total==0/None
          OR qty_total==0/None (either zero/absent triggers the flag).
      orphan -- (iii) reused from structural_breaks input; NOT recomputed.
      parser -- (iv) needs_classification_review is truthy; reason = review_reason
          verbatim (no canonical override).

    Canonical reasons are pinned in _FLAG_REASONS; parser reason is verbatim.
    Returns a flat list of flag dicts (multiple flags per row are separate entries).
    """
    # Derive children set from EFFECTIVE parent values (same source as check_structural_integrity).
    children_of: set[int] = set()
    for row in rows:
        eff = resolve_effective(row)
        p = eff["effective_parent_index"]
        if p is not None:
            children_of.add(p)

    # Reuse orphan row_indexes from the already-computed structural_breaks -- do not recompute.
    orphan_row_indexes: set[int] = {
        b["row_index"] for b in structural_breaks if b["type"] == "orphan"
    }

    flags: list[dict] = []

    for row in rows:
        row_index = _get(row, "row_index")
        if row_index is None:
            continue
        source_row_number = _get(row, "source_row_number")
        eff = resolve_effective(row)
        eff_cls = eff["effective_classification"]

        # Flag (i): priced preamble with no children.
        if eff_cls == "preamble" and row_index not in children_of and _has_price_signal(row):
            flags.append({
                "type": "priced_preamble_no_children",
                "row_index": row_index,
                "source_row_number": source_row_number,
                "reason": _FLAG_REASONS["priced_preamble_no_children"],
            })

        # Flag (ii): line item with a non-zero scalar rate but zero/missing amount.
        # Fires only when amount_total is zero/None AND at least one scalar rate
        # field is non-zero.  Rationale: a rate present with no amount is the
        # meaningful signal (likely missing qty); a zero amount with no rate is
        # a rate-only or unconfigured row and is not reliably advisory.
        # The qty-zero trigger is intentionally removed (B2a-fix live-cert).
        # Scalar rate fields only -- rate_by_area (JSON dict) is excluded.
        # Multi-area zero-amount handling is deferred (see Slice B2a-fix docs).
        if eff_cls == "line_item":
            amount_total = _get(row, "amount_total")
            amount_zero = amount_total is None or amount_total == 0
            if amount_zero:
                rate_supply = _get(row, "rate_supply")
                rate_install = _get(row, "rate_install")
                rate_combined = _get(row, "rate_combined")
                has_rate = (
                    (rate_supply is not None and rate_supply != 0)
                    or (rate_install is not None and rate_install != 0)
                    or (rate_combined is not None and rate_combined != 0)
                )
                if has_rate:
                    flags.append({
                        "type": "zero_amount_line_item",
                        "row_index": row_index,
                        "source_row_number": source_row_number,
                        "reason": _FLAG_REASONS["zero_amount_line_item"],
                    })

        # Flag (iii): orphan -- compose from structural_breaks, do not recompute.
        if row_index in orphan_row_indexes:
            flags.append({
                "type": "orphan",
                "row_index": row_index,
                "source_row_number": source_row_number,
                "reason": _FLAG_REASONS["orphan"],
            })

        # Flag (iv): parser needs_classification_review -- verbatim reason.
        needs_review = _get(row, "needs_classification_review")
        review_reason = _get(row, "review_reason")
        if needs_review and review_reason:
            flags.append({
                "type": "parser",
                "row_index": row_index,
                "source_row_number": source_row_number,
                "reason": review_reason,
            })

    return flags


# ---------------------------------------------------------------------------
# Column descriptor builder
# ---------------------------------------------------------------------------

def _build_column_descriptors(sheet_config: dict | None) -> list:
    """
    Build a declarative column_descriptors list from a sheet's sheet_config blob.

    Each descriptor encodes how the frontend should resolve a mapped column's value
    from a BoQ Review Row:
      col         -- Excel column letter (the column_role_map key)
      role        -- raw ColumnRole string
      area        -- area name for by-area roles, else null
      value_field -- top-level BoQ Review Row field to read
      value_key   -- dict key within value_field for by-area fields, else null
      rate_subkey -- inner key within rate_by_area[area] for rate_*_by_area roles, else null

    Non-display roles (append_to_notes, ignore, reference_images) are excluded.
    Unknown roles are skipped silently.
    Returns [] when sheet_config is absent or has no column_role_map.

    Sorted by Excel column order: (len(col), col) -- shorter-then-lexical.
    """
    if not sheet_config:
        return []
    column_role_map = sheet_config.get("column_role_map") or {}
    if not column_role_map:
        return []

    # Letter -> human header label (may be absent/empty). The parser keys
    # append_notes_raw via column_headers.get(col_letter, col_letter) -- header text
    # when mapped, else the bare Excel letter (classifier.py). A per-area-append
    # descriptor must use the SAME resolution for its value_key so the frontend
    # resolveDescriptorValue walk (row["append_notes_raw"][value_key]) finds the value.
    column_headers = sheet_config.get("column_headers") or {}

    descriptors = []
    for col, entry in column_role_map.items():
        if not isinstance(entry, dict):
            continue
        role = entry.get("role")
        area = entry.get("area")

        if not role or role in _NON_DISPLAY_ROLES:
            continue

        if role in _SINGLETON_ROLE_TO_FIELD:
            descriptors.append({
                "col": col,
                "role": role,
                "area": None,
                "value_field": _SINGLETON_ROLE_TO_FIELD[role],
                "value_key": None,
                "rate_subkey": None,
            })
        elif role == "qty":
            descriptors.append({
                "col": col,
                "role": role,
                "area": area,
                "value_field": "qty_by_area",
                "value_key": area,
                "rate_subkey": None,
            })
        elif role in _AMOUNT_ROLE_TO_KIND:
            # Per-area amount roles (field-set Slice 2a): nested amount_by_area[area][kind].
            # Mirrors the rate branch; the generic third-hop key reuses `rate_subkey`
            # (resolveDescriptorValue walks it generically) -> here it carries the amount
            # kind ("supply"/"install"/"total"), not a rate kind.
            descriptors.append({
                "col": col,
                "role": role,
                "area": area,
                "value_field": "amount_by_area",
                "value_key": area,
                "rate_subkey": _AMOUNT_ROLE_TO_KIND[role],
            })
        elif role in _RATE_ROLE_TO_KIND:
            descriptors.append({
                "col": col,
                "role": role,
                "area": area,
                "value_field": "rate_by_area",
                "value_key": area,
                "rate_subkey": _RATE_ROLE_TO_KIND[role],
            })
        elif role == "append_to_notes":
            # Per-column captured note (append-to-notes-as-columns slice). One display
            # column per mapped append-column, in original Excel position (the :649 sort
            # interleaves it). value_field is the kept storage dict `append_notes_raw`;
            # value_key is column_headers.get(col, col) -- the SAME header-else-letter
            # key the parser used to store the note (classifier.py), so the one-hop
            # frontend walk resolves it whether or not headers are mapped. area is null
            # (append columns are never area-scoped). rate_subkey null (one-hop).
            descriptors.append({
                "col": col,
                "role": role,
                "area": None,
                "value_field": "append_notes_raw",
                "value_key": column_headers.get(col, col),
                "rate_subkey": None,
            })
        # else: unknown role -- skip silently

    descriptors.sort(key=lambda d: (len(d["col"]), d["col"]))
    return descriptors


def _get_sheet_area_dimensions(boq_name: str, sheet_name: str) -> list[str]:
    """
    Read a sheet's DEFINED area names from its saved sheet_config blob.

    Returns sheet_config["area_dimensions"] as a list[str], or [] when the sheet
    draft / sheet_config is absent, unparseable, or carries no area_dimensions.

    This is the authoritative source the per-area edit guard validates against
    (C-v2d-fix) -- NOT a row's existing dict keys. sheet_name is matched VERBATIM
    (the #152 trailing-space landmine -- never strip). Mirrors the get_value pattern
    in get_review_rows (parent / parenttype / sheet_name).
    """
    raw_config = frappe.db.get_value(
        "BoQ Sheet Draft",
        {"parent": boq_name, "parenttype": "BOQs", "sheet_name": sheet_name},
        "sheet_config",
    )
    if isinstance(raw_config, str) and raw_config:
        try:
            cfg = json.loads(raw_config)
        except (ValueError, TypeError):
            return []
    elif isinstance(raw_config, dict):
        cfg = raw_config
    else:
        return []
    dims = cfg.get("area_dimensions")
    return dims if isinstance(dims, list) else []


# ---------------------------------------------------------------------------
# Read-only freeze (Slice D1): a sheet at "Finalized" rejects all writes
# ---------------------------------------------------------------------------

# The frozen status + the single read-only message surfaced by every write endpoint.
# One constant so the four guards (and any future write path) throw an IDENTICAL
# message -- the frontend surfaces it verbatim via getFrappeError. The mark/unmark
# endpoints also compare against THIS const (no bare literals) so the status name
# has a single definition site (A1 rename).
_SHEET_FINALIZED = "Finalized"
_FROZEN_WRITE_MESSAGE = (
    "This sheet is marked 'Finalized' and is read-only. "
    "Un-mark it to make changes."
)


def _get_sheet_wizard_status(boq_name: str, sheet_name: str) -> str | None:
    """
    Return the wizard_status of the BoQ Sheet Draft child row for
    (boq_name, sheet_name), or None when no such row exists.

    Same filter pattern mark_sheet_parsed_check_done / _get_sheet_area_dimensions
    use (parent / parenttype / sheet_name). sheet_name is matched VERBATIM
    (the #152 trailing-space landmine -- never strip).
    """
    return frappe.db.get_value(
        "BoQ Sheet Draft",
        {"parent": boq_name, "parenttype": "BOQs", "sheet_name": sheet_name},
        "wizard_status",
    )


def _guard_sheet_not_frozen(boq_name: str, sheet_name: str) -> None:
    """
    Block any write to a sheet marked "Finalized" (Slice D1 read-only freeze).

    Called in every BoQ Review Row write endpoint (save_review_edit,
    save_review_restructure, save_review_remark, dismiss_row_flags) immediately
    after the BOQs-exists guard and BEFORE any doc-locate / validation / write,
    so a frozen sheet short-circuits before doing any work. The freeze is additive:
    a sheet NOT at "Finalized" passes through unchanged (backwards-compat).
    """
    if _get_sheet_wizard_status(boq_name, sheet_name) == _SHEET_FINALIZED:
        frappe.throw(_FROZEN_WRITE_MESSAGE, title="Sheet is read-only")


# ---------------------------------------------------------------------------
# Shared row-write helper (save-inside / commit-outside)
# ---------------------------------------------------------------------------

def _apply_and_save_row_edit(
    doc,
    boq_name: str,
    sheet_name: str,
    field: str,
    value,
    area: str = None,
    rate_subkey: str = None,
    reason: str = None,
    user: str = None,
    set_root: bool = False,
):
    """
    Apply ONE field-change to an already-loaded BoQ Review Row doc, append the
    edit-log entry, stamp provenance, re-serialize the list-JSON siblings, and
    SAVE the doc. Does NOT commit -- the caller owns the single trailing commit.

    set_root (Slice 1b-alpha, Option B) applies ONLY to field="human_parent": when
    True it writes the human-root override (human_is_root=1 AND human_parent=-1, case
    c) instead of a row override. human_is_root is a SEPARATE Check field orthogonal
    to human_parent -- the -1 sentinel value space is UNCHANGED. This helper is the
    single chokepoint that enforces the consistency invariant (root and a real parent
    override can never coexist): every human_parent write here also sets human_is_root.

    This is the shared write path for save_review_edit (single row) and
    save_review_restructure (batch reclassify + reparent). The save-inside /
    commit-outside split is the atomicity boundary: under one request transaction,
    N per-row saves all roll back if a later row throws, and the caller's single
    frappe.db.commit() makes the batch all-or-nothing.

    What this helper does NOT do (callers own it, BEFORE calling): per-call argument
    validation; the human_classification assignable-vocab check; the human_parent
    self-parent / target-exists / cycle-guard (whole-sheet, and for the batch endpoint
    whole-batch -- it cannot be per-row); the doc LOAD; and the commit. The helper
    assumes its inputs are already validated.

    Field application mirrors the certified save_review_edit block exactly:
      - per-area path (area non-empty): read-modify-write the JSON dict, validate the
        area against sheet_config.area_dimensions (C-v2d-fix), set one cell (blank ->
        0.0, key kept); rate_by_area is the two-hop nested case (rate_subkey).
      - flat path (area None): human_classification / human_parent (-1 sentinel for a
        cleared parent) / text (unit, make_model, verbatim) / numeric (float()).

    Returns (from_val, to_val).
    """
    if user is None:
        user = frappe.session.user
    area_provided = area is not None and area != ""

    # --- Capture from-value (EFFECTIVE value before edit) + apply the edit ---

    if area_provided:
        # Per-area JSON write (Slice C-v2d): read-modify-write the dict, set ONE cell.
        current = getattr(doc, field, None)
        if isinstance(current, str) and current:
            try:
                current = json.loads(current)
            except (ValueError, TypeError):
                current = {}
        if not isinstance(current, dict):
            current = {}
        # C-v2d-fix: validate the sent area against the SHEET'S defined areas
        # (sheet_config.area_dimensions), NOT this row's existing dict keys. Setting a
        # value on a defined-but-empty area is a legitimate value edit (the key is
        # created below if absent); only an UNDEFINED area is a structure error.
        # sheet_name passed verbatim (#152).
        area_dimensions = _get_sheet_area_dimensions(boq_name, sheet_name)
        if not area_dimensions:
            frappe.throw(
                "This sheet has no defined areas; per-area values cannot be edited.",
                title="No defined areas",
            )
        if area not in area_dimensions:
            frappe.throw(
                f"Area '{area}' is not a defined area for this sheet.",
                title="Unknown area",
            )
        # Blank value -> 0.0 (key kept); non-blank coerced to float.
        if value is None or value == "":
            new_val = 0.0
        else:
            try:
                new_val = float(value)
            except (ValueError, TypeError):
                frappe.throw(
                    f"Value for '{field}' must be a number.", title="Invalid value"
                )
        if field in _NESTED_AREA_FIELDS:
            # Two-hop nested: <field>[area][rate_subkey] -- rate_by_area or amount_by_area
            # (Slice 2b). Locate/create the inner dict, set ONE kind, leave the area's
            # other kinds + the other areas intact (the B2 anti-corruption guarantee).
            inner = current.get(area)
            if not isinstance(inner, dict):
                inner = {}
            from_val = inner.get(rate_subkey)
            inner[rate_subkey] = new_val
            current[area] = inner
        else:
            # One-hop flat: qty_by_area[area].
            from_val = current.get(area)
            current[area] = new_val
        # Bare dict assign -- Frappe auto-serializes the JSON column on save (proven).
        setattr(doc, field, current)
        to_val = new_val
    else:
        # --- Flat-field path (capture from-value, then apply) ---
        if field == "human_classification":
            from_val = resolve_effective(doc)["effective_classification"]
        elif field == "human_parent":
            from_val = resolve_effective(doc)["effective_parent_index"]
        else:
            from_val = getattr(doc, field, None)

        if field in _HUMAN_FIELDS:
            if field == "human_parent":
                # -1 = no override; >= 0 = real override (incl. 0 = parent is row 0).
                # value was already validated as int or None by the caller.
                # Slice 1b-alpha consistency invariant (THE chokepoint -- no caller can
                # produce a contradictory row):
                #   set_root=True -> human_is_root=1 AND human_parent=-1   (case c, root)
                #   value >= 0    -> human_parent=value AND human_is_root=0 (case a)
                #   value is None -> human_parent=-1 AND human_is_root=0    (case b, clear)
                # human_is_root and a real human_parent override can NEVER coexist.
                if set_root:
                    doc.human_is_root = 1
                    doc.human_parent = -1
                else:
                    doc.human_parent = -1 if value is None else value
                    doc.human_is_root = 0
            else:
                setattr(doc, field, value)
        elif field in _TEXT_FIELDS:
            # Text field (unit / make_model): store the string verbatim -- NO float()
            # coercion (the numeric path below would reject text). Blank string clears
            # to None, matching the numeric blank-clear behaviour.
            if value is None or value == "":
                setattr(doc, field, None)
            else:
                setattr(doc, field, value)
        else:
            # Value field: convert to float or clear to None
            if value is None or value == "":
                setattr(doc, field, None)
            else:
                try:
                    setattr(doc, field, float(value))
                except (ValueError, TypeError):
                    frappe.throw(
                        f"Value for '{field}' must be a number.", title="Invalid value"
                    )
        to_val = value

    # --- Append edit log entry ---

    existing_log = getattr(doc, _EDIT_LOG_FIELD, None)
    if isinstance(existing_log, str) and existing_log:
        try:
            existing_log = json.loads(existing_log)
        except (ValueError, TypeError):
            existing_log = []
    elif not existing_log:
        existing_log = []

    new_log = append_edit_log_entry(
        existing_log, field, from_val, to_val, user, reason,
        area=area if area_provided else None,
        rate_subkey=rate_subkey if area_provided else None,
    )
    # edit_log is a list-JSON field -- must be pre-serialized before save
    setattr(doc, _EDIT_LOG_FIELD, json.dumps(new_log))

    doc.edited_by = user
    doc.edited_at = frappe.utils.now()

    # C-flag-dismissal (decision 3a): any data edit RE-OPENS the row's advisory flags.
    # This is the single chokepoint for save_review_edit AND save_review_restructure, so
    # clearing here covers both. A REMARK does NOT funnel through here (save_review_remark
    # uses a direct set_value bypass) -- a remark must NOT re-open the dismissal.
    doc.flags_dismissed = 0
    doc.flags_dismissed_by = None
    doc.flags_dismissed_at = None

    # Defect 1 fix: frappe.get_doc() loads JSON list fields as Python lists.
    # Frappe's get_valid_dict rejects Python lists for JSON fieldtype on save.
    # Pre-serialize them (guard prevents double-encoding already-string values).
    for _f in _RESAVE_LIST_JSON_FIELDS:
        _v = getattr(doc, _f, None)
        if isinstance(_v, list):
            setattr(doc, _f, json.dumps(_v))

    doc.save(ignore_permissions=True)
    return from_val, to_val


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_review_rows(boq_name: str = None, sheet_name: str = None) -> dict:
    """
    Return BoQ Review Rows for (boq_name, sheet_name) with effective values + work packages
    + a declarative column_descriptors list compiled from the sheet's sheet_config.

    @frappe.whitelist() bare -- GET-capable (mirrors get_boq_work_packages style).

    Rows are ordered by row_index (stable 0-based parse order within the sheet).
    JSON fields are returned as parsed Python objects (lists/dicts, not strings).

    Returns:
      {
        "rows": [
          {<all BoQ Review Row fields>,
           "effective_classification": ...,
           "effective_parent_index": ...},
          ...
        ],
        "work_packages": ["WH-001", ...],   # list for this sheet only
        "column_descriptors": [             # Slice B1.1a: one entry per mapped display column
          {
            "col": "A",                     # Excel column letter
            "role": "sl_no",                # raw ColumnRole
            "area": null,                   # area name for by-area roles, else null
            "value_field": "sl_no_value",   # BoQ Review Row field to read
            "value_key": null,              # dict key for by-area fields, else null
            "rate_subkey": null,            # inner key for rate_by_area, else null
          },
          ...
        ]
      }
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    all_fields = [
        "name", "boq", "sheet_name",
        "source_row_number", "row_index", "classification", "level",
        "parent_index", "path", "attached_to_index", "attached_notes",
        "promoted_from_line_item", "preamble_level_override", "preamble_candidate_score",
        "preamble_candidate_signals", "needs_classification_review", "review_reason",
        "sl_no_value", "description", "unit", "make_model", "is_rate_only",
        "qty_total", "qty_by_area",
        "rate_supply", "rate_install", "rate_combined", "rate_by_area",
        "amount_total", "amount_supply", "amount_install", "amount_by_area",
        "row_notes", "append_notes_raw",
        "validation_warnings", "classifier_warnings", "is_synthetic",
        # human-edit layer (Slice A) + human-root override (Slice 1b-alpha)
        "human_classification", "human_parent", "human_is_root",
        "edit_log", "edited_by", "edited_at",
        # human-only annotation (Slice C-v2c) -- NOT an edit; never sets edited_at
        "remarks",
        # C-flag-dismissal: per-row "Looks OK" acknowledgment (NOT an edit; row stays
        # "Original"). Rides the row payload so the frontend can render the dismissed
        # marker + derive the "N total -- C cleared" summary; no new endpoint.
        "flags_dismissed", "flags_dismissed_by", "flags_dismissed_at",
        # AI suggestion layer (AI-3a read path). ALL 8 ai_* fields must be fetched here.
        # CORRECTION (AI-3a-fix): the four status/suggestion fields below are NOT echoed for
        # free -- resolve_effective READS them from the fetched row (d) and only re-emits what
        # it read, so omitting them from all_fields made d lack them -> the echo wrote None ->
        # the frontend AI Rec badges never rendered. They must be in all_fields.
        "ai_suggestion_status", "ai_suggested_classification",
        "ai_suggested_parent", "ai_suggested_is_root",
        # The remaining four (confidence x2, level, explanation) are display-only -- NOT read
        # by resolve_effective, so they only ever arrived via all_fields.
        "ai_classification_confidence", "ai_parent_confidence",
        "ai_suggested_level", "ai_explanation",
    ]

    raw_rows = frappe.db.get_all(
        "BoQ Review Row",
        filters={"boq": boq_name, "sheet_name": sheet_name},
        fields=all_fields,
        order_by="row_index asc",
    )

    rows = []
    for r in raw_rows:
        d = dict(r)
        _parse_json_fields(d)
        d.update(resolve_effective(d))
        rows.append(d)

    # Work-package join: reuse get_boq_work_packages and pick this sheet.
    # Calling the Python function directly (not via HTTP) -- the @whitelist decorator
    # does not prevent direct calls; it only adds HTTP-routing on top.
    all_wps = get_boq_work_packages(boq_name=boq_name)
    work_packages = all_wps.get(sheet_name, [])

    # Column descriptors: compiled from the sheet's saved sheet_config blob.
    # Absent sheet_config or empty column_role_map -> [].
    raw_config = frappe.db.get_value(
        "BoQ Sheet Draft",
        {"parent": boq_name, "parenttype": "BOQs", "sheet_name": sheet_name},
        "sheet_config",
    )
    if isinstance(raw_config, str) and raw_config:
        try:
            sheet_config = json.loads(raw_config)
        except (ValueError, TypeError):
            sheet_config = None
    elif isinstance(raw_config, dict):
        sheet_config = raw_config
    else:
        sheet_config = None

    column_descriptors = _build_column_descriptors(sheet_config)

    breaks = check_structural_integrity(rows)
    flags = _compute_advisory_flags(rows, breaks)
    return {"rows": rows, "work_packages": work_packages, "column_descriptors": column_descriptors, "flags": flags}


@frappe.whitelist(methods=["POST"])
def save_review_edit(
    boq_name: str = None,
    sheet_name: str = None,
    row_index=None,
    field: str = None,
    value=None,
    reason: str = None,
    area: str = None,
    rate_subkey: str = None,
) -> dict:
    """
    Apply a human edit to a single BoQ Review Row field.

    Allowed fields (flat path -- area is None):
      human_classification  -- validated against RowClassification vocabulary;
                               None/"" clears the override.
      human_parent          -- int row_index; hard-rejected if self-parent or cycle.
                               None/"" clears the override.
      qty_total / rate_* / amount_* -- direct update of numeric value fields (float).
      unit / make_model     -- direct update of text fields (string verbatim, no
                               float coercion); blank clears to None (Slice C-v2b).

    Per-area path (Slice C-v2d -- when `area` is supplied):
      field is one of qty_by_area / amount_by_area / rate_by_area; `area` names the
      cell. rate_by_area additionally requires `rate_subkey` in (supply_rate,
      install_rate, combined_rate). C-v2d-fix: `area` is validated against the SHEET'S
      defined areas (sheet_config.area_dimensions); the dict key is CREATED if absent
      (a defined-but-empty area is a valid edit target). An UNDEFINED area, or a sheet
      with no area_dimensions, is rejected. Blank value -> 0.0 with the key kept. The
      whole dict is bare-assigned back (no json.dumps); the edit stamps provenance exactly
      like a flat edit and appends a STRUCTURED edit_log entry carrying area
      (+ rate_subkey). When `area` is None, behaviour is exactly the flat path above.

    reason (Slice C-v1) is an OPTIONAL free-text note stored as a key on the edit_log
    entry. Blank/whitespace-only is normalized to None.

    The edit is logged to edit_log (appended). edited_by + edited_at are stamped.

    Returns: {ok, row_index, field, from, to, edited_at, effective, area, rate_subkey}
      (area / rate_subkey are None on the flat path.)

    URL: /api/method/nirmaan_stack.api.boq.wizard.review_screen.save_review_edit
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if row_index is None:
        frappe.throw("row_index is required.", title="Missing field: row_index")
    if not field:
        frappe.throw("field is required.", title="Missing field: field")

    # Normalize reason: blank/whitespace-only -> None (Slice C-v1).
    if isinstance(reason, str):
        reason = reason.strip() or None

    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    # Slice D1: a "Finalized" sheet is read-only. Guard BEFORE the per-area
    # routing, field validation, and the expensive human_parent cycle-guard below.
    _guard_sheet_not_frozen(boq_name, sheet_name)
    # #164: a sheet whose parse is in flight is also read-only (worker is rebuilding rows).
    _guard_sheet_not_parsing(boq_name, sheet_name)

    # Slice C-v2d: a non-empty `area` routes to the per-area JSON write path; otherwise
    # this is exactly the flat-field path. An empty-string area is treated as no area.
    area_provided = area is not None and area != ""

    if area_provided:
        if field not in _AREA_JSON_FIELDS:
            allowed = ", ".join(sorted(_AREA_JSON_FIELDS))
            frappe.throw(
                f"Field '{field}' is not a per-area editable field. Allowed: {allowed}.",
                title="Invalid field",
            )
        if field in _NESTED_AREA_FIELDS:
            # Nested two-hop fields (rate_by_area / amount_by_area, Slice 2b) require a
            # subkey, validated against THIS field's legal-kind set. The wire param is
            # `rate_subkey` for both (reused generically; for amount it carries the amount
            # kind -- accepted naming debt, see the constants comment).
            legal = _NESTED_FIELD_LEGAL_SUBKEYS[field]
            if not rate_subkey:
                frappe.throw(
                    f"rate_subkey is required when editing {field}.",
                    title="Missing field: rate_subkey",
                )
            if rate_subkey not in legal:
                allowed = ", ".join(sorted(legal))
                frappe.throw(
                    f"'{rate_subkey}' is not a valid kind for {field}. Allowed: {allowed}.",
                    title="Invalid rate_subkey",
                )
        else:
            # qty_by_area is flat one-hop -- rate_subkey is meaningless.
            rate_subkey = None
    else:
        if field not in _ALLOWED_EDIT_FIELDS:
            allowed = ", ".join(sorted(_ALLOWED_EDIT_FIELDS))
            frappe.throw(
                f"Field '{field}' is not editable via this endpoint. Allowed: {allowed}.",
                title="Invalid field",
            )

    try:
        row_index = int(row_index)
    except (ValueError, TypeError):
        frappe.throw("row_index must be an integer.", title="Invalid row_index")

    # --- Field-specific validation ---

    if field == "human_classification":
        # FROM-but-not-TO (Slice 1b-alpha): only the 4 ASSIGNABLE classes may be set as
        # a target. subtotal_marker / header_repeat remain valid FROM states + reads (the
        # full vocab) but can never be assigned manually. value=None/"" clears.
        if value and value not in _ASSIGNABLE_CLASSIFICATIONS:
            frappe.throw(
                f"'{value}' is a parser-only classification and cannot be assigned "
                f"manually; assignable classes are: "
                f"{', '.join(sorted(_ASSIGNABLE_CLASSIFICATIONS))}.",
                title="Invalid classification",
            )
        # value=None or "" clears the override -- leave as-is for the write step

    if field == "human_parent":
        if value is None or value == "":
            value = None  # clear the override
        else:
            try:
                value = int(value)
            except (ValueError, TypeError):
                frappe.throw(
                    "human_parent must be an integer row_index.", title="Invalid value"
                )

            if value == row_index:
                frappe.throw(
                    "A row cannot be its own parent.", title="Self-parent rejected"
                )

            # Target row must exist in this sheet
            target_exists = frappe.db.exists(
                "BoQ Review Row",
                {"boq": boq_name, "sheet_name": sheet_name, "row_index": value},
            )
            if not target_exists:
                frappe.throw(
                    f"Row index {value} does not exist in sheet '{sheet_name}'.",
                    title="Invalid parent",
                )

            # Cycle guard: simulate the proposed edit and check for a cycle.
            # Fetch minimal fields for all rows in this sheet.
            sheet_rows = frappe.db.get_all(
                "BoQ Review Row",
                filters={"boq": boq_name, "sheet_name": sheet_name},
                fields=["row_index", "classification", "human_classification",
                        "parent_index", "human_parent", "human_is_root"],
            )
            rows_by_idx: dict[int, dict] = {}
            for r in sheet_rows:
                eff = resolve_effective(r)
                rows_by_idx[int(r.row_index)] = eff

            # Simulate: apply the proposed parent to the target row
            if row_index in rows_by_idx:
                rows_by_idx[row_index] = {
                    **rows_by_idx[row_index],
                    "effective_parent_index": value,
                }
            else:
                rows_by_idx[row_index] = {
                    "effective_parent_index": value,
                    "effective_classification": None,
                }

            if _chain_has_cycle(row_index, rows_by_idx):
                frappe.throw(
                    "Setting this parent would create a cycle in the hierarchy.",
                    title="Cycle detected",
                )

    # --- Locate the document ---

    row_name = frappe.db.get_value(
        "BoQ Review Row",
        {"boq": boq_name, "sheet_name": sheet_name, "row_index": row_index},
        "name",
    )
    if not row_name:
        frappe.throw(
            f"Row with row_index={row_index} not found in sheet '{sheet_name}'.",
            title="Row not found",
        )

    doc = frappe.get_doc("BoQ Review Row", row_name)

    # Apply the edit + log + provenance + list-JSON re-serialize via the shared write
    # helper (save-inside / commit-outside). ALL per-call validation above (field
    # routing, human_classification assignable check, human_parent self-parent +
    # cycle-guard) stays in this endpoint; the helper assumes validated inputs. The
    # commit stays here -- the single-row endpoint commits exactly once, as before.
    from_val, to_val = _apply_and_save_row_edit(
        doc, boq_name, sheet_name, field, value,
        area=area if area_provided else None,
        rate_subkey=rate_subkey if area_provided else None,
        reason=reason,
    )
    frappe.db.commit()

    return {
        "ok": True,
        "row_index": row_index,
        "field": field,
        "from": from_val,
        "to": to_val,
        "edited_at": doc.edited_at,
        "effective": resolve_effective(doc),
        # Slice C-v2d: echo the per-area target (None on the flat path).
        "area": area if area_provided else None,
        "rate_subkey": rate_subkey if area_provided else None,
    }


@frappe.whitelist(methods=["POST"])
def save_review_restructure(
    boq_name: str = None,
    sheet_name: str = None,
    row_index=None,
    new_classification: str = None,
    child_moves=None,
    reason: str = None,
    row_new_parent=None,
    mark_ai_accepted=False,
) -> dict:
    """
    Atomically reclassify ONE row AND reparent a set of its children in a single
    commit (Slice 1b-alpha). Path A: the caller sends a FULLY-RESOLVED plan
    (child_moves maps each affected child to its new parent); the backend VALIDATES
    and WRITES it -- it does NOT compute placement.

    Inputs:
      row_index           -- the row being reclassified.
      new_classification  -- the TO class; must be ASSIGNABLE (line_item, preamble,
                             note, spacer). subtotal_marker / header_repeat are
                             parser-only detections and are rejected as targets.
      child_moves         -- dict (or JSON string of a dict) {child_row_index:
                             new_parent_index}. -1 = move to top-level (root). May be
                             empty when the reclassified row has no children to move.
      reason              -- optional human note recorded on the reclassification's
                             human_classification edit_log entry.
      row_new_parent      -- OPTIONAL (Slice 1b-beta2). None/omitted = the reclassified
                             ROW's own parent is left untouched (today's behaviour for
                             every existing caller). -1 = move the row itself to
                             top-level/root. An int row_index = move the row under that
                             row. Frappe passes strings -- int-coerced like the others.
      mark_ai_accepted    -- OPTIONAL (Slice AI-3b-2). When truthy, flips this row's
                             ai_suggestion_status -> "Accepted" inside the SAME commit as
                             the human writes (set on target_doc before the first helper
                             save). Opt-in: omitted/false (every pre-AI-3b-2 caller) leaves
                             ai_suggestion_status untouched. CANCEL-SAFE: only the modal's
                             Save passes it, so a cancelled modal never flips the status.

    Validation (all per-call, BEFORE any write -- frappe.throw on failure, house
    style; nothing is written until every check passes):
      - required args; BOQ exists; row_index int + row exists on this sheet.
      - new_classification in _ASSIGNABLE_CLASSIFICATIONS (FROM-but-not-TO).
      - each child: exists on this sheet; its CURRENT effective parent IS row_index
        (cannot move a non-child); proposed parent is -1 or an existing row on this
        sheet; not self-parented.
      - row_new_parent (when not None): int-coerce or throw; reject self-parent
        (== row_index); if != -1, the target row must exist on this sheet (mirrors
        the child / save_review_edit human_parent checks).
      - BATCH cycle-guard: build the whole-sheet effective-parent map, apply ALL
        proposed moves AT ONCE -- the child moves AND, when given, the row's own move
        into the SAME sim map -- then run _chain_has_cycle for EACH touched row against
        the COMBINED simulated tree. Touched = the child-move keys PLUS row_index when
        row_new_parent is given. (Two individually-safe moves can form a cycle together,
        so they must be checked applied-together, never one at a time; and a row move
        with EMPTY child_moves would run ZERO checks unless row_index is added as a
        check start-point -- the silent-corruption trap this start-point closes.)

    Write (only after all validation passes -- the atomic block; the shared helper
    saves each row, no per-row commit):
      - reclassify the target row via _apply_and_save_row_edit (human_classification),
        logging ONE human_classification edit_log entry (carrying reason).
      - when row_new_parent is not None: ONE more _apply_and_save_row_edit on the SAME
        target_doc setting human_parent (-1 -> set_root=True; int -> that parent). Two
        sequential helper calls on one doc are safe -- edit_log appends off the in-memory
        doc and the single commit covers both; a mid-block throw rolls back everything.
      - for each child, set human_parent via the helper (-1 sentinel for root),
        logging ONE human_parent edit_log entry whose reason ties it to this
        reclassification.
      - a single frappe.db.commit() at the end. If any row throws mid-loop, the
        uncommitted saves roll back (all-or-nothing).

    Returns: {ok, row_index, new_classification, children_moved: [...], edited_at,
              row_moved: bool}.  row_moved is True iff row_new_parent was applied.

    URL: /api/method/nirmaan_stack.api.boq.wizard.review_screen.save_review_restructure
    """
    # --- Per-call argument validation (nothing written until all pass) ---
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if row_index is None:
        frappe.throw("row_index is required.", title="Missing field: row_index")
    if not new_classification:
        frappe.throw(
            "new_classification is required.", title="Missing field: new_classification"
        )

    # Normalize reason: blank/whitespace-only -> None (mirrors save_review_edit).
    if isinstance(reason, str):
        reason = reason.strip() or None

    # AI-3b-2: coerce the HTTP form value ("1"/"true"/"yes") to a real bool.
    if isinstance(mark_ai_accepted, str):
        mark_ai_accepted = mark_ai_accepted.strip().lower() in ("1", "true", "yes")
    else:
        mark_ai_accepted = bool(mark_ai_accepted)

    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    # Slice D1: a "Finalized" sheet is read-only. Guard BEFORE the batch
    # cycle-guard and any write.
    _guard_sheet_not_frozen(boq_name, sheet_name)
    # #164: a sheet whose parse is in flight is also read-only (worker is rebuilding rows).
    _guard_sheet_not_parsing(boq_name, sheet_name)

    try:
        row_index = int(row_index)
    except (ValueError, TypeError):
        frappe.throw("row_index must be an integer.", title="Invalid row_index")

    # FROM-but-not-TO: only the 4 assignable classes are valid write targets.
    if new_classification not in _ASSIGNABLE_CLASSIFICATIONS:
        frappe.throw(
            f"'{new_classification}' is a parser-only classification and cannot be "
            f"assigned manually; assignable classes are: "
            f"{', '.join(sorted(_ASSIGNABLE_CLASSIFICATIONS))}.",
            title="Invalid classification",
        )

    # Normalize child_moves to a dict[int, int]. Accept a dict or a JSON string.
    if child_moves is None or child_moves == "":
        moves_raw = {}
    elif isinstance(child_moves, str):
        try:
            moves_raw = json.loads(child_moves)
        except (ValueError, TypeError):
            frappe.throw(
                "child_moves must be a JSON object mapping child row_index to new parent.",
                title="Invalid child_moves",
            )
    else:
        moves_raw = child_moves
    if not isinstance(moves_raw, dict):
        frappe.throw(
            "child_moves must be a mapping of child row_index to new parent index.",
            title="Invalid child_moves",
        )

    moves: dict = {}
    for k, v in moves_raw.items():
        try:
            ck = int(k)
            cv = int(v)
        except (ValueError, TypeError):
            frappe.throw(
                "child_moves keys and values must be integer row indexes.",
                title="Invalid child_moves",
            )
        moves[ck] = cv

    # --- Fetch the whole sheet once; build the effective-parent map (reused for both
    #     per-child validation and the batch cycle-guard). Mirrors the single-row
    #     cycle-guard fetch in save_review_edit. sheet_name VERBATIM (#152). ---
    sheet_rows = frappe.db.get_all(
        "BoQ Review Row",
        filters={"boq": boq_name, "sheet_name": sheet_name},
        fields=["row_index", "classification", "human_classification",
                "parent_index", "human_parent", "human_is_root"],
    )
    rows_by_idx: dict = {}
    for r in sheet_rows:
        rows_by_idx[int(r.row_index)] = resolve_effective(r)

    if row_index not in rows_by_idx:
        frappe.throw(
            f"Row with row_index={row_index} not found in sheet '{sheet_name}'.",
            title="Row not found",
        )

    # --- row_new_parent validation (Slice 1b-beta2; None = leave the row's parent
    #     untouched, today's behaviour). Mirrors save_review_edit's human_parent
    #     validation: int-coerce, reject self-parent, target must exist (unless -1). ---
    row_move_requested = row_new_parent is not None and row_new_parent != ""
    if row_move_requested:
        try:
            row_new_parent = int(row_new_parent)
        except (ValueError, TypeError):
            frappe.throw(
                "row_new_parent must be an integer row_index (or -1 for top-level).",
                title="Invalid row_new_parent",
            )
        if row_new_parent == row_index:
            frappe.throw(
                "A row cannot be its own parent.", title="Self-parent rejected"
            )
        if row_new_parent != -1 and row_new_parent not in rows_by_idx:
            frappe.throw(
                f"Proposed parent {row_new_parent} for row {row_index} does not exist "
                f"in sheet '{sheet_name}'.",
                title="Invalid parent",
            )
    else:
        row_new_parent = None

    # --- Per-child validation (no write yet) ---
    for child_idx, new_parent in moves.items():
        if child_idx not in rows_by_idx:
            frappe.throw(
                f"Child row {child_idx} does not exist in sheet '{sheet_name}'.",
                title="Invalid child",
            )
        # The child must CURRENTLY be a child of row_index (effective parent).
        cur_parent = rows_by_idx[child_idx].get("effective_parent_index")
        if cur_parent != row_index:
            frappe.throw(
                f"Row {child_idx} is not currently a child of row {row_index}; "
                f"it cannot be moved by this reclassification.",
                title="Not a child",
            )
        if child_idx == new_parent:
            frappe.throw(
                f"Row {child_idx} cannot be its own parent.",
                title="Self-parent rejected",
            )
        if new_parent != -1 and new_parent not in rows_by_idx:
            frappe.throw(
                f"Proposed parent {new_parent} for child {child_idx} does not exist "
                f"in sheet '{sheet_name}'.",
                title="Invalid parent",
            )

    # --- BATCH cycle-guard: apply ALL moves into a simulated effective-parent map,
    #     THEN check each touched row against the COMBINED tree. Two individually
    #     acyclic moves can form a cycle together, so we must simulate them all
    #     applied before checking -- never one at a time. Nothing has been written. ---
    sim: dict = {idx: dict(entry) for idx, entry in rows_by_idx.items()}
    for child_idx, new_parent in moves.items():
        sim[child_idx]["effective_parent_index"] = None if new_parent == -1 else new_parent
    # Slice 1b-beta2: the row's OWN move goes into the SAME sim map, so a cycle the
    # row-move forms with any child-move is visible in the combined tree.
    if row_new_parent is not None:
        sim[row_index]["effective_parent_index"] = (
            None if row_new_parent == -1 else row_new_parent
        )
    # Check start-points: every moved CHILD, plus row_index itself when the ROW moved.
    # The row_index start-point is load-bearing: a row move with EMPTY child_moves would
    # otherwise run ZERO checks (the loop iterates moves only) and silently corrupt the
    # tree (e.g. a row moved under its own child). The set union closes that trap.
    check_starts = set(moves)
    if row_new_parent is not None:
        check_starts.add(row_index)
    for start_idx in check_starts:
        if _chain_has_cycle(start_idx, sim):
            frappe.throw(
                f"The proposed moves would create a cycle in the hierarchy "
                f"(row {start_idx}). No changes were made.",
                title="Cycle detected",
            )

    # --- Write block (atomic; the shared helper saves each row, single commit at the
    #     end). All validation above passed, so every helper call is on validated input. ---
    user = frappe.session.user

    # 1. Reclassify the target row (one human_classification edit_log entry).
    target_name = frappe.db.get_value(
        "BoQ Review Row",
        {"boq": boq_name, "sheet_name": sheet_name, "row_index": row_index},
        "name",
    )
    target_doc = frappe.get_doc("BoQ Review Row", target_name)
    # AI-3b-2 / AI-3c-1: the mark_ai_accepted status flip is DEFERRED to after the human
    # writes (capture-then-flip; see the flip block before the commit below). Flipping it
    # here -- before the classification + parent helpers -- made resolve_effective (which the
    # helper reads for the edit_log from-value) honor the AI layer and return the AI value the
    # helper was about to write, logging a no-op (from == to). The flag stays opt-in + cancel-
    # safe: this endpoint is reached ONLY via the modal's Save.
    _apply_and_save_row_edit(
        target_doc, boq_name, sheet_name,
        "human_classification", new_classification,
        reason=reason, user=user,
    )

    # 1b. Optionally move the reclassified ROW itself (Slice 1b-beta2). A SECOND helper
    # call on the SAME in-memory doc -- edit_log appends cumulatively and the single
    # commit below covers both writes. -1 -> human-root override (set_root=True, logs
    # to=None); a real row_index -> human_parent=that row (clears human_is_root via the
    # chokepoint invariant). reason ties the move to this reclassification.
    row_moved = row_new_parent is not None
    if row_moved:
        row_move_reason = f"row moved: row {row_index} reclassified to {new_classification}"
        if row_new_parent == -1:
            _apply_and_save_row_edit(
                target_doc, boq_name, sheet_name,
                "human_parent", None,
                reason=row_move_reason, user=user, set_root=True,
            )
        else:
            _apply_and_save_row_edit(
                target_doc, boq_name, sheet_name,
                "human_parent", row_new_parent,
                reason=row_move_reason, user=user,
            )

    edited_at = target_doc.edited_at

    # 2. Reparent each child (one human_parent entry per child, tied to the reclass).
    child_reason = f"parent moved: row {row_index} reclassified to {new_classification}"
    children_moved: list = []
    for child_idx in sorted(moves):
        new_parent = moves[child_idx]
        child_name = frappe.db.get_value(
            "BoQ Review Row",
            {"boq": boq_name, "sheet_name": sheet_name, "row_index": child_idx},
            "name",
        )
        child_doc = frappe.get_doc("BoQ Review Row", child_name)
        # -1 in child_moves = "move to top-level" -> the human-root override (case c):
        # set_root=True writes human_is_root=1 AND human_parent=-1, and the edit_log
        # records to=None (root reads as "no parent"). A value >= 0 is a real parent
        # (case a): human_parent=value AND human_is_root cleared to 0. The helper is
        # the single chokepoint enforcing the invariant.
        if new_parent == -1:
            _apply_and_save_row_edit(
                child_doc, boq_name, sheet_name,
                "human_parent", None,
                reason=child_reason, user=user, set_root=True,
            )
        else:
            _apply_and_save_row_edit(
                child_doc, boq_name, sheet_name,
                "human_parent", new_parent,
                reason=child_reason, user=user,
            )
        children_moved.append(child_idx)

    # AI-3b-2 / AI-3c-1 capture-then-flip: now that the classification + parent helpers above
    # captured their from-values with the AI layer dormant, flip the status. set_value runs IN
    # this request transaction, so the single commit below keeps human_* + the flip ATOMIC (no
    # second independent commit). Opt-in: omitted/false (every pre-AI-3b-2 caller) leaves
    # ai_suggestion_status untouched.
    if mark_ai_accepted:
        target_doc.ai_suggestion_status = "Accepted"
        frappe.db.set_value(
            "BoQ Review Row", target_doc.name, "ai_suggestion_status", "Accepted",
            update_modified=False,
        )

    frappe.db.commit()

    return {
        "ok": True,
        "row_index": row_index,
        "new_classification": new_classification,
        "children_moved": children_moved,
        "edited_at": edited_at,
        "row_moved": row_moved,
    }


@frappe.whitelist(methods=["POST"])
def save_review_remark(
    boq_name: str = None,
    sheet_name: str = None,
    row_index=None,
    remark: str = None,
) -> dict:
    """
    Save a per-row human-only remark on a single BoQ Review Row.

    A remark is annotation, NOT a data edit. This endpoint is a deliberately
    SEPARATE write path from save_review_edit (Slice C-v2c):
      - it writes ONLY the `remarks` field;
      - it does NOT append to edit_log;
      - it does NOT set edited_by or edited_at.
    A row that carries only a remark therefore stays "Original" (the frontend's
    edited provenance keys off edited_at / edit_log, neither of which this touches).
    The write uses frappe.db.set_value (not doc.save) precisely so no version /
    provenance side-effects fire.

    The remark is capped at 250 chars (_REMARK_MAX_LEN), enforced here as a hard
    guard (frappe.throw) so the cap holds even if the frontend is bypassed.
    Blank/whitespace-only normalizes to None (clears the remark).

    sheet_name is matched VERBATIM (no trimming) -- the #152 trailing-space landmine.

    Returns: {ok: True, row_index, remarks}

    URL: /api/method/nirmaan_stack.api.boq.wizard.review_screen.save_review_remark
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if row_index is None:
        frappe.throw("row_index is required.", title="Missing field: row_index")

    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    # Slice D1: a "Finalized" sheet is read-only. Guard BEFORE the row-locate
    # and write.
    _guard_sheet_not_frozen(boq_name, sheet_name)
    # #164: a sheet whose parse is in flight is also read-only (worker is rebuilding rows).
    _guard_sheet_not_parsing(boq_name, sheet_name)

    try:
        row_index = int(row_index)
    except (ValueError, TypeError):
        frappe.throw("row_index must be an integer.", title="Invalid row_index")

    # Normalize: blank/whitespace-only -> None (clears the remark).
    if isinstance(remark, str):
        remark = remark.strip() or None

    # Hard 500-char guard (runs on the normalized value).
    if remark is not None and len(remark) > _REMARK_MAX_LEN:
        frappe.throw(
            f"Remark is too long ({len(remark)} chars). Maximum is {_REMARK_MAX_LEN}.",
            title="Remark too long",
        )

    # Locate the row (verbatim sheet_name match -- #152).
    row_name = frappe.db.get_value(
        "BoQ Review Row",
        {"boq": boq_name, "sheet_name": sheet_name, "row_index": row_index},
        "name",
    )
    if not row_name:
        frappe.throw(
            f"Row with row_index={row_index} not found in sheet '{sheet_name}'.",
            title="Row not found",
        )

    # Write ONLY the remarks field. set_value (not doc.save) so edited_at / edit_log
    # / version side-effects never fire -- the remark must not flip the row to "Edited".
    frappe.db.set_value("BoQ Review Row", row_name, "remarks", remark)
    frappe.db.commit()

    return {"ok": True, "row_index": row_index, "remarks": remark}


@frappe.whitelist(methods=["POST"])
def dismiss_row_flags(
    boq_name: str = None,
    sheet_name: str = None,
    row_index=None,
    dismissed=None,
) -> dict:
    """
    Per-row "Looks OK" dismissal of a row's advisory flags (C-flag-dismissal).

    A dismissal is an ACKNOWLEDGMENT, not a data edit. This endpoint mirrors
    save_review_remark's SEPARATE write path:
      - it writes ONLY the flags_dismissed / flags_dismissed_by / flags_dismissed_at
        fields via frappe.db.set_value (NOT doc.save, NOT the _apply_and_save_row_edit
        chokepoint);
      - it does NOT append to edit_log;
      - it does NOT set edited_by or edited_at;
      - it does NOT touch human_* fields.
    A row that is only dismissed therefore stays "Original" (the frontend's edited
    provenance keys off edited_at / edit_log, neither of which this touches).

    Symmetry: a subsequent data edit RE-OPENS the dismissal -- that clear lives at the
    _apply_and_save_row_edit chokepoint (covers save_review_edit + save_review_restructure),
    NOT here. A remark does NOT re-open it (save_review_remark bypasses the chokepoint).
    Re-parse wipes it for free (delete+recreate -> the Check defaults to 0).

    `dismissed` truthy  -> flags_dismissed=1 + by/at stamped.
    `dismissed` falsy   -> flags_dismissed=0 + by/at cleared (supports a future
                           un-dismiss and the edit-reopen symmetry, even though no UI
                           un-dismiss button ships).

    sheet_name is matched VERBATIM (no trimming) -- the #152 trailing-space landmine.

    Returns: {flags_dismissed: 0|1}

    URL: /api/method/nirmaan_stack.api.boq.wizard.review_screen.dismiss_row_flags
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if row_index is None:
        frappe.throw("row_index is required.", title="Missing field: row_index")

    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    # Slice D1: a "Finalized" sheet is read-only. Guard BEFORE the row-locate
    # and write.
    _guard_sheet_not_frozen(boq_name, sheet_name)
    # #164: a sheet whose parse is in flight is also read-only (worker is rebuilding rows).
    _guard_sheet_not_parsing(boq_name, sheet_name)

    try:
        row_index = int(row_index)
    except (ValueError, TypeError):
        frappe.throw("row_index must be an integer.", title="Invalid row_index")

    # HTTP sends bools as strings ("true"/"1"/"false"/"0"/""); normalize to a real bool.
    if isinstance(dismissed, str):
        is_dismissed = dismissed.strip().lower() in ("1", "true", "yes")
    else:
        is_dismissed = bool(dismissed)

    # Locate the row (verbatim sheet_name match -- #152).
    row_name = frappe.db.get_value(
        "BoQ Review Row",
        {"boq": boq_name, "sheet_name": sheet_name, "row_index": row_index},
        "name",
    )
    if not row_name:
        frappe.throw(
            f"Row with row_index={row_index} not found in sheet '{sheet_name}'.",
            title="Row not found",
        )

    # Write ONLY the dismissal fields. set_value (not doc.save) so edited_at / edit_log
    # / version side-effects never fire -- a dismissal must not flip the row to "Edited".
    if is_dismissed:
        frappe.db.set_value("BoQ Review Row", row_name, {
            "flags_dismissed": 1,
            "flags_dismissed_by": frappe.session.user,
            "flags_dismissed_at": frappe.utils.now(),
        })
    else:
        frappe.db.set_value("BoQ Review Row", row_name, {
            "flags_dismissed": 0,
            "flags_dismissed_by": None,
            "flags_dismissed_at": None,
        })
    frappe.db.commit()

    return {"flags_dismissed": 1 if is_dismissed else 0}


@frappe.whitelist()
def get_structural_breaks(boq_name: str = None, sheet_name: str = None) -> dict:
    """
    Return structural integrity breaks and advisory flags for (boq_name, sheet_name).

    Read-only: does NOT write, does NOT change wizard_status, does NOT call
    mark_sheet_parsed_check_done. Intended for display in the review screen
    (Slice B2) and any caller that needs the raw break/flag lists.

    Extended in Slice B2a to also return advisory flags alongside breaks.
    The "breaks" key contract is unchanged (backward-compatible addition).

    @frappe.whitelist() bare -- GET-capable (mirrors get_review_rows style).

    Returns:
      {
        "breaks": [...],   (empty list = structurally clean; contract unchanged)
        "flags":  [...],   (advisory observations; Slice B2a addition)
      }

    Each flag dict: {type, row_index, source_row_number, reason}.
    Flag types: priced_preamble_no_children, zero_amount_line_item, orphan, parser.
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    # Fetch both the minimal integrity fields and the advisory-flag extra fields in
    # one query.  The integrity check only reads the first six; the advisory helpers
    # read the rest.
    rows = frappe.db.get_all(
        "BoQ Review Row",
        filters={"boq": boq_name, "sheet_name": sheet_name},
        fields=[
            "row_index", "source_row_number", "classification",
            "human_classification", "parent_index", "human_parent", "human_is_root",
            *_ADVISORY_EXTRA_FIELDS,
        ],
        order_by="row_index asc",
    )
    rows_as_dicts = [dict(r) for r in rows]
    breaks = check_structural_integrity(rows_as_dicts)
    flags = _compute_advisory_flags(rows_as_dicts, breaks)
    return {"breaks": breaks, "flags": flags}


@frappe.whitelist(methods=["POST"])
def mark_sheet_parsed_check_done(
    boq_name: str = None,
    sheet_name: str = None,
    confirm=False,
) -> dict:
    """
    Advance a sheet's wizard_status to "Finalized" after an integrity check.

    Step 1: run check_structural_integrity against this sheet's BoQ Review Rows.
    Step 2a: if breaks exist AND confirm is falsy -> return {ok: False, breaks: [...]}.
             The sheet status is NOT changed (caller shows warn dialog, may re-call with confirm=True).
    Step 2b: if no breaks, OR breaks exist AND confirm is truthy -> set wizard_status =
             "Finalized" and return {ok: True, status: "Finalized", overridden: bool}.

    Writing directly (NOT via set_sheet_status): set_sheet_status only allows the 5 direct-set
    statuses (Pending, Hidden, Config Done, Skip, Parse failed) -- see _DIRECT_SET_STATUSES in
    update_sheet_draft.py. "Finalized" is not in that set and would be rejected.
    This endpoint writes directly using the same locate-child-row + frappe.db.set_value pattern.

    URL: /api/method/nirmaan_stack.api.boq.wizard.review_screen.mark_sheet_parsed_check_done
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    # Normalize confirm: HTTP POST body may deliver it as a string "true"/"1"/"false"
    if isinstance(confirm, str):
        confirm = confirm.lower() in ("true", "1", "yes")
    confirm = bool(confirm)

    # Locate the sheet draft child row (same pattern as set_sheet_status / _set_draft_status)
    child_name = frappe.db.get_value(
        "BoQ Sheet Draft",
        {"parent": boq_name, "parenttype": "BOQs", "sheet_name": sheet_name},
        "name",
    )
    if not child_name:
        frappe.throw(
            f"Sheet '{sheet_name}' not found in BOQs '{boq_name}'.",
            title="Sheet not found",
        )

    # Slice D1 precondition: ONLY a sheet currently at "Parsed" may be marked checked.
    # Before D1 this endpoint stamped unconditionally (recon-verified); the tightening is
    # additive -- its existing tests seed "Parsed" sheets so they stay green. Existing
    # response shapes (ok:false+breaks / ok:true+overridden) are unchanged.
    current_status = frappe.db.get_value("BoQ Sheet Draft", child_name, "wizard_status")
    if current_status == _SHEET_FINALIZED:
        frappe.throw(
            f"This sheet is already marked '{_SHEET_FINALIZED}'.",
            title="Already finalized",
        )
    if current_status != "Parsed":
        frappe.throw(
            f"Only a sheet with status 'Parsed' can be marked '{_SHEET_FINALIZED}'. "
            f"Current status: {current_status}.",
            title="Cannot finalize",
        )

    # Fetch rows for integrity check (minimal fields only)
    rows = frappe.db.get_all(
        "BoQ Review Row",
        filters={"boq": boq_name, "sheet_name": sheet_name},
        fields=["row_index", "source_row_number", "classification",
                "human_classification", "parent_index", "human_parent", "human_is_root"],
        order_by="row_index asc",
    )
    rows_as_dicts = [dict(r) for r in rows]

    breaks = check_structural_integrity(rows_as_dicts)
    has_breaks = len(breaks) > 0

    if has_breaks and not confirm:
        # Warn-and-confirm gate: return breaks without changing status.
        # Caller shows a warn dialog and may re-call with confirm=True.
        return {"ok": False, "breaks": breaks}

    # Write "Finalized" directly -- bypasses set_sheet_status which rejects it
    frappe.db.set_value("BoQ Sheet Draft", child_name, "wizard_status", _SHEET_FINALIZED)
    frappe.db.commit()

    return {
        "ok": True,
        "status": _SHEET_FINALIZED,
        "overridden": has_breaks,
    }


@frappe.whitelist(methods=["POST"])
def unmark_sheet_parsed_check_done(
    boq_name: str = None,
    sheet_name: str = None,
) -> dict:
    """
    Revert a "Finalized" sheet back to "Parsed" (Slice D1 Un-mark).

    The inverse of mark_sheet_parsed_check_done: it lifts the read-only freeze so the
    review screen becomes editable again. There is NO integrity check -- moving a sheet
    BACKWARD is always allowed.

    Precondition: the sheet must currently be at "Finalized" (else frappe.throw).

    Writing directly (NOT via set_sheet_status): set_sheet_status only allows the 5
    direct-set statuses (Pending, Hidden, Config Done, Skip, Parse failed) -- "Parsed" is
    NOT in that set (_DIRECT_SET_STATUSES) and would be rejected. This endpoint writes
    directly with the same locate-child-row + frappe.db.set_value pattern the mark
    endpoint documents.

    Returns: {ok: True, status: "Parsed"}

    URL: /api/method/nirmaan_stack.api.boq.wizard.review_screen.unmark_sheet_parsed_check_done
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    # Locate the sheet draft child row (verbatim sheet_name match -- #152).
    child_name = frappe.db.get_value(
        "BoQ Sheet Draft",
        {"parent": boq_name, "parenttype": "BOQs", "sheet_name": sheet_name},
        "name",
    )
    if not child_name:
        frappe.throw(
            f"Sheet '{sheet_name}' not found in BOQs '{boq_name}'.",
            title="Sheet not found",
        )

    # Precondition: only a FINALIZED sheet may be un-marked.
    current_status = frappe.db.get_value("BoQ Sheet Draft", child_name, "wizard_status")
    if current_status != _SHEET_FINALIZED:
        frappe.throw(
            f"Only a sheet marked '{_SHEET_FINALIZED}' can be un-marked. "
            f"Current status: {current_status}.",
            title="Cannot un-mark",
        )

    # Write "Parsed" directly -- bypasses set_sheet_status which rejects "Parsed".
    frappe.db.set_value("BoQ Sheet Draft", child_name, "wizard_status", "Parsed")
    frappe.db.commit()

    return {"ok": True, "status": "Parsed"}
