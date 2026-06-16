"""
BoQ commit pipeline -- the combined commit shell + grid write-body (Phase 5 Slice 3a).

This is the FIRST slice that writes REAL parsed BoQ data into the committed schema.

THE TWO-LAYER MODEL
  Every committable sheet commits its COMPLETE original as a FAITHFUL GRID (all 6
  row classifications, in original position) into `BoQ Committed Sheet Grid`.
  FINALIZED sheets will ALSO commit a NODE TREE -- but that is Slice 3b, NOT this
  slice. General-specs sheets are grid-only. Slice 3a builds the grid layer + the
  combined shell; the node branch is a PURE STUB (the shell dispatches to it; it
  does nothing yet).

DISPOSITION (from the Slice-2 commit gate, mapped onto the grid's discriminator):
  gate "general_specs" -> sheet_disposition "grid_only"
  gate "finalized"     -> sheet_disposition "grid_and_nodes"

SINGLE-OPEN FILE PATH
  The workbook is fetched ONCE and opened ONCE; the committable sheets are then
  looped, each faithful grid built by the SHARED sheet_preview._extract_grid_rows
  helper inside the single open workbook. We do NOT re-open per sheet and we do NOT
  call the per-sheet whitelisted preview endpoint in a loop. The S3-safe fetch
  helper (_fetch_boq_file_to_tempfile) is reused verbatim.

VERBATIM SHEET IDENTITY (#152)
  source_sheet_name is matched byte-for-byte on BOTH the write and the freeze
  lookup -- never trimmed. Six sheets on BOQ-26-00145 carry a trailing space;
  trimming would orphan the re-commit freeze lookup and leave TWO current grids
  for one sheet. (PostgreSQL `=` on varchar is byte-exact -- trailing spaces are
  significant -- so equality filters find the right prior version.)

TRANSACTION BOUNDARY
  One trailing frappe.db.commit() PER SHEET (no savepoints -- matching the
  existing app-wide pattern). A sheet's grid + committed BoQ Sheet land together.

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
from nirmaan_stack.api.boq.wizard.sheet_preview import (
    _extract_grid_rows,
    _fetch_boq_file_to_tempfile,
)

_GRID_DOCTYPE = "BoQ Committed Sheet Grid"
_SHEET_DOCTYPE = "BoQ Sheet"

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


@frappe.whitelist(methods=["POST"])
def commit_boq(boq_name: str = None, sheet_subset: Any = None) -> dict:
    """Commit a subset of a BoQ's sheets into the committed schema (Phase 5 Slice 3a).

    For each requested sheet: build + persist its faithful grid (both
    dispositions), create/refresh its committed BoQ Sheet with the column-config
    snapshot, and -- for a finalized sheet -- call the node-write STUB (no-op in
    3a; 3b fills it).

    SERVER-SIDE GATE RE-CHECK: every sheet in sheet_subset MUST be in the live
    commit gate's eligible set, or the whole call is rejected (throw) before any
    write or file fetch. The caller's subset is never trusted.

    Args:
      boq_name:     an existing BOQs document name.
      sheet_subset: list (or JSON-string list) of sheet names to commit. Required.

    Returns:
      {"boq_name": str,
       "committed": [{"sheet_name", "disposition", "sheet_disposition",
                      "grid_name", "boq_sheet_name", "commit_version",
                      "row_count", "froze_prior"}], ...}
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
    """Persist ONE sheet's faithful grid + committed BoQ Sheet, then commit.

    Per-sheet transaction boundary: a single trailing frappe.db.commit() so the
    grid and its committed BoQ Sheet land atomically for this sheet.

    grid_rows is the output of sheet_preview._extract_grid_rows: a list of
    {"row_number", "cells": {col_letter: value}} in source order.
    """
    sheet_disposition = _DISPOSITION_TO_SHEET_DISPOSITION[disposition]

    grid_doc, commit_version, froze_prior = _write_grid(
        boq_name, sheet_name, sheet_disposition, grid_rows
    )
    boq_sheet_name = _write_committed_boq_sheet(
        boq_name, sheet_name, disposition, draft
    )

    # Node-write STUB -- only finalized sheets get a node tree, and only in 3b.
    if disposition == "finalized":
        _commit_node_tree_stub(boq_name, sheet_name, draft, grid_doc, boq_sheet_name)

    frappe.db.commit()

    return {
        "sheet_name": sheet_name,
        "disposition": disposition,
        "sheet_disposition": sheet_disposition,
        "grid_name": grid_doc.name,
        "boq_sheet_name": boq_sheet_name,
        "commit_version": commit_version,
        "row_count": len(grid_rows),
        "froze_prior": froze_prior,
    }


