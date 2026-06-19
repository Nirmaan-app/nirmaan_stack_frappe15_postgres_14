"""
BoQ commit gate -- the commit-eligibility rule (Phase 5 Slice 2).

Answers ONE question for a BoQ: "which sheets are eligible to COMMIT right now?"
READ-ONLY -- it computes and returns a list. It does NOT commit anything, does
NOT write the DB, does NOT change any wizard_status, and does NOT call the parser.

CRITICAL -- commit-eligibility is SEPARATE from parse-eligibility:
  The parser (assemble_mapping_config) treats "Finalized" as not_eligible BY
  DEFAULT -- it only re-parses a Finalized sheet under force_reparse. The COMMIT
  gate is the OPPOSITE for Finalized: "Finalized" is precisely what we WANT to
  commit. This module therefore does NOT reuse, import, or consult
  assemble_mapping_config / force_reparse -- it is a separate, narrower rule.

Commit-eligibility rule (the ONLY two dispositions that commit, per the Phase-5
LOCKED INPUTS):
  - A sheet designated General-specs (membership in BOQs.general_specs_sheets,
    the pointer overlay -- NOT wizard_status, which is never literally
    "General specs") -> eligible, disposition "general_specs".
  - A sheet whose wizard_status is "Finalized" -> eligible, disposition
    "finalized".
  - Everything else -> NOT eligible: blank, Pending, Hidden, Config Done, Skip,
    Parse failed, Parsed.

PRECEDENCE (overlap): a sheet can be BOTH Finalized AND general-specs-designated
(the designation is a pointer overlay and never writes wizard_status). When both
apply, "general_specs" WINS -- mirroring assemble_mapping_config Rule 1, where
the general-specs pointer is checked FIRST and outranks wizard_status.

The disposition tells the Slice-3 commit pipeline which write path to use
(faithful general-specs grid vs. line-item nodes). Slice 3 + the hub commit UI
(Slice 4) both call this gate; the gate is unit-tested in isolation here first.

Public API:
  compute_committable_sheets(sheet_drafts, general_specs_sheet_names) -> list[dict]
      [PURE helper -- no DB; testable with injected sheet data]
  get_committable_sheets(boq_name) -> dict   [whitelisted, READ-ONLY endpoint]
  get_committed_state(boq_name) -> dict       [whitelisted, READ-ONLY endpoint;
      per-sheet CURRENT committed-state from the BoQ Committed Sheet Grid tier]
"""
from __future__ import annotations

from typing import Any

import frappe

# The single wizard_status value that commits its line-item data.
_FINALIZED_STATUS = "Finalized"

# Disposition tokens (consumed by the Slice-3 commit pipeline to pick a write path).
_DISPOSITION_FINALIZED = "finalized"
_DISPOSITION_GENERAL_SPECS = "general_specs"


def _get(obj: Any, key: str, default: Any = None) -> Any:
    """Field access that works for a Frappe child doc / frappe._dict / plain dict."""
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def compute_committable_sheets(
    sheet_drafts: Any, general_specs_sheet_names: set[str]
) -> list[dict]:
    """
    PURE commit-eligibility rule -- no DB, no side effects.

    Args:
      sheet_drafts: iterable of sheet records, each exposing `sheet_name` and
        `wizard_status` (Frappe child docs, frappe._dict, or plain dicts all work
        via the `_get` shim). Iteration order is preserved in the output.
      general_specs_sheet_names: set of `source_sheet_name` values designated
        general-specs (BOQs.general_specs_sheets pointer membership). Matched
        VERBATIM (#152 -- sheet names are never trimmed).

    Returns:
      list[dict] -- one entry per eligible sheet, in input order:
        {"sheet_name": str, "disposition": "general_specs" | "finalized"}.

    Rule (SEPARATE from parse-eligibility -- this never consults the parser):
      general-specs-designated -> "general_specs" (PRECEDENCE);
      else wizard_status == "Finalized" -> "finalized";
      else NOT eligible (omitted from the result).
    """
    committable: list[dict] = []
    for draft in sheet_drafts:
        sheet_name = _get(draft, "sheet_name")
        status = _get(draft, "wizard_status") or ""

        # General-specs pointer is checked FIRST and outranks wizard_status, so a
        # sheet that is both designated AND "Finalized" commits as general_specs.
        if sheet_name in general_specs_sheet_names:
            committable.append({
                "sheet_name": sheet_name,
                "disposition": _DISPOSITION_GENERAL_SPECS,
            })
            continue

        if status == _FINALIZED_STATUS:
            committable.append({
                "sheet_name": sheet_name,
                "disposition": _DISPOSITION_FINALIZED,
            })
            continue

        # Everything else is NOT commit-eligible -- omitted.

    return committable


@frappe.whitelist()
def get_committable_sheets(boq_name: str) -> dict:
    """
    READ-ONLY commit-eligibility gate (Phase 5 Slice 2).

    Loads `boq_name`'s sheets + its general-specs pointer, applies
    `compute_committable_sheets`, and returns the eligible-to-commit set. No DB
    write, no status change, no parser / parse-eligibility consultation.

    Returns:
      {"committable_sheets": [{"sheet_name": str,
                               "disposition": "general_specs" | "finalized"}, ...]}

    The disposition tells the Slice-3 commit pipeline which write path to use.
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    boq_doc = frappe.get_doc("BOQs", boq_name)

    # General-specs designation = pointer membership in BOQs.general_specs_sheets
    # (NOT wizard_status). Same read pattern assemble_mapping_config uses.
    general_specs_sheet_names: set[str] = {
        row.source_sheet_name
        for row in (boq_doc.general_specs_sheets or [])
        if row.source_sheet_name
    }

    committable = compute_committable_sheets(
        boq_doc.sheet_drafts, general_specs_sheet_names
    )
    return {"committable_sheets": committable}


@frappe.whitelist()
def get_committed_state(boq_name: str) -> dict:
    """
    READ-ONLY. Returns the CURRENT committed-state per sheet for a BoQ, sourced
    from the BoQ Committed Sheet Grid tier.

    The grid tier is the authoritative committed_at source: it is written for BOTH
    dispositions (grid_only general-specs AND grid_and_nodes finalized), it anchors
    the shared commit_version, and the Phase-5 commit pipeline's freeze-and-supersede
    invariant keeps exactly one is_current=1 row per (boq, source_sheet_name). This
    feeds the Slice-4b hub UI (per-sheet "Committed" badge + timestamp, a
    "Committed: N" footer count, and last-committed date/time in the commit modal).

    No DB write, no status change -- a pure read (no set_value / insert / save /
    commit).

    Returns:
      {"committed_state": [
          {"sheet_name": str,                 # source_sheet_name VERBATIM (#152)
           "committed_at": str | None,        # as Frappe returns the Datetime
           "commit_version": int}, ...]}

    One row per sheet is expected (the one-current invariant). The query filters
    is_current=1 and each current row is mapped as-is -- NO dedup logic is added for
    an invariant the pipeline enforces; were it ever violated, a sheet would simply
    appear more than once rather than being silently collapsed.
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    # Current committed grid rows for this BoQ. source_sheet_name is the per-sheet
    # key, matched/returned VERBATIM (#152 -- trailing spaces are significant).
    rows = frappe.get_all(
        "BoQ Committed Sheet Grid",
        filters={"boq": boq_name, "is_current": 1},
        fields=["source_sheet_name", "committed_at", "commit_version"],
    )

    committed_state = [
        {
            "sheet_name": row.source_sheet_name,
            "committed_at": row.committed_at,
            "commit_version": row.commit_version,
        }
        for row in rows
    ]
    return {"committed_state": committed_state}
