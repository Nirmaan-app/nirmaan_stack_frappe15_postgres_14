"""
BoQ review screen -- helpers + whitelisted endpoints (Slice A).

Public API (unit-testable helpers):
  resolve_effective(row) -> dict
  check_structural_integrity(rows) -> list[dict]
  append_edit_log_entry(existing_log, field, from_val, to_val, user) -> list

Public API (endpoints):
  get_review_rows(boq_name, sheet_name) -> dict          [GET-capable]
  save_review_edit(boq_name, sheet_name, row_index, field, value) -> dict  [POST]
  mark_sheet_parsed_check_done(boq_name, sheet_name, confirm=False) -> dict [POST]

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

from nirmaan_stack.services.boq_parser.classifier import RowClassification
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
_ALLOWED_EDIT_FIELDS: frozenset[str] = _HUMAN_FIELDS | _VALUE_FIELDS

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
) -> list:
    """
    Append one edit entry to the log and return the new log list.

    existing_log may be a Python list, a JSON-encoded string, or None (empty log).
    The caller is responsible for json.dumps() before save (list-JSON field rule).

    Entry shape: {field, from, to, by, at}
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

    log.append({
        "field": field,
        "from": from_val,
        "to": to_val,
        "by": user,
        "at": frappe.utils.now(),
    })
    return log


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_review_rows(boq_name: str = None, sheet_name: str = None) -> dict:
    """
    Return BoQ Review Rows for (boq_name, sheet_name) with effective values + work packages.

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
        "work_packages": ["WH-001", ...]   # list for this sheet only
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

    return {"rows": rows, "work_packages": work_packages}


@frappe.whitelist(methods=["POST"])
def save_review_edit(
    boq_name: str = None,
    sheet_name: str = None,
    row_index=None,
    field: str = None,
    value=None,
) -> dict:
    """
    Apply a human edit to a single BoQ Review Row field.

    Allowed fields:
      human_classification  -- validated against RowClassification vocabulary;
                               None/"" clears the override.
      human_parent          -- int row_index; hard-rejected if self-parent or cycle.
                               None/"" clears the override.
      qty_total / rate_* / amount_* -- direct update of value fields.

    The edit is logged to edit_log (appended). edited_by + edited_at are stamped.

    Returns: {ok: True, row_index, field, from, to, effective: {...}}

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

    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

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

    # --- Capture from-value (EFFECTIVE value before edit) ---

    if field == "human_classification":
        from_val = resolve_effective(doc)["effective_classification"]
    elif field == "human_parent":
        from_val = resolve_effective(doc)["effective_parent_index"]
    else:
        from_val = getattr(doc, field, None)

    # --- Apply the edit ---

    if field in _HUMAN_FIELDS:
        if field == "human_parent":
            # -1 = no override; >= 0 = real override (incl. 0 = parent is row 0).
            # value was already validated as int or None in the block above.
            doc.human_parent = -1 if value is None else value
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
        existing_log, field, from_val, value, frappe.session.user
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
        "to": value,
        "effective": resolve_effective(doc),
    }


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
