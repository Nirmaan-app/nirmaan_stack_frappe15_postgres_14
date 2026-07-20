"""S5a/S6 (#1102, ADR-0014 D6/D7 + **Amendment B**) -- the post-parse review-carry MERGE.

Impure orchestrator. Split from `parse_run` (which stays the parse worker) so each module changes
for one reason. The PURE decisions live in `services/boq_revision/row_match.py` (the match) and
`.../carry.py` (the payload); this module reads the committed tier + the revised review rows, hands
the primitives to them, and applies the writes.

The merge runs at the D7 seam -- inside `_run_parse_worker`'s per-sheet `try`, AFTER the review-row
insert loop and BEFORE `_set_draft_status(..., "Parsed")` -- ONLY for a revision sheet. A
non-revision parse never calls in here, so it stays byte-identical. The seam's existing compensating
delete + "Insert error" failure channel already isolate a merge that raises (the whole per-sheet
write rolls back).

WHAT CARRIES (Amendment B, 2026-07-20): a row copies the original's committed EFFECTIVE
classification AND parenting **together**, into the revision's PARSER layer, iff it sits at the SAME
Excel row with the SAME description AND its parent does too. `row_class` -> `classification`, and a
RELATIONAL parent re-point `parent_node` -> twin -> the twin's fresh `row_index` (NEVER `sort_order`)
-> `parent_index`, with `-1` for an effective root. Everything else is left alone and renders
"Original". Full rationale in the two pure modules' docstrings.

`level` is NEVER carried. Only copied rows are stamped (`revision_carry_status = "Copied"`); every
other row -- unmatched, blank, spacer -- is left completely untouched, which is what makes a
non-copied row indistinguishable from a fresh-upload row.
"""

import frappe

from nirmaan_stack.services.boq_revision.carry import COPIED, build_review_carry
from nirmaan_stack.services.boq_revision.normalize import normalize_n2
from nirmaan_stack.services.boq_revision.row_match import MatchRow, match_rows

# Committed BOQ Nodes fields the carry reads. Both carried fields are the EFFECTIVE values commit
# folded down (human > AI-accepted > parser): `row_class` is the full taxonomy (never `node_type`, a
# lossy 3-value projection) and `parent_node` is the effective parent node name (NULL = effective
# root). The `human_*` fields are deliberately NOT read -- they hold only the manually-typed layer and
# miss every AI-accepted decision. `sort_order` is deliberately NOT read (it is the ORIGINAL's
# row_index -- the parent-re-point trap). `level` is deliberately NOT read -- Amendment B bars it from
# the matcher, which is what makes the parse-seam and committed-tier runs provably identical.
_NODE_FIELDS = ["name", "source_row_number", "description", "row_class", "parent_node"]

# Revised review-row fields the match reads.
_REVIEW_FIELDS = ["name", "row_index", "source_row_number", "description"]


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
    """The original committed sheet this revision draft maps to (D3's write-once pointer), or None
    for an unmapped (declared-New) sheet -- which carries nothing."""
    return frappe.db.get_value(
        "BoQ Sheet Draft",
        {"parent": boq_name, "parenttype": "BOQs", "sheet_name": sheet_name},
        "source_sheet_name",
    )


def _committed_nodes(source_boq: str, source_sheet_name: str) -> list:
    """The original's CURRENT committed nodes for the mapped source sheet, in physical order.

    Joins through the committed `BoQ Sheet` (BOQ Nodes address the sheet by its Link, not by a
    verbatim name). Returns [] when there is no current committed sheet (defensive -- an eligible
    source always has one, but a mid-flight re-commit could momentarily not).
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
    """Load the revised review rows + the original's committed nodes and run the match.

    Returns `(match, content_rows, review_rows, nodes)`, or `None` when there is nothing to match
    (unmapped sheet / no review rows / no committed nodes).

    `row_id` differs per side ON PURPOSE: the original side uses the committed node NAME so that
    `parent_node` indexes the twin map directly (a one-hop relational parent re-point), while the
    revised side uses `row_index` because that is what `parent_index` must point at.
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
    # carries nothing and gets no stamp. The matcher skips blanks defensively too.
    content_rows = [r for r in review_rows if normalize_n2(r.description)]
    original_rows = [
        MatchRow(row_id=n.name, excel_row=n.source_row_number,
                 description=n.description or "")
        for n in nodes
        if n.source_row_number is not None and normalize_n2(n.description)
    ]
    revised_rows = [
        MatchRow(row_id=r.row_index, excel_row=r.source_row_number,
                 description=r.description or "")
        for r in content_rows
        if r.source_row_number is not None
    ]

    match = match_rows(original_rows, revised_rows)
    return match, content_rows, review_rows, nodes


