"""What moves between two COMMITTED sheets of a revision chain (ADR-0014, Amendment D).

Two things live here, and neither of them is row content:

  1. `stamp_revision_provenance` -- the D2 provenance triple (source_boq / source_commit_version /
     source_sheet_name) stamped on a revision's freshly committed `BoQ Sheet`. This is **all** a
     commit does for a revision.
  2. `committed_excel_row_match` -- the shared committed-tier D6 row match between two committed
     sheets, keyed by the durable Excel address. The rate carry in `cross_boq_carry` is its only
     production consumer.

⚠️ AMENDMENT D (2026-07-23, owner-directed) REVERSES AMENDMENT C's annotation carry.
**The per-sheet carry now moves RATES AND NOTHING ELSE.**

Amendment C had moved four ROW-ADDRESSED annotation layers (remark / colour / `remark` dismissal /
category) out of the commit seam and into the explicit per-sheet "Carry rates from original" action,
where the user picked them per layer with a Keep/Overwrite decision. That whole layer engine --
`LAYER_KEYS`, `_AnnotLayer`, `_ANNOT_LAYERS`, `_CarryCtx`, `build_carry_ctx`, `carry_layers`,
`plan_layer_counts`, `_walk_layers`, `_walk_annot_layer`, `_walk_category_layer` and the dest
column/version index helpers -- is DELETED, along with the `layers` parameter on
`apply_sheet_carry` and the `layers` block on `get_cross_boq_carry_plan`.

Why it is a deletion and not a feature flag: the annotations were arriving on the revision
un-asked-for and un-attributed. A carried remark is indistinguishable in the Review block from one
the user wrote on this revision (it renders as the same grey `Note` entry), so the carry silently
grew the revision's review list with the original author's text -- and with Overwrite armed it
superseded the user's own remark at the same row. Every one of these layers still has a first-class
write path in the pricing editor; only the cross-BoQ COPY of them is gone.

What is deliberately NOT affected:
  * `BoQ Cell Remark` / `BoQ Cell Color` / `BoQ Cell Dismissal` / `BoQ Row Category` keep their own
    endpoints and their own freeze-and-supersede lifecycles. No schema change, no migration.
  * Annotations ALREADY carried by an Amendment C build stay exactly where they are -- they are
    committed records now, and removing the feature does not retroactively un-write them.
  * FORMULAS never carried in either seam and still do not. They are hand-declared per sheet, and
    `_sheet_formulas_complete` remains the gate on the whole per-sheet carry action.
"""

import frappe

from nirmaan_stack.api.boq.wizard.review_carry import (
    _source_sheet_name,
    revision_source_boq,
)
from nirmaan_stack.services.boq_revision.normalize import normalize_n2
from nirmaan_stack.services.boq_revision.row_match import MatchRow, match_rows

_BOQ_SHEET = "BoQ Sheet"
_NODE = "BOQ Nodes"

# Committed BOQ Nodes fields the excel-row twin map reads (both sides). source_row_number = the
# durable Excel address; description feeds the pure D6 match.
_NODE_MATCH_FIELDS = ["source_row_number", "description", "level"]


