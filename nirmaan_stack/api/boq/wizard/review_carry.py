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

What carries (D7): the original's committed human OVERRIDE SET only -- classification override,
a RELATIONAL parent re-point (`parent_node` -> D6 twin -> the twin's fresh `row_index`, NEVER
`sort_order`), and the root override (`-1` written explicitly). `level` is NEVER carried. Every
matched-content row is stamped `revision_carry_status` (Matched/New/Ambiguous/Drifted); a
blank/spacer row and every REMOVED original row are left unstamped (REMOVED has no revised row).
"""

from collections import Counter

import frappe

from nirmaan_stack.services.boq_revision.carry import build_review_carry
from nirmaan_stack.services.boq_revision.normalize import normalize_n2
from nirmaan_stack.services.boq_revision.row_match import REMOVED, MatchRow, match_rows

# Committed BOQ Nodes fields the carry reads. `row_class` is the full taxonomy (never
# `node_type`, a lossy 3-value projection); `parent_node` is the EFFECTIVE parent node name
# (the human's chosen parent when `human_parent >= 0`); `sort_order` is deliberately NOT read
# (it is the ORIGINAL's row_index -- the parent-re-point trap).
_NODE_FIELDS = [
    "name", "source_row_number", "description", "row_class", "level",
    "human_classification", "human_parent", "human_is_root", "parent_node",
]

# Revised review-row fields the match + drift read.
_REVIEW_FIELDS = ["name", "row_index", "source_row_number", "description", "classification", "level"]


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


def merge_revision_review_carry(boq_name: str, sheet_name: str, source_boq: str) -> dict:
    """Merge the original's overrides onto the revision's freshly-parsed review rows (D6/D7).

    Reads the just-inserted `BoQ Review Row`s for (boq_name, sheet_name) -- VERBATIM #152, seen
    uncommitted in the same transaction -- and the original's committed nodes for this sheet's
    mapped source, matches by D6, and applies the D7 override carry + `revision_carry_status`
    stamps via targeted `set_value`s. Returns a summary count dict (for logging / tests).

    A no-op (returns zeros) when the sheet is unmapped or the source has no committed nodes --
    e.g. a general-specs sheet (no review rows) or a declared-New sheet.
    """
    source_sheet_name = _source_sheet_name(boq_name, sheet_name)
    if not source_sheet_name:
        return _summarize({})

    review_rows = frappe.db.get_all(
        "BoQ Review Row",
        filters={"boq": boq_name, "sheet_name": sheet_name},
        fields=_REVIEW_FIELDS,
        order_by="row_index asc",
    )
    if not review_rows:
        return _summarize({})

    nodes = _committed_nodes(source_boq, source_sheet_name)
    if not nodes:
        return _summarize({})

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
    carries = build_review_carry(
        [{"row_id": r.row_index, "classification": r.classification} for r in content_rows],
        {n.name: n for n in nodes},
        match,
    )

    name_by_row_index = {r.row_index: r.name for r in review_rows}
    for row_index, write in carries.items():
        updates: dict = {"revision_carry_status": write.revision_carry_status}
        # Carry only the non-None override fields; leave the fresh-parse defaults otherwise.
        if write.human_classification is not None:
            updates["human_classification"] = write.human_classification
        if write.human_parent is not None:
            updates["human_parent"] = write.human_parent
        if write.human_is_root is not None:
            updates["human_is_root"] = write.human_is_root
        frappe.db.set_value(
            "BoQ Review Row", name_by_row_index[row_index], updates, update_modified=False
        )

    return _summarize(carries, match)


def _summarize(carries: dict, match=None) -> dict:
    """The one place the summary count shape is defined (statuses -> lowercase keys)."""
    counts = Counter(w.revision_carry_status for w in carries.values())
    return {
        "matched": counts.get("Matched", 0),
        "new": counts.get("New", 0),
        "ambiguous": counts.get("Ambiguous", 0),
        "drifted": counts.get("Drifted", 0),
        # REMOVED is an original-side outcome (no revised row to stamp) -- tallied from the match.
        "removed": sum(1 for o in match.original_outcome.values() if o == REMOVED) if match else 0,
    }
