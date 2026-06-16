"""
BoQ commit pipeline -- the commit shell + grid write-body + NODE TREE (Phase 5
Slices 3a + 3b).

This writes REAL parsed BoQ data into the committed schema.

THE TWO-LAYER MODEL
  Every committable sheet commits its COMPLETE original as a FAITHFUL GRID (all 6
  row classifications, in original position) into `BoQ Committed Sheet Grid` (3a).
  A FINALIZED sheet ALSO commits a NODE TREE (3b): its review rows are read,
  resolved (resolve_effective), mapped, and written as BOQ Nodes + BOQ Node Qty By
  Area children, parent-wired, with provenance carried. General-specs sheets are
  grid-only.

DISPOSITION (from the Slice-2 commit gate, mapped onto the grid's discriminator):
  gate "general_specs" -> sheet_disposition "grid_only"
  gate "finalized"     -> sheet_disposition "grid_and_nodes" (gets the node tree)

NODE WRITE (3b) -- two-pass + deferred list-JSON fields
  Pass 1 inserts each node PARENT-LESS, with NO list-valued JSON field set
  (attached_notes / edit_log left null). Pass 2 sets parent_node + doc.save() in
  ancestor-depth order so paths cascade correctly AND the controller's parent-chain
  validation re-runs (a free integrity check) -- safe because the list fields are
  still null at save (Frappe's get_valid_dict rejects a list-valued JSON field, the
  same wall BoQ Sheet.area_dimensions hit in 3a). Pass 3 writes the list-JSON
  fields (attached_notes, edit_log) via frappe.db.set_value(json.dumps(...)), a
  targeted column write that bypasses full-doc serialization. (Dict-valued JSON
  like append_notes_raw is set in pass 1 -- only LISTs trip get_valid_dict.)

CAPTURE-ONLY (Slice 2.5)
  Reviewed money values (rate_*/amount_*) are carried VERBATIM; nothing is
  recomputed. combined_rate consistency is a WARNING, not a block (3b). Float->
  Currency coercion is left to Frappe.

THREE-TIER VERSIONING
  One SHARED commit_version per (boq, sheet) covers the grid, the BoQ Sheet, and
  all nodes for that commit. On re-commit each tier FREEZES its prior current row
  (is_current 1 -> 0 via frappe.db.set_value -- NEVER doc.save(): the BoQ Sheet's
  list-valued area_dimensions would re-serialize and hit get_valid_dict) and lands
  a new is_current=1 row under the shared version. v1 nodes stay attached to frozen
  sheet v1 -- grid v1 + sheet v1 + nodes v1 remain a coherent frozen snapshot. The
  BoQ Sheet is now VERSIONED (freeze-and-supersede), NOT deleted (3a's raw-delete
  retired).

SINGLE-OPEN FILE PATH
  The workbook is fetched + opened ONCE; sheets are looped, each grid built by the
  SHARED sheet_preview._extract_grid_rows inside the single open workbook.

VERBATIM SHEET IDENTITY (#152)
  source_sheet_name / sheet_name matched byte-for-byte on write AND freeze lookup
  -- never trimmed (trailing-space sheet names exist; PostgreSQL `=` on varchar is
  byte-exact).

TRANSACTION BOUNDARY
  One trailing frappe.db.commit() PER SHEET (no savepoints). A sheet's grid +
  BoQ Sheet + node tree land together.

Public API:
  commit_boq(boq_name, sheet_subset) -> dict   [whitelisted, POST]
"""
from __future__ import annotations

import json
import os
from typing import Any

import frappe
import openpyxl

from nirmaan_stack.api.boq.wizard.commit_gate import compute_committable_sheets
from nirmaan_stack.api.boq.wizard.review_screen import resolve_effective
from nirmaan_stack.api.boq.wizard.sheet_preview import (
    _extract_grid_rows,
    _fetch_boq_file_to_tempfile,
)

_GRID_DOCTYPE = "BoQ Committed Sheet Grid"
_SHEET_DOCTYPE = "BoQ Sheet"
_NODE_DOCTYPE = "BOQ Nodes"

# Gate disposition -> grid discriminator (the only mapping; do not re-derive).
_DISPOSITION_TO_SHEET_DISPOSITION = {
    "general_specs": "grid_only",
    "finalized": "grid_and_nodes",
}
# Gate disposition -> committed BoQ Sheet.treat_as snapshot value.
_DISPOSITION_TO_TREAT_AS = {
    "general_specs": "master_preamble",
    "finalized": "data",
}