def stamp_revision_provenance(
    boq_name: str, sheet_name: str, dest_sheet_docname: str,
) -> int:
    """Stamp the D2 provenance triple on a revision sheet's freshly committed `BoQ Sheet`.
    Returns 1 when stamped, 0 for a non-revision / unmapped / no-source sheet.

    ⚠️ AMENDMENT C (C5): this used to be `carry_commit_overlay`, which ALSO carried five layers
    (formula / remark / colour / `remark` dismissal / category) silently at commit. **A revision
    commit carries NOTHING.** Amendment D then removed the annotation carry from the per-sheet
    action too, so no seam anywhere copies row content between a revision and its original except
    the rates (`cross_boq_carry.apply_sheet_carry`).

    **The stamp itself MUST stay.** `cross_boq_carry._resolve_sheet_carry` reads `source_sheet_name`
    off this row to find the source at all -- it is sheet-level IDENTITY, not row information, so it
    is not part of what "carries". It is written with `set_value(update_modified=False)`, never
    `doc.save` (the list-JSON `area_dimensions` wall on BoQ Sheet).
    """
    source_boq = revision_source_boq(boq_name)
    if not source_boq:
        return 0

    source_sheet_name = _source_sheet_name(boq_name, sheet_name)
    if not source_sheet_name:
        return 0  # a declared-New sheet has no source

    src = frappe.db.get_value(
        _BOQ_SHEET,
        {"boq": source_boq, "sheet_name": source_sheet_name, "is_current": 1},
        ["name", "commit_version"],
        as_dict=True,
    )
    if not src:
        return 0  # the source sheet has no current committed version

    frappe.db.set_value(
        _BOQ_SHEET, dest_sheet_docname,
        {
            "source_boq": source_boq,
            "source_commit_version": src.commit_version,
            "source_sheet_name": source_sheet_name,
        },
        update_modified=False,
    )
    return 1


# ---------------------------------------------------------------------------
# Excel-row twin map (pure D6 re-derivation)
# ---------------------------------------------------------------------------


def committed_excel_row_match(source_boq, source_sheet_docname, dest_boq, dest_sheet_docname):
    """The SHARED committed-tier D6 match between two committed sheets, keyed by the durable Excel
    address (source_row_number) on each side. Returns the full `RowMatchResult` -- the twin map
    (`original_to_revised`: source excel_row -> dest excel_row) PLUS the per-source-row outcome
    (`original_outcome`). The single owner of "match two committed sheets by row"; since Amendment D
    its one production consumer is the cross-BOQ RATE carry, which needs the outcome too to split
    its skip taxonomy. One matcher, no duplicate -- the plan the human reviewed and the plan apply
    enforces stay derivable from the same call.

    Reads BOTH sides' committed `BOQ Nodes` and re-runs the certified pure `match_rows`
    (Amendment B: same Excel row + same description, each position unique per side).

    ⚠️ This run is now PROVABLY IDENTICAL to the parse-seam run in `review_carry.py`. Under the old
    description-bucket key the two could legitimately disagree -- this side fed the committed
    ADR-0009 EFFECTIVE `level` while the parse side fed the parser-native `level`, and a human
    re-parent between review and commit moved one and not the other. Amendment B bars `level` from
    the matcher entirely, and both remaining inputs (`source_row_number`, `description`) are
    immutable after parse and are not functions of the tree. That equivalence is exactly what lets
    the committed tier RE-DERIVE the copied set with no new schema -- so never reintroduce a
    tree-derived input here. Only matched pairs appear in the twin map; an unmatched row is absent."""
    orig = _match_rows_from_nodes(source_boq, source_sheet_docname)
    rev = _match_rows_from_nodes(dest_boq, dest_sheet_docname)
    return match_rows(orig, rev)


def _excel_twin_map(source_boq, source_sheet_docname, dest_boq, dest_sheet_docname) -> dict:
    """source excel_row -> dest excel_row for MATCHED content rows -- the twin-map projection of
    `committed_excel_row_match`. Production callers build from a match they already hold
    (`cross_boq_carry`), so this is the convenience form the tests drive the matcher through."""
    return committed_excel_row_match(
        source_boq, source_sheet_docname, dest_boq, dest_sheet_docname
    ).original_to_revised


def _match_rows_from_nodes(boq, sheet_docname) -> list:
    """Build the pure `MatchRow` list from one side's committed content nodes (non-blank N2
    description, keyed by source_row_number = the durable Excel address)."""
    nodes = frappe.db.get_all(
        _NODE,
        filters={"boq": boq, "sheet": sheet_docname, "is_current": 1},
        fields=_NODE_MATCH_FIELDS,
    )
    return [
        MatchRow(
            row_id=n.source_row_number,
            excel_row=n.source_row_number,
            description=n.description or "",
        )
        for n in nodes
        if n.source_row_number is not None and normalize_n2(n.description)
    ]
