"""S5a/S6 (#1102, ADR-0014 D6/D7) -- the post-parse review-carry MERGE, impure orchestrator.

Split from `parse_run` (which stays the parse worker) so each module changes for one reason.
The PURE decisions live in `services/boq_revision/row_match.py` (D6 match) and `.../carry.py`
(D7 override payload); this module reads the committed tier + the revised review rows, hands
the primitives to them, and applies the writes.

The merge runs at the D7 seam -- inside `_run_parse_worker`'s per-sheet `try`, AFTER the
review-row insert loop and BEFORE `_set_draft_status(..., "Parsed")` -- ONLY for a revision
sheet. A non-revision parse never calls in here, so it stays byte-identical. The seam's
existing compensating delete + "Insert error" failure channel already isolate a merge that
raises (the whole per-sheet write rolls back).

What carries (owner amendment 2026-07-20, superseding D7's "override set only"): the original's
committed EFFECTIVE classification + parenting, written into the revision's PARSER layer --
`row_class` -> `classification`, and a RELATIONAL parent re-point `parent_node` -> D6 twin ->
the twin's fresh `row_index` (NEVER `sort_order`) -> `parent_index`, with `-1` for an effective
root. Reading the human layer instead was PROVABLY LOSSY: commit folds an accepted AI suggestion
into `row_class`/`parent_node` and leaves `human_*` empty, so every AI-accepted decision was
silently dropped. Full rationale in `services/boq_revision/carry.py`'s docstring.

`level` is NEVER carried. Every matched-content row is stamped `revision_carry_status`
(Matched/New/Ambiguous -- `Drifted` is RETIRED, the effective carry closes the hole it flagged);
a blank/spacer row and every REMOVED original row are left unstamped (REMOVED has no revised row).
"""

from collections import Counter

import frappe

from nirmaan_stack.services.boq_revision.carry import build_review_carry
from nirmaan_stack.services.boq_revision.normalize import normalize_n2
from nirmaan_stack.services.boq_revision.row_match import REMOVED, MatchRow, match_rows

# Committed BOQ Nodes fields the carry reads. Both carried fields are the EFFECTIVE values
# commit folded down (human > AI-accepted > parser): `row_class` is the full taxonomy (never
# `node_type`, a lossy 3-value projection) and `parent_node` is the effective parent node name
# (NULL = effective root). The `human_*` fields are deliberately NOT read -- they hold only the
# manually-typed layer and miss every AI-accepted decision. `sort_order` is deliberately NOT read
# (it is the ORIGINAL's row_index -- the parent-re-point trap).
_NODE_FIELDS = ["name", "source_row_number", "description", "row_class", "level", "parent_node"]

# Revised review-row fields the match reads.
_REVIEW_FIELDS = ["name", "row_index", "source_row_number", "description", "level"]


def revision_source_boq(boq_name: str) -> str | None:
    """The original BOQs this doc revises, or None when this is not a revision doc.

    A read once per parse worker: `origin == "revision"` AND `source_boq` set. Any other origin
    (upload / template) returns None -> the merge seam is skipped and the parse is byte-identical.
    """
    meta = frappe.db.get_value("BOQs", boq_name, ["origin", "source_boq"], as_dict=True)
    if meta and meta.origin == "revision" and meta.source_boq:
        return meta.source_boq
    return None


def _source_sheet_name(boq_name: str, sheet_name: str) -> str | None:
    """The original committed sheet this revision draft maps to (D3's write-once pointer), or
    None for an unmapped (declared-New) sheet -- which carries nothing."""
    return frappe.db.get_value(
        "BoQ Sheet Draft",
        {"parent": boq_name, "parenttype": "BOQs", "sheet_name": sheet_name},
        "source_sheet_name",
    )


def _committed_nodes(source_boq: str, source_sheet_name: str) -> list:
    """The original's CURRENT committed nodes for the mapped source sheet, in physical order.

    Joins through the committed `BoQ Sheet` (BOQ Nodes address the sheet by its Link, not by a
    verbatim name). Returns [] when there is no current committed sheet (defensive -- an
    eligible source always has one, but a mid-flight re-commit could momentarily not).
    """
    committed_sheet = frappe.db.get_value(
        "BoQ Sheet",
        {"boq": source_boq, "sheet_name": source_sheet_name, "is_current": 1},
        "name",
    )
    if not committed_sheet:
        return []
    return frappe.db.get_all(
        "BOQ Nodes",
        filters={"boq": source_boq, "sheet": committed_sheet, "is_current": 1},
        fields=_NODE_FIELDS,
        order_by="sort_order asc",
    )


def _load_and_match(boq_name: str, sheet_name: str, source_boq: str):
    """Load the revised review rows + the original's committed nodes and run the D6 match.

    Returns `(match, content_rows, review_rows, nodes)`, or `None` when there is nothing to match
    (unmapped sheet / no review rows / no committed nodes). The SINGLE place the match inputs are
    built -- shared by the parse-time write merge and the read-time removed-advisory helper so the
    D6 match is defined exactly once (no forked MatchRow construction).
    """
    source_sheet_name = _source_sheet_name(boq_name, sheet_name)
    if not source_sheet_name:
        return None

    review_rows = frappe.db.get_all(
        "BoQ Review Row",
        filters={"boq": boq_name, "sheet_name": sheet_name},
        fields=_REVIEW_FIELDS,
        order_by="row_index asc",
    )
    if not review_rows:
        return None

    nodes = _committed_nodes(source_boq, source_sheet_name)
    if not nodes:
        return None

    # Content rows only (non-blank N2 description). A blank/spacer row is never matched -- it
    # carries nothing and gets no stamp (the calm default). One filter, one normalizer pass.
    content_rows = [r for r in review_rows if normalize_n2(r.description)]
    original_rows = [
        MatchRow(row_id=n.name, description=n.description or "",
                 order=n.source_row_number or 0, level=n.level)
        for n in nodes if normalize_n2(n.description)
    ]
    revised_rows = [
        MatchRow(row_id=r.row_index, description=r.description or "",
                 order=r.source_row_number or 0, level=r.level)
        for r in content_rows
    ]

    match = match_rows(original_rows, revised_rows)
    return match, content_rows, review_rows, nodes