def merge_revision_review_carry(boq_name: str, sheet_name: str, source_boq: str) -> dict:
    """Merge the original's EFFECTIVE classification + parenting onto the revision's freshly-parsed
    review rows (Amendment B).

    Reads the just-inserted `BoQ Review Row`s for (boq_name, sheet_name) -- VERBATIM #152, seen
    uncommitted in the same transaction -- and the original's committed nodes for this sheet's mapped
    source, matches on Excel position + description, and applies the carry + `Copied` stamps via
    targeted `set_value`s. Returns a summary count dict (for the parse-completion report and tests).

    The writes land in the PARSER layer (`classification` / `parent_index`), NOT the human layer: a
    copied row's parse baseline for this revision IS the original's accepted answer. It therefore
    renders "Original" (calm), keeps `has_override` false so Apply-AI stays available, and sidesteps
    the `_ASSIGNABLE_CLASSIFICATIONS` limit that forbids writing `subtotal_marker` / `header_repeat`
    to `human_classification`. `update_modified=False` + no `edit_log` entry keeps the row un-"Edited".

    A no-op (returns zeros) when the sheet is unmapped or the source has no committed nodes -- e.g. a
    general-specs sheet (no review rows) or a declared-New sheet.
    """
    loaded = _load_and_match(boq_name, sheet_name, source_boq)
    if loaded is None:
        return {"copied": 0, "needs_review": 0, "total": 0}
    match, content_rows, review_rows, nodes = loaded

    carries = build_review_carry(
        [{"row_id": r.row_index} for r in content_rows],
        {n.name: n for n in nodes},
        match,
    )

    name_by_row_index = {r.row_index: r.name for r in review_rows}
    for row_index, write in carries.items():
        # Both payload fields are always present (both-or-neither) -- there is no partial write.
        frappe.db.set_value(
            "BoQ Review Row",
            name_by_row_index[row_index],
            {
                "revision_carry_status": write.revision_carry_status,
                "classification": write.classification,
                "parent_index": write.parent_index,
            },
            update_modified=False,
        )

    total = len(match.revised_ids)
    copied = len(carries)
    return {"copied": copied, "needs_review": total - copied, "total": total}


def revision_review_counts(boq_name: str, sheet_name: str) -> dict:
    """READ-ONLY sheet-level carry counts for the review screen's meta block.

    Derived from the PERSISTED `revision_carry_status`, not by re-running the match -- two cheap
    COUNTs instead of loading both sides of the sheet on every review-screen open. Safe because the
    stamp is written once at parse and nothing downstream mutates it (a human edit layers on top via
    the human fields; it never clears the stamp).

    `total` counts CONTENT rows only, using `TRIM(description) <> ''` -- which is EXACTLY the
    matcher's blank test, because `normalize_n2` can only empty a string that is already
    whitespace-only (collapsing INTERNAL whitespace never empties a non-empty string). A plain
    `description != ''` filter would over-count whitespace-only rows the matcher skipped, so
    `copied + needs_review == total` would stop holding.

    One raw query rather than two `frappe.db.count` calls: Frappe filters cannot express `TRIM(...)`,
    and this keeps both numbers from the same snapshot.
    """
    row = frappe.db.sql(
        """
        SELECT
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN revision_carry_status = %(copied)s THEN 1 ELSE 0 END), 0) AS copied
        FROM "tabBoQ Review Row"
        WHERE boq = %(boq)s
          AND sheet_name = %(sheet)s
          AND COALESCE(TRIM(description), '') <> ''
        """,
        {"boq": boq_name, "sheet": sheet_name, "copied": COPIED},
        as_dict=True,
    )
    total = int(row[0]["total"]) if row else 0
    copied = int(row[0]["copied"]) if row else 0
    return {"copied": copied, "needs_review": total - copied, "total": total}