def _write_grid(
    boq_name: str,
    sheet_name: str,
    sheet_disposition: str,
    grid_rows: list[dict],
) -> tuple[Any, int, bool]:
    """Write the new faithful grid, bump commit_version, freeze the prior current.

    Verbatim (#152) (boq, source_sheet_name) match on BOTH the prior-version
    lookup and the freeze. Returns (grid_doc, commit_version, froze_prior).
    """
    # Prior current grid(s) for this exact (boq, sheet) -- normally 0 or 1.
    prior_current = frappe.get_all(
        _GRID_DOCTYPE,
        filters={"boq": boq_name, "source_sheet_name": sheet_name, "is_current": 1},
        pluck="name",
    )

    # Shared version across this sheet's commit = max prior version + 1 (first = 1).
    agg = frappe.get_all(
        _GRID_DOCTYPE,
        filters={"boq": boq_name, "source_sheet_name": sheet_name},
        fields=["max(commit_version) as mv"],
    )
    max_version = agg[0].mv if agg else None
    commit_version = (max_version or 0) + 1

    # Freeze the prior current version(s) BEFORE inserting the new current one.
    for name in prior_current:
        frappe.db.set_value(_GRID_DOCTYPE, name, "is_current", 0)

    grid = frappe.new_doc(_GRID_DOCTYPE)
    grid.boq = boq_name
    grid.source_sheet_name = sheet_name  # verbatim, no strip (#152)
    grid.sheet_disposition = sheet_disposition
    grid.commit_version = commit_version
    grid.is_current = 1
    grid.committed_at = frappe.utils.now()
    for order, row in enumerate(grid_rows):
        grid.append("rows", {
            "row_number": row["row_number"],
            "row_order": order,
            "cells": row["cells"],  # dict-JSON child field accepts a Python dict
        })
    grid.insert(ignore_permissions=True)

    return grid, commit_version, bool(prior_current)


def _write_committed_boq_sheet(
    boq_name: str,
    sheet_name: str,
    disposition: str,
    draft: Any,
) -> str:
    """Create the committed BoQ Sheet for this sheet, snapshotting its render config.

    REPLACE semantics: the committed BoQ Sheet has no version dimension of its own
    (versioning lives on the grid; per-node versioning is Slice 3b), so a re-commit
    deletes the prior committed BoQ Sheet(s) for this exact (boq, sheet) and
    creates a fresh one -- keeping exactly one committed BoQ Sheet per
    (boq, source_sheet_name). In 3a no nodes attach to a BoQ Sheet, so this delete
    is safe; 3b (which attaches the node tree) must revisit this lifecycle.

    The column-config snapshot (column_role_map + column_headers + area_dimensions,
    plus header_row / header_row_count / treat_as) is pinned VERBATIM from the
    draft's sheet_config at commit time -- this is what later serves append-notes
    rendering, semantic column rendering, and Excel write-back addressing.
    """
    # Replace any prior committed BoQ Sheet(s) for this exact (boq, sheet).
    # RAW delete (not delete_doc): BoQ Sheet.area_dimensions is a JSON field holding
    # a LIST, and delete_doc archives the doc via as_json -> get_valid_dict, which
    # rejects a list-valued JSON field ("cannot be a list"). frappe.db.delete bypasses
    # the lifecycle/archive entirely. The BoQ Sheet controller is a bare stub (no
    # on_trash guard), so a raw delete is safe; child work_packages rows are removed
    # explicitly to avoid orphans.
    for name in frappe.get_all(
        _SHEET_DOCTYPE,
        filters={"boq": boq_name, "sheet_name": sheet_name},
        pluck="name",
    ):
        frappe.db.delete("BoQ Sheet Work Package", {"parent": name})
        frappe.db.delete(_SHEET_DOCTYPE, {"name": name})

    cfg = _coerce_config(getattr(draft, "sheet_config", None) if draft else None)

    bs = frappe.new_doc(_SHEET_DOCTYPE)
    bs.boq = boq_name
    bs.sheet_name = sheet_name  # verbatim, no strip (#152)
    bs.sheet_order = (getattr(draft, "sheet_order", None) if draft else None) or 0
    bs.sheet_label = getattr(draft, "sheet_label", None) if draft else None
    bs.treat_as = _DISPOSITION_TO_TREAT_AS[disposition]
    bs.header_row = cfg.get("header_row")
    bs.header_row_count = cfg.get("header_row_count") or 1

    # JSON snapshot fields. area_dimensions is a LIST -- a JSON field rejects a raw
    # Python list on insert, so json.dumps it; dumps the dict ones too for uniformity.
    bs.column_role_map = json.dumps(cfg.get("column_role_map") or {})
    bs.column_headers = json.dumps(cfg.get("column_headers") or {})
    bs.area_dimensions = json.dumps(cfg.get("area_dimensions") or [])

    # Work-header assignments carried from the draft.
    if draft is not None:
        for wp in (getattr(draft, "work_packages", None) or []):
            wh = getattr(wp, "work_header", None)
            if wh:
                bs.append("work_packages", {"work_header": wh})

    bs.insert(ignore_permissions=True)
    return bs.name


def _commit_node_tree_stub(
    boq_name: str,
    sheet_name: str,
    draft: Any,
    grid_doc: Any,
    boq_sheet_name: str,
) -> None:
    """STUB -- the node-tree write path for a Finalized sheet.

    TODO(3b): build the node tree from this sheet's BoQ Review Rows
    (resolve_effective() for parent/classification), map review-row fields onto
    BOQ Nodes + BOQ Node Qty By Area per the P4-3 field-mapping lock, attach each
    node to the committed BoQ Sheet (boq_sheet_name), carry is_rate_only +
    amounts/rates verbatim (capture-only, Slice 2.5), and add per-node versioning.

    No-op in Slice 3a: the faithful grid written above is the ONLY persistence
    this slice does for a finalized sheet.
    """
    return None