# effective_classification values that become committed nodes. The 4 others
# (note / spacer / subtotal_marker / header_repeat) are GRID-ONLY -- captured in the
# faithful grid (3a) but NOT turned into nodes (the BOQ Nodes node_type Select has
# exactly Preamble + Line Item).
_PREAMBLE_CLS = "preamble"
_LINE_ITEM_CLS = "line_item"
_NODE_CLASSIFICATIONS = frozenset({_PREAMBLE_CLS, _LINE_ITEM_CLS})

# BoQ Review Row fields the node body reads (the get_review_rows source-of-truth set,
# narrowed to what the mapping needs).
_REVIEW_ROW_FIELDS = [
    "name", "row_index", "source_row_number",
    "classification", "level", "preamble_level_override", "parent_index",
    "human_classification", "human_parent", "human_is_root",
    "sl_no_value", "description", "unit", "make_model",
    "is_rate_only", "is_synthetic",
    "qty_total", "qty_by_area",
    "rate_supply", "rate_install", "rate_combined", "rate_by_area",
    "amount_total", "amount_supply", "amount_install", "amount_by_area",
    "row_notes", "append_notes_raw", "attached_notes",
    "edit_log", "edited_by", "edited_at", "remarks",
]


def _coerce_subset(sheet_subset: Any) -> list[str]:
    """Normalize sheet_subset (JSON string from HTTP, or a Python list) to a list."""
    if sheet_subset is None:
        frappe.throw("sheet_subset is required.", title="Missing field: sheet_subset")
    if isinstance(sheet_subset, str):
        try:
            sheet_subset = json.loads(sheet_subset)
        except (ValueError, TypeError):
            frappe.throw("sheet_subset must be a JSON list of sheet names.",
                         title="Invalid sheet_subset")
    if not isinstance(sheet_subset, (list, tuple)):
        frappe.throw("sheet_subset must be a list of sheet names.",
                     title="Invalid sheet_subset")
    subset = [s for s in sheet_subset]
    if not subset:
        frappe.throw("sheet_subset must name at least one sheet.",
                     title="Empty sheet_subset")
    return subset


def _coerce_config(sheet_config: Any) -> dict:
    """The draft sheet_config blob may arrive as a dict or a JSON string."""
    if not sheet_config:
        return {}
    if isinstance(sheet_config, str):
        try:
            return json.loads(sheet_config) or {}
        except (ValueError, TypeError):
            return {}
    if isinstance(sheet_config, dict):
        return sheet_config
    return {}


def _current_names(doctype: str, boq: str, name_field: str, name_value: str) -> list[str]:
    """The single centralized 'read the current row(s)' accessor across all three
    committed tiers (Slice 3b). Returns the names of is_current=1 rows for a tier,
    parameterized by the tier's identity field:
      grid      -> ("BoQ Committed Sheet Grid", boq, "source_sheet_name", sheet_name)
      BoQ Sheet -> ("BoQ Sheet",                boq, "sheet_name",        sheet_name)
      nodes     -> ("BOQ Nodes",                boq, "sheet",             boq_sheet_name)
    name_value is matched VERBATIM (#152). Normally returns 0 or 1 name.
    """
    return frappe.get_all(
        doctype,
        filters={"boq": boq, name_field: name_value, "is_current": 1},
        pluck="name",
    )


def _next_commit_version(boq: str, sheet_name: str) -> int:
    """The SHARED commit version for this (boq, sheet) commit -- one number for the
    grid, the BoQ Sheet, and all nodes. Anchored on the grid (always written for
    both dispositions): max prior grid version + 1 (first commit = 1)."""
    agg = frappe.get_all(
        _GRID_DOCTYPE,
        filters={"boq": boq, "source_sheet_name": sheet_name},
        fields=["max(commit_version) as mv"],
    )
    return ((agg[0].mv if agg else None) or 0) + 1


