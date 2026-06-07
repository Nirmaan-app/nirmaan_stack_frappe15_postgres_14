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

from nirmaan_stack.services.boq_parser.classifier import RowClassification, _RATE_ROLE_TO_KIND
from nirmaan_stack.api.boq.wizard.update_sheet_draft import get_boq_work_packages


# ---------------------------------------------------------------------------
# Allowed edit fields (save_review_edit)
# ---------------------------------------------------------------------------

_VALID_CLASSIFICATIONS: frozenset[str] = frozenset(rc.value for rc in RowClassification)

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

# Per-area JSON fields editable inline (Slice C-v2d). These are NOT scalar fields --
# each is a dict keyed by area name. A per-area edit is addressed by the `area`
# (+ `rate_subkey` for rate_by_area) params on save_review_edit, NOT through
# _ALLOWED_EDIT_FIELDS (which gates the flat-field path). Shapes:
#   qty_by_area / amount_by_area -- FLAT one-hop  {area: float}
#   rate_by_area                 -- NESTED two-hop {area: {supply_rate, install_rate,
#                                                          combined_rate}} (rate_subkey required)
# Both shapes round-trip through doc.save() with a BARE dict assign (no json.dumps).
# C-v2d-fix: the sent `area` is validated against the SHEET'S defined areas
# (sheet_config.area_dimensions), NOT this row's existing dict keys. A defined-but-empty
# area is a valid value-edit target -- the key is CREATED if absent. Only an UNDEFINED
# area (or a sheet with no area_dimensions) is rejected. Blank value -> 0.0 with the key
# kept (never deleted -- deleting a key is a structure change, not a value edit).
_FLAT_AREA_FIELDS: frozenset[str] = frozenset({"qty_by_area", "amount_by_area"})
_RATE_AREA_FIELD = "rate_by_area"
_AREA_JSON_FIELDS: frozenset[str] = _FLAT_AREA_FIELDS | {_RATE_AREA_FIELD}
# Legal inner rate-kind keys -- reuse the parser's authoritative map, do NOT re-copy.
_LEGAL_RATE_SUBKEYS: frozenset[str] = frozenset(_RATE_ROLE_TO_KIND.values())

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
_NON_DISPLAY_ROLES: frozenset[str] = frozenset({"append_to_notes", "ignore", "reference_images"})

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
    Compute effective field values using human > parser precedence.

    Accepts a Frappe Document, frappe._dict, or a plain dict.

    -1 sentinel convention (parent_index and human_parent):
      -1 means "no parent / no override". Frappe coerces Int None -> 0 on insert
      and 0 is a valid row index, so None cannot be used as a no-parent sentinel at
      the DB boundary. The worker (flatten_resolved_row) writes -1 for root rows;
      save_review_edit writes -1 when human_parent is cleared.
      has_human_parent (Check field) is RETIRED -- the -1-vs-(>=0) distinction now
      carries the "is there an override?" meaning unambiguously.

    Precedence rules:
      effective_classification = human_classification (if non-empty string) else classification
      effective_parent_index   = human_parent_norm (if non-None) else parent_index_norm
        where *_norm = None for values in (None, -1), else the raw value.
        human_parent >= 0 (incl. 0) is a real override of "parent is row N".

    Returns both effective values and the raw stored values (parent_index, human_parent
    may be -1 at the DB layer) so the frontend can render the original alongside effective.
    has_human_parent is NOT included in the returned dict (field retired).
    """
    classification = _get(row, "classification")
    human_classification = _get(row, "human_classification") or None  # coerce "" -> None
    parent_index = _get(row, "parent_index")
    human_parent = _get(row, "human_parent")

    # Translate -1 (and None) to Python None for tree/cycle/orphan logic.
    parent_index_norm = None if parent_index in (None, -1) else parent_index
    human_parent_norm = None if human_parent in (None, -1) else human_parent

    effective_classification = human_classification if human_classification else classification
    # human_parent_norm is not None covers the real-override case, including human_parent=0.
    effective_parent_index = human_parent_norm if human_parent_norm is not None else parent_index_norm

    return {
        "classification": classification,
        "parent_index": parent_index,
        "human_classification": human_classification,
        "human_parent": human_parent,
        "effective_classification": effective_classification,
        "effective_parent_index": effective_parent_index,
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
        elif role == "amount_by_area":
            descriptors.append({
                "col": col,
                "role": role,
                "area": area,
                "value_field": "amount_by_area",
                "value_key": area,
                "rate_subkey": None,
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
        # human-edit layer (Slice A)
        "human_classification", "human_parent",
        "edit_log", "edited_by", "edited_at",
        # human-only annotation (Slice C-v2c) -- NOT an edit; never sets edited_at
        "remarks",
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
        if field == _RATE_AREA_FIELD:
            if not rate_subkey:
                frappe.throw(
                    "rate_subkey is required when editing rate_by_area.",
                    title="Missing field: rate_subkey",
                )
            if rate_subkey not in _LEGAL_RATE_SUBKEYS:
                allowed = ", ".join(sorted(_LEGAL_RATE_SUBKEYS))
                frappe.throw(
                    f"'{rate_subkey}' is not a valid rate kind. Allowed: {allowed}.",
                    title="Invalid rate_subkey",
                )
        else:
            # qty_by_area / amount_by_area are flat one-hop -- rate_subkey is meaningless.
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
        if value and value not in _VALID_CLASSIFICATIONS:
            frappe.throw(
                f"'{value}' is not a valid classification. "
                f"Allowed: {', '.join(sorted(_VALID_CLASSIFICATIONS))}.",
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
                        "parent_index", "human_parent"],
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
        if field == _RATE_AREA_FIELD:
            # Two-hop: rate_by_area[area][rate_subkey].
            inner = current.get(area)
            if not isinstance(inner, dict):
                inner = {}
            from_val = inner.get(rate_subkey)
            inner[rate_subkey] = new_val
            current[area] = inner
        else:
            # One-hop: qty_by_area / amount_by_area [area].
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
                # value was already validated as int or None in the block above.
                doc.human_parent = -1 if value is None else value
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
        existing_log, field, from_val, to_val, frappe.session.user, reason,
        area=area if area_provided else None,
        rate_subkey=rate_subkey if area_provided else None,
    )
    # edit_log is a list-JSON field -- must be pre-serialized before save
    setattr(doc, _EDIT_LOG_FIELD, json.dumps(new_log))

    doc.edited_by = frappe.session.user
    doc.edited_at = frappe.utils.now()

    # Defect 1 fix: frappe.get_doc() loads JSON list fields as Python lists.
    # Frappe's get_valid_dict rejects Python lists for JSON fieldtype on save.
    # Pre-serialize them (guard prevents double-encoding already-string values).
    for _f in _RESAVE_LIST_JSON_FIELDS:
        _v = getattr(doc, _f, None)
        if isinstance(_v, list):
            setattr(doc, _f, json.dumps(_v))

    doc.save(ignore_permissions=True)
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
            "human_classification", "parent_index", "human_parent",
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
    Advance a sheet's wizard_status to "Parsed Check Done" after an integrity check.

    Step 1: run check_structural_integrity against this sheet's BoQ Review Rows.
    Step 2a: if breaks exist AND confirm is falsy -> return {ok: False, breaks: [...]}.
             The sheet status is NOT changed (caller shows warn dialog, may re-call with confirm=True).
    Step 2b: if no breaks, OR breaks exist AND confirm is truthy -> set wizard_status =
             "Parsed Check Done" and return {ok: True, status: "Parsed Check Done", overridden: bool}.

    Writing directly (NOT via set_sheet_status): set_sheet_status only allows the 5 direct-set
    statuses (Pending, Hidden, Reviewed, Skip, Parse failed) -- see _DIRECT_SET_STATUSES in
    update_sheet_draft.py. "Parsed Check Done" is not in that set and would be rejected.
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

    # Fetch rows for integrity check (minimal fields only)
    rows = frappe.db.get_all(
        "BoQ Review Row",
        filters={"boq": boq_name, "sheet_name": sheet_name},
        fields=["row_index", "source_row_number", "classification",
                "human_classification", "parent_index", "human_parent"],
        order_by="row_index asc",
    )
    rows_as_dicts = [dict(r) for r in rows]

    breaks = check_structural_integrity(rows_as_dicts)
    has_breaks = len(breaks) > 0

    if has_breaks and not confirm:
        # Warn-and-confirm gate: return breaks without changing status.
        # Caller shows a warn dialog and may re-call with confirm=True.
        return {"ok": False, "breaks": breaks}

    # Write "Parsed Check Done" directly -- bypasses set_sheet_status which rejects it
    frappe.db.set_value("BoQ Sheet Draft", child_name, "wizard_status", "Parsed Check Done")
    frappe.db.commit()

    return {
        "ok": True,
        "status": "Parsed Check Done",
        "overridden": has_breaks,
    }
