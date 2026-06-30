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


# ── Slice 5b: "pricing changed since last export" staleness signal ────────────────
# The three overlay tiers whose latest write decides staleness, each with its own *_at.
# Reads are scoped to the sheet's CURRENT commit_version (pricing/color/remark identities
# carry committed_version and a record can stay is_current=1 across versions -- an OLD
# version's timestamp must NOT make the CURRENT committed version read stale).
_CHANGE_TIER_FIELDS = (
    ("BoQ Cell Pricing", "priced_at"),
    ("BoQ Cell Color", "colored_at"),
    ("BoQ Cell Remark", "remarked_at"),
)


def _latest_change_by_sheet_version(boq_name: str) -> dict:
    """Return {(sheet_name VERBATIM, committed_version): latest_change_datetime} -- the max
    priced_at/colored_at/remarked_at across the three overlay tiers, grouped per sheet AND
    committed_version (so the caller compares against the sheet's CURRENT version only).
    Three grouped queries total (NOT per-sheet), is_current=1 only."""
    out: dict = {}
    for doctype, field in _CHANGE_TIER_FIELDS:
        rows = frappe.db.sql(
            f"""
            SELECT sheet_name, committed_version, MAX(`{field}`) AS m
            FROM `tab{doctype}`
            WHERE boq=%s AND is_current=1
            GROUP BY sheet_name, committed_version
            """,
            boq_name,
            as_dict=True,
        )
        for r in rows:
            if not r.m:
                continue
            key = (r.sheet_name, r.committed_version)
            if key not in out or r.m > out[key]:
                out[key] = r.m
    return out


def _is_changed_since_export(latest_change, last_exported_at) -> bool:
    """The per-sheet staleness rule (Slice 5b):
      - no pricing/color/remark on the current version    -> False (nothing to export)
      - content exists but never exported                 -> True  (unexported content)
      - latest change is strictly after the last export   -> True
      - last export is at/after the latest change         -> False
    """
    if not latest_change:
        return False
    if not last_exported_at:
        return True
    # Normalize both to datetime -- get_all (Datetime field) and raw-SQL MAX can differ in
    # type across drivers; frappe.utils.get_datetime makes the comparison robust.
    return frappe.utils.get_datetime(latest_change) > frappe.utils.get_datetime(last_exported_at)


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

    sheet_order (Slice 3d -- workbook tab order for the in-editor sheet tabs) is NOT a
    field on the committed-grid tier; it lives on the committed "BoQ Sheet" tier (the
    per-sheet config snapshot the commit pipeline writes for BOTH dispositions, carried
    from the draft). It is sourced here via a lookup keyed by the committed sheet
    identity (boq + sheet_name, is_current=1) and the result is ordered by it ascending.

    Returns:
      {"committed_state": [
          {"sheet_name": str,                 # source_sheet_name VERBATIM (#152)
           "committed_at": str | None,        # as Frappe returns the Datetime
           "commit_version": int,
           "sheet_disposition": str,           # "grid_only" | "grid_and_nodes" (the
                                              # commit-time discriminator)
           "sheet_order": int | None,         # committed BoQ Sheet.sheet_order;
                                              # None if no current BoQ Sheet matches
                                              # (defensive -- in practice every
                                              # committed sheet has one). Result is
                                              # sorted by sheet_order ascending, None
                                              # last, tiebroken by sheet_name.
           "last_exported_at": str | None,    # Slice 5b (ADDITIVE): committed BoQ
                                              # Sheet.last_exported_at; None if never
                                              # exported. Rides the existing BoQ Sheet
                                              # lookup -- no extra query.
           "pricing_changed_since_export": bool}, ...]}  # Slice 5b (ADDITIVE): True iff
                                              # max(priced/colored/remarked _at on the
                                              # CURRENT commit_version) > last_exported_at
                                              # (or content exists + never exported);
                                              # False when nothing priced/colored/remarked.

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
        fields=["source_sheet_name", "committed_at", "commit_version", "sheet_disposition"],
    )

    # sheet_order + last_exported_at are on the committed "BoQ Sheet" tier, not the grid tier.
    # Look them up by the committed sheet identity (boq + sheet_name, is_current=1). sheet_name
    # is the join key, matched VERBATIM (#152). A committed grid row should always have a
    # matching current BoQ Sheet (the pipeline writes both); default None if not.
    # last_exported_at (Slice 5b) rides this SAME existing lookup -- no extra query.
    # is_locked (the deliberate per-sheet read-only lock) rides this SAME existing lookup --
    # one more field, no new query (like last_exported_at). Drives the hub's lock indicator.
    order_rows = frappe.get_all(
        "BoQ Sheet",
        filters={"boq": boq_name, "is_current": 1},
        fields=["sheet_name", "sheet_order", "last_exported_at", "is_locked"],
    )
    order_by_sheet = {r.sheet_name: r.sheet_order for r in order_rows}
    exported_by_sheet = {r.sheet_name: r.last_exported_at for r in order_rows}
    locked_by_sheet = {r.sheet_name: bool(r.is_locked) for r in order_rows}

    # Slice 5b -- the "pricing changed since last export" signal. Per (sheet, current version),
    # the latest pricing/color/remark write timestamp; compared per row against last_exported_at.
    changes_by_sheet_version = _latest_change_by_sheet_version(boq_name)

    committed_state = [
        {
            "sheet_name": row.source_sheet_name,
            "committed_at": row.committed_at,
            "commit_version": row.commit_version,
            "sheet_order": order_by_sheet.get(row.source_sheet_name),
            # The explicit grid_only / grid_and_nodes discriminator (set at commit; general
            # specs -> grid_only, finalized -> grid_and_nodes). Surfaced so the pricing editor
            # can fork a grid-only sheet to a read-only faithful-grid view (no node-based grid).
            "sheet_disposition": row.sheet_disposition,
            # Slice 5b additive fields (existing keys above are UNCHANGED):
            "last_exported_at": exported_by_sheet.get(row.source_sheet_name),
            "pricing_changed_since_export": _is_changed_since_export(
                changes_by_sheet_version.get((row.source_sheet_name, row.commit_version)),
                exported_by_sheet.get(row.source_sheet_name),
            ),
            # Deliberate per-sheet read-only lock (this slice, ADDITIVE):
            "is_locked": locked_by_sheet.get(row.source_sheet_name, False),
        }
        for row in rows
    ]
    # Workbook order: by sheet_order ascending. A row with no matching committed BoQ
    # Sheet (sheet_order None) sorts LAST, tiebroken by sheet_name for a stable order.
    committed_state.sort(
        key=lambda e: (e["sheet_order"] is None, e["sheet_order"] or 0, e["sheet_name"])
    )
    return {"committed_state": committed_state}