def _build_carries(loaded):
    """Run the pure carry over a `_load_and_match` result. The ONE construction site, shared by
    the parse-time write merge and the read-time advisory helper so the two can never disagree."""
    match, content_rows, _review_rows, nodes = loaded
    return build_review_carry(
        [{"row_id": r.row_index} for r in content_rows],
        {n.name: n for n in nodes},
        match,
    )


def merge_revision_review_carry(boq_name: str, sheet_name: str, source_boq: str) -> dict:
    """Merge the original's EFFECTIVE classification + parenting onto the revision's freshly-parsed
    review rows (D6 + the 2026-07-20 owner amendment).

    Reads the just-inserted `BoQ Review Row`s for (boq_name, sheet_name) -- VERBATIM #152, seen
    uncommitted in the same transaction -- and the original's committed nodes for this sheet's
    mapped source, matches by D6, and applies the carry + `revision_carry_status` stamps via
    targeted `set_value`s. Returns a summary count dict (for logging / tests).

    The writes land in the PARSER layer (`classification` / `parent_index`), NOT the human layer:
    a matched row's parse baseline for this revision IS the original's accepted answer. It
    therefore renders "Original" (calm), keeps `has_override` false so Apply-AI stays available,
    and sidesteps the `_ASSIGNABLE_CLASSIFICATIONS` limit that forbids writing `subtotal_marker` /
    `header_repeat` to `human_classification`. `update_modified=False` + no `edit_log` entry keeps
    the row un-"Edited".

    A no-op (returns zeros) when the sheet is unmapped or the source has no committed nodes --
    e.g. a general-specs sheet (no review rows) or a declared-New sheet.
    """
    loaded = _load_and_match(boq_name, sheet_name, source_boq)
    if loaded is None:
        return _summarize({})
    match, _content_rows, review_rows, _nodes = loaded

    carries = _build_carries(loaded)

    name_by_row_index = {r.row_index: r.name for r in review_rows}
    for row_index, write in carries.items():
        updates: dict = {"revision_carry_status": write.revision_carry_status}
        # Carry only the non-None fields; leave the fresh-parse values otherwise (a parent that
        # could not be re-pointed keeps the fresh parser's parent -- see `parent_lost`).
        if write.classification is not None:
            updates["classification"] = write.classification
        if write.parent_index is not None:
            updates["parent_index"] = write.parent_index
        frappe.db.set_value(
            "BoQ Review Row", name_by_row_index[row_index], updates, update_modified=False
        )

    return _summarize(carries, match)


def revision_review_advisories(
    boq_name: str, sheet_name: str, source_boq: str
) -> dict[str, list[str]]:
    """The TWO muted panel advisories for the revision review screen, from ONE match pass:

      removed     -- descriptions of the original's committed CONTENT rows with NO match in this
                     revision (D6 REMOVED), physical order.
      parent_lost -- descriptions of MATCHED revised rows whose original parent has no twin here,
                     so the carried parenting could not be re-pointed and the row keeps the fresh
                     parser's parent.

    READ-ONLY -- runs the match + the PURE carry, never a write. Both sets are recomputed on READ
    (deliberately NOT persisted like the per-row `revision_carry_status`) and both are STABLE,
    because they depend only on row DESCRIPTIONS, which are immutable after parse (only
    classification / parent / annotations / numeric values are editable). This is the precise
    reason the per-row carry STATUS cannot be recomputed on read -- that one shifts as the human
    edits the revision -- while these two safely can.

    Owner decision 2026-07-20: BOTH stay muted panel lines, never row badges.
    """
    loaded = _load_and_match(boq_name, sheet_name, source_boq)
    if loaded is None:
        return {"removed": [], "parent_lost": []}
    match, content_rows, _review_rows, nodes = loaded

    removed = [
        (n.description or "")
        for n in nodes
        if match.original_outcome.get(n.name) == REMOVED
    ]

    carries = _build_carries(loaded)
    lost_row_indexes = {rid for rid, w in carries.items() if w.parent_lost}
    parent_lost = [
        (r.description or "") for r in content_rows if r.row_index in lost_row_indexes
    ]
    return {"removed": removed, "parent_lost": parent_lost}


def _summarize(carries: dict, match=None) -> dict:
    """The one place the summary count shape is defined (statuses -> lowercase keys)."""
    counts = Counter(w.revision_carry_status for w in carries.values())
    return {
        "matched": counts.get("Matched", 0),
        "new": counts.get("New", 0),
        "ambiguous": counts.get("Ambiguous", 0),
        # A MATCHED row whose original parent had no twin -- the parenting could not be
        # re-pointed. Surfaced as a muted advisory, never a per-row status.
        "parent_lost": sum(1 for w in carries.values() if w.parent_lost),
        # REMOVED is an original-side outcome (no revised row to stamp) -- tallied from the match.
        "removed": sum(1 for o in match.original_outcome.values() if o == REMOVED) if match else 0,
    }