@frappe.whitelist(methods=["POST"])
def commit_boq(boq_name: str = None, sheet_subset: Any = None) -> dict:
    """Commit a subset of a BoQ's sheets into the committed schema (Phase 5 Slice 3a/3b).

    For each requested sheet (under ONE shared commit_version): build + persist its
    faithful grid (both dispositions), version its committed BoQ Sheet with the
    column-config snapshot (freeze-and-supersede), and -- for a FINALIZED sheet --
    write the node tree (BOQ Nodes + per-area children, parent-wired, provenance).

    SERVER-SIDE GATE RE-CHECK: every sheet in sheet_subset MUST be in the live
    commit gate's eligible set, or the whole call is rejected (throw) before any
    write or file fetch. The caller's subset is never trusted.

    Args:
      boq_name:     an existing BOQs document name.
      sheet_subset: list (or JSON-string list) of sheet names to commit. Required.

    Returns:
      {"boq_name": str,
       "committed": [{"sheet_name", "disposition", "sheet_disposition",
                      "grid_name", "boq_sheet_name", "commit_version", "row_count",
                      "froze_prior", "froze_prior_sheet", "node_count",
                      "froze_nodes"}], ...}
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    subset = _coerce_subset(sheet_subset)

    boq_doc = frappe.get_doc("BOQs", boq_name)

    # Live gate (SEPARATE from parse-eligibility; same read pattern the gate uses).
    general_specs_sheet_names: set[str] = {
        row.source_sheet_name
        for row in (boq_doc.general_specs_sheets or [])
        if row.source_sheet_name
    }
    committable = compute_committable_sheets(
        boq_doc.sheet_drafts, general_specs_sheet_names
    )
    disposition_by_sheet = {c["sheet_name"]: c["disposition"] for c in committable}

    # Gate re-check -- reject any requested sheet that is not commit-eligible.
    ineligible = [s for s in subset if s not in disposition_by_sheet]
    if ineligible:
        frappe.throw(
            "These sheets are not commit-eligible and cannot be committed: "
            f"{ineligible}. Eligible sheets: {sorted(disposition_by_sheet)}.",
            title="Not commit-eligible",
        )

    # Draft lookup (verbatim sheet_name) for the column-config snapshot.
    drafts_by_name = {d.sheet_name: d for d in boq_doc.sheet_drafts}

    source_file_url = frappe.db.get_value("BOQs", boq_name, "source_file_url")
    if not source_file_url:
        frappe.throw(
            f"BOQs '{boq_name}' has no source_file_url set.",
            title="Missing source file",
        )

    tempfile_path = None
    wb = None
    committed: list[dict] = []
    try:
        # SINGLE fetch + SINGLE open; loop the sheets inside.
        tempfile_path = _fetch_boq_file_to_tempfile(source_file_url)
        wb = openpyxl.load_workbook(tempfile_path, data_only=True, read_only=True)

        for sheet_name in subset:
            if sheet_name not in wb.sheetnames:
                frappe.throw(
                    f"Sheet '{sheet_name}' not found in the workbook. "
                    f"Available sheets: {wb.sheetnames}",
                    title="Sheet not found",
                )
            ws = wb[sheet_name]
            grid_rows = _extract_grid_rows(ws)  # shared transform, single open wb

            disposition = disposition_by_sheet[sheet_name]
            draft = drafts_by_name.get(sheet_name)
            result = _commit_one_sheet(
                boq_name, sheet_name, disposition, grid_rows, draft
            )
            committed.append(result)
    finally:
        if wb is not None:
            wb.close()
        if tempfile_path is not None:
            try:
                os.unlink(tempfile_path)
            except OSError:
                pass

    return {"boq_name": boq_name, "committed": committed}


def _commit_one_sheet(
    boq_name: str,
    sheet_name: str,
    disposition: str,
    grid_rows: list[dict],
    draft: Any,
) -> dict:
    """Persist ONE sheet's three tiers (grid + BoQ Sheet [+ node tree]), then commit.

    Per-sheet transaction boundary: a single trailing frappe.db.commit() so the
    grid, the versioned BoQ Sheet, and (for a finalized sheet) the node tree land
    atomically for this sheet under ONE shared commit_version.

    grid_rows is the output of sheet_preview._extract_grid_rows: a list of
    {"row_number", "cells": {col_letter: value}} in source order.
    """
    sheet_disposition = _DISPOSITION_TO_SHEET_DISPOSITION[disposition]
    # ONE shared commit_version for grid + BoQ Sheet + nodes this commit.
    commit_version = _next_commit_version(boq_name, sheet_name)
    committed_at = frappe.utils.now()

    grid_doc, froze_grid = _write_grid(
        boq_name, sheet_name, sheet_disposition, grid_rows, commit_version, committed_at
    )
    boq_sheet_name, prior_sheet_names = _write_committed_boq_sheet(
        boq_name, sheet_name, disposition, draft, commit_version, committed_at
    )

    node_result = {"node_count": 0, "froze_nodes": 0}
    if disposition == "finalized":
        node_result = _commit_node_tree(
            boq_name, sheet_name, boq_sheet_name, prior_sheet_names,
            commit_version, committed_at,
        )

    frappe.db.commit()

    return {
        "sheet_name": sheet_name,
        "disposition": disposition,
        "sheet_disposition": sheet_disposition,
        "grid_name": grid_doc.name,
        "boq_sheet_name": boq_sheet_name,
        "commit_version": commit_version,
        "row_count": len(grid_rows),
        "froze_prior": froze_grid,                  # grid froze (3a back-compat key)
        "froze_prior_sheet": bool(prior_sheet_names),
        "node_count": node_result["node_count"],
        "froze_nodes": node_result["froze_nodes"],
    }


def _write_grid(
    boq_name: str,
    sheet_name: str,
    sheet_disposition: str,
    grid_rows: list[dict],
    commit_version: int,
    committed_at: str,
) -> tuple[Any, bool]:
    """Write the new faithful grid (is_current=1) under the SHARED commit_version,
    freezing the prior current via set_value. Verbatim (#152) (boq, source_sheet_name)
    match on the freeze lookup. Returns (grid_doc, froze_prior)."""
    prior_current = _current_names(_GRID_DOCTYPE, boq_name, "source_sheet_name", sheet_name)
    for name in prior_current:
        frappe.db.set_value(_GRID_DOCTYPE, name, "is_current", 0)

    grid = frappe.new_doc(_GRID_DOCTYPE)
    grid.boq = boq_name
    grid.source_sheet_name = sheet_name  # verbatim, no strip (#152)
    grid.sheet_disposition = sheet_disposition
    grid.commit_version = commit_version
    grid.is_current = 1
    grid.committed_at = committed_at
    for order, row in enumerate(grid_rows):
        grid.append("rows", {
            "row_number": row["row_number"],
            "row_order": order,
            "cells": row["cells"],  # dict-JSON child field accepts a Python dict
        })
    grid.insert(ignore_permissions=True)

    return grid, bool(prior_current)


def _write_committed_boq_sheet(
    boq_name: str,
    sheet_name: str,
    disposition: str,
    draft: Any,
    commit_version: int,
    committed_at: str,
) -> tuple[str, list[str]]:
    """Version the committed BoQ Sheet: FREEZE the prior current, INSERT a fresh
    current (is_current=1) under the SHARED commit_version. Returns (new_name,
    prior_current_names).

    FREEZE-AND-SUPERSEDE (Slice 3b) -- 3a's raw-delete is RETIRED. The prior sheet
    is frozen via frappe.db.set_value("BoQ Sheet", name, "is_current", 0), a TARGETED
    column write. We must NOT doc.save() the prior sheet: BoQ Sheet.area_dimensions
    is a list-valued JSON field that Frappe re-parses to a Python list on load, and
    doc.save()'s get_valid_dict would reject it ("cannot be a list") -- the same wall
    the 3a delete_doc hit. set_value bypasses full-doc serialization. The prior sheet
    + its nodes thus survive as a coherent frozen version (no delete, no orphan).

    The column-config snapshot (column_role_map + column_headers + area_dimensions,
    plus header_row / header_row_count / treat_as) is pinned VERBATIM from the
    draft's sheet_config at commit time.
    """
    prior_current = _current_names(_SHEET_DOCTYPE, boq_name, "sheet_name", sheet_name)
    for name in prior_current:
        frappe.db.set_value(_SHEET_DOCTYPE, name, "is_current", 0)

    cfg = _coerce_config(getattr(draft, "sheet_config", None) if draft else None)

    bs = frappe.new_doc(_SHEET_DOCTYPE)
    bs.boq = boq_name
    bs.sheet_name = sheet_name  # verbatim, no strip (#152)
    bs.sheet_order = (getattr(draft, "sheet_order", None) if draft else None) or 0
    bs.sheet_label = getattr(draft, "sheet_label", None) if draft else None
    bs.treat_as = _DISPOSITION_TO_TREAT_AS[disposition]
    bs.header_row = cfg.get("header_row")
    bs.header_row_count = cfg.get("header_row_count") or 1

    # JSON snapshot fields. area_dimensions is a LIST -- json.dumps it (a JSON field
    # rejects a raw Python list on insert); dumps the dict ones too for uniformity.
    bs.column_role_map = json.dumps(cfg.get("column_role_map") or {})
    bs.column_headers = json.dumps(cfg.get("column_headers") or {})
    bs.area_dimensions = json.dumps(cfg.get("area_dimensions") or [])

    bs.commit_version = commit_version
    bs.is_current = 1
    bs.committed_at = committed_at

    # Work-header assignments carried from the draft.
    if draft is not None:
        for wp in (getattr(draft, "work_packages", None) or []):
            wh = getattr(wp, "work_header", None)
            if wh:
                bs.append("work_packages", {"work_header": wh})

    bs.insert(ignore_permissions=True)
    return bs.name, prior_current


# ---------------------------------------------------------------------------
# Node tree (Slice 3b)
# ---------------------------------------------------------------------------

_JSON_FIELDS_TO_PARSE = (
    "qty_by_area", "rate_by_area", "amount_by_area",
    "attached_notes", "append_notes_raw", "edit_log",
)


def _parse_json_fields(d: dict) -> dict:
    """db.get_all returns JSON fields as strings; parse the ones the node body needs."""
    for f in _JSON_FIELDS_TO_PARSE:
        v = d.get(f)
        if isinstance(v, str) and v:
            try:
                d[f] = json.loads(v)
            except (ValueError, TypeError):
                pass
    return d


def _commit_node_tree(
    boq_name: str,
    sheet_name: str,
    boq_sheet_name: str,
    prior_sheet_names: list[str],
    commit_version: int,
    committed_at: str,
) -> dict:
    """Build + persist the committed node tree for a FINALIZED sheet (Slice 3b).

    Reads the sheet's BoQ Review Rows, resolves the effective tree, and writes
    PREAMBLE/LINE_ITEM rows as BOQ Nodes (+ per-area BOQ Node Qty By Area children)
    in three passes (see module docstring). Carries reviewed values VERBATIM
    (capture-only). Returns {"node_count", "froze_nodes"}.
    """
    # 0. Freeze the prior commit's current nodes (attached to the now-frozen prior
    #    BoQ Sheet[s]). set_value only -- never touch parent_node; v1 nodes stay a
    #    coherent frozen snapshot under frozen sheet v1.
    froze_nodes = 0
    for ps in prior_sheet_names:
        for n in _current_names(_NODE_DOCTYPE, boq_name, "sheet", ps):
            frappe.db.set_value(_NODE_DOCTYPE, n, "is_current", 0)
            froze_nodes += 1

    # 1. Read review rows (verbatim sheet_name, #152) + resolve effective values.
    raw_rows = frappe.db.get_all(
        "BoQ Review Row",
        filters={"boq": boq_name, "sheet_name": sheet_name},
        fields=_REVIEW_ROW_FIELDS,
        order_by="row_index asc",
    )
    node_rows: list[tuple[dict, dict]] = []   # (row_dict, eff) for node rows only
    eff_parent_by_idx: dict[int, Any] = {}
    for r in raw_rows:
        d = _parse_json_fields(dict(r))
        eff = resolve_effective(d)
        if eff["effective_classification"] not in _NODE_CLASSIFICATIONS:
            continue  # note / spacer / subtotal_marker / header_repeat -> grid-only
        node_rows.append((d, eff))
        eff_parent_by_idx[d["row_index"]] = eff["effective_parent_index"]

    # 2. PASS 1 -- insert every node PARENT-LESS, with NO list-valued JSON field set
    #    (attached_notes / edit_log deferred to pass 3 so pass-2 doc.save() is safe).
    docs_by_idx: dict[int, Any] = {}
    name_by_idx: dict[int, str] = {}
    for d, eff in node_rows:
        node = _build_node_pass1(boq_sheet_name, d, eff, commit_version, committed_at)
        node.insert(ignore_permissions=True)
        docs_by_idx[d["row_index"]] = node
        name_by_idx[d["row_index"]] = node.name

    # 3. PASS 2 -- wire parents via doc.save() in ancestor-depth order, so each
    #    parent's path is final before its children read it AND the controller's
    #    parent-chain validation re-runs (a free integrity check). Roots (or a row
    #    whose effective parent is not itself a node) skip -- path=name from pass-1
    #    after_insert. doc.save() is list-JSON-safe because attached_notes/edit_log
    #    are still null on the held doc.
    depth_by_idx = _node_depths(eff_parent_by_idx, name_by_idx)
    for idx in sorted(name_by_idx, key=lambda i: depth_by_idx[i]):
        eff_parent = eff_parent_by_idx.get(idx)
        if eff_parent is None or eff_parent not in name_by_idx:
            continue
        node = docs_by_idx[idx]
        node.parent_node = name_by_idx[eff_parent]
        node.save(ignore_permissions=True)

    # 4. PASS 3 -- write the DEFERRED list-valued JSON fields via set_value(json.dumps).
    #    Targeted column writes bypass get_valid_dict's "cannot be a list". (Dict-valued
    #    append_notes_raw was set in pass 1 -- only LISTs trip the wall.)
    for d, _eff in node_rows:
        name = name_by_idx[d["row_index"]]
        updates: dict[str, str] = {}
        att = d.get("attached_notes")
        if att:
            updates["attached_notes"] = json.dumps(att)
        elog = d.get("edit_log")
        if elog:
            updates["edit_log"] = json.dumps(elog)
        if updates:
            frappe.db.set_value(_NODE_DOCTYPE, name, updates, update_modified=False)

    return {"node_count": len(node_rows), "froze_nodes": froze_nodes}


def _build_node_pass1(
    boq_sheet_name: str,
    d: dict,
    eff: dict,
    commit_version: int,
    committed_at: str,
) -> Any:
    """Build a parent-less BOQ Nodes doc from a resolved review row (pass 1).

    node_type/level mapping, the P4-3 verbatim field mapping (word-order reversal,
    Float->Currency left to Frappe), flags + human-layer-as-provenance + provenance
    ids + versioning, and the per-area child explosion. Does NOT set the list-valued
    JSON fields (attached_notes / edit_log) -- those land in pass 3.
    """
    node = frappe.new_doc(_NODE_DOCTYPE)
    node.sheet = boq_sheet_name  # boq auto-fills from the sheet (P4-2 sync-guard)

    cls = eff["effective_classification"]
    if cls == _PREAMBLE_CLS:
        node.node_type = "Preamble"
        # level must be >= 1 for a Preamble (controller throws otherwise). Use the
        # classifier override when set (default 0 = unset), else the parser level,
        # else 1 (abort-guard for a missing level).
        lvl = d.get("preamble_level_override") or d.get("level") or 1
        node.level = lvl if (isinstance(lvl, int) and lvl >= 1) else 1
    else:  # _LINE_ITEM_CLS -- level must NOT be set (controller throws if it is)
        node.node_type = "Line Item"

    # Identity / content (P4-3: sl_no_value->code, row_index->sort_order).
    node.code = d.get("sl_no_value")
    node.sort_order = d.get("row_index")
    node.source_row_number = d.get("source_row_number")
    # description is reqd by the controller; abort-guard an empty one with a placeholder.
    node.description = d.get("description") or d.get("sl_no_value") or "(untitled)"
    node.unit = d.get("unit")
    node.make_model = d.get("make_model")

    # qty stays Float. A Line Item requires qty (0 for rate-only items).
    qty = d.get("qty_total")
    if node.node_type == "Line Item" and qty is None:
        qty = 0
    node.qty = qty

    # Money: word-order reversal, Float -> Currency (Frappe coerces; no manual round).
    node.supply_rate = d.get("rate_supply")
    node.install_rate = d.get("rate_install")
    node.combined_rate = d.get("rate_combined")
    node.supply_amount = d.get("amount_supply")
    node.install_amount = d.get("amount_install")
    node.total_amount = d.get("amount_total")

    # Flags carried VERBATIM.
    node.is_rate_only = 1 if d.get("is_rate_only") else 0
    node.is_synthetic = 1 if d.get("is_synthetic") else 0

    # HUMAN LAYER -- carried as PROVENANCE ONLY. The committed tier NEVER branches on
    # these; the LIVE wiring is parent_node + node_type + level (the resolved effective
    # values from resolve_effective). human_* are written, never read by commit logic.
    node.human_classification = d.get("human_classification")
    hp = d.get("human_parent")
    node.human_parent = hp if hp is not None else -1  # -1 sentinel (agreement #54)
    node.human_is_root = 1 if d.get("human_is_root") else 0

    # Notes (Option A -- verbatim, NO aggregation / up-roll / cross-flow).
    node.notes = d.get("row_notes")
    apn = d.get("append_notes_raw")
    if apn:
        node.append_notes_raw = apn  # dict-valued JSON -- safe at insert + pass-2 save

    # Provenance.
    node.review_row_name = d.get("name")              # human-readable tie (may dangle)
    node.commit_provenance_id = frappe.generate_hash()  # durable key

    # Versioning (shared with grid + sheet for this commit).
    node.commit_version = commit_version
    node.is_current = 1
    node.committed_at = committed_at

    # Per-area children (dual-shape; NEVER downgrade granularity).
    for child in _explode_area_children(
        d.get("qty_by_area"), d.get("rate_by_area"), d.get("amount_by_area")
    ):
        node.append("qty_by_area", child)

    return node


def _explode_area_children(qty_ba: Any, rate_ba: Any, amount_ba: Any) -> list[dict]:
    """Explode the review row's per-area JSON into BOQ Node Qty By Area child dicts.

    DUAL-SHAPE, NEVER DOWNGRADE (owner-locked): per-area supply/install granularity
    is a real business requirement and MUST survive the commit.
      qty_by_area    -- always flat {area: float}            -> child.qty
      rate_by_area   -- NESTED {area: {supply_rate, install_rate, combined_rate}}
                        -> each preserved on the matching child column;
                        FLAT bare scalar {area: float} -> combined_rate ONLY
                        (deliberate default; supply/install left empty, not invented)
      amount_by_area -- NESTED {area: {supply, install, total}}
                        -> supply_amount / install_amount / total_amount each preserved;
                        FLAT bare scalar {area: float} -> total_amount ONLY (deliberate)
    area_name is the dict key, VERBATIM (#152). Area order = first-seen across
    qty -> rate -> amount.
    """
    qty_ba = qty_ba if isinstance(qty_ba, dict) else {}
    rate_ba = rate_ba if isinstance(rate_ba, dict) else {}
    amount_ba = amount_ba if isinstance(amount_ba, dict) else {}

    areas: list[str] = []
    seen: set[str] = set()
    for src in (qty_ba, rate_ba, amount_ba):
        for a in src:
            if a not in seen:
                seen.add(a)
                areas.append(a)

    children: list[dict] = []
    for area in areas:
        child: dict[str, Any] = {"area_name": area}

        # The child's qty is reqd=1 (BOQ Node Qty By Area schema). An area present only
        # in rate/amount (not qty_by_area) is a real zero-qty area in the breakdown ->
        # default qty 0.0 (satisfies the constraint without inventing a quantity).
        qv = qty_ba.get(area)
        child["qty"] = qv if isinstance(qv, (int, float)) else 0.0

        rv = rate_ba.get(area)
        if isinstance(rv, dict):  # NESTED -- preserve each kind present
            if rv.get("supply_rate") is not None:
                child["supply_rate"] = rv["supply_rate"]
            if rv.get("install_rate") is not None:
                child["install_rate"] = rv["install_rate"]
            if rv.get("combined_rate") is not None:
                child["combined_rate"] = rv["combined_rate"]
        elif isinstance(rv, (int, float)):  # FLAT scalar -> combined only
            child["combined_rate"] = rv

        av = amount_ba.get(area)
        if isinstance(av, dict):  # NESTED -- preserve each kind present
            if av.get("supply") is not None:
                child["supply_amount"] = av["supply"]
            if av.get("install") is not None:
                child["install_amount"] = av["install"]
            if av.get("total") is not None:
                child["total_amount"] = av["total"]
        elif isinstance(av, (int, float)):  # FLAT scalar -> total only
            child["total_amount"] = av

        children.append(child)

    return children


def _node_depths(eff_parent_by_idx: dict[int, Any], name_by_idx: dict[int, str]) -> dict[int, int]:
    """Depth of each node row in the effective tree (root = 0), for parent-wire
    ordering. Cycle-safe + missing-parent-safe: an idx whose effective parent is None,
    not itself a node, or part of a cycle is treated as depth 0."""
    depth: dict[int, int] = {}

    def _d(idx: int, stack: frozenset) -> int:
        if idx in depth:
            return depth[idx]
        p = eff_parent_by_idx.get(idx)
        if p is None or p not in name_by_idx or p in stack:
            depth[idx] = 0
            return 0
        depth[idx] = _d(p, stack | {idx}) + 1
        return depth[idx]

    for idx in name_by_idx:
        _d(idx, frozenset())
    return depth