@frappe.whitelist()
def get_sheet_versions(boq_name: str = None, sheet_name: str = None) -> dict:
    """READ-ONLY. List every committed version of ONE sheet for the version-view dropdown
    (Phase 5 version-view). The version SOURCE-OF-TRUTH is the committed GRID tier
    (BoQ Committed Sheet Grid) -- the existing "what versions exist" authority: it is written for
    BOTH dispositions, so it covers a grid-only sheet the node tier lacks AND a version the node
    tier is missing (the two tiers can carry different version sets). Each version carries its
    last-pricing-change datetime (max priced/colored/remarked_at on that version, REUSING
    _latest_change_by_sheet_version -- one grouped call, no version filter, returns every version)
    so the dropdown can label an earlier version by its last edit; a committed-but-never-priced
    version has last_change_at=None and the client falls back to committed_at with a "never priced"
    affordance (a COMMON case, not an edge). sheet_name VERBATIM (#152). Sorted version-DESC.

    No DB write -- a pure read (no set_value / insert / save / commit).

    Returns:
      {"versions": [{"commit_version": int,
                     "is_current": bool,
                     "committed_at": str | None,
                     "sheet_disposition": "grid_only" | "grid_and_nodes",
                     "last_change_at": str | None}, ...]}  # version-desc
    URL: /api/method/nirmaan_stack.api.boq.wizard.commit_gate.get_sheet_versions
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    # Every committed grid row for this sheet across versions (one per version -- the pipeline's
    # freeze-and-supersede mints exactly one grid row per commit_version). source_sheet_name is the
    # per-sheet key, matched VERBATIM (#152).
    grid_rows = frappe.get_all(
        "BoQ Committed Sheet Grid",
        filters={"boq": boq_name, "source_sheet_name": sheet_name},
        fields=["commit_version", "is_current", "committed_at", "sheet_disposition"],
    )

    # Last pricing/color/remark change per (sheet, version) -- the dropdown's earlier-version label.
    # Reused as-is from the Slice-5b staleness signal; keyed (sheet_name VERBATIM, version).
    changes = _latest_change_by_sheet_version(boq_name)

    versions = [
        {
            "commit_version": r.commit_version,
            "is_current": bool(r.is_current),
            "committed_at": r.committed_at,
            "sheet_disposition": r.sheet_disposition,
            "last_change_at": changes.get((sheet_name, r.commit_version)),
        }
        for r in grid_rows
    ]
    versions.sort(key=lambda v: v["commit_version"], reverse=True)
    return {"versions": versions}
