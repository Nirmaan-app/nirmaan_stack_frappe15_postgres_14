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

from dataclasses import dataclass

import frappe

from nirmaan_stack.services.boq_revision.carry import COPIED, decide_review_carry
from nirmaan_stack.services.boq_revision.diagnose import diagnose_sheet
from nirmaan_stack.services.boq_revision.normalize import normalize_n2
from nirmaan_stack.services.boq_revision.reasons import NEEDS_REVIEW
from nirmaan_stack.services.boq_revision.row_match import MatchRow, match_rows

# A removed row's description rides the persisted sheet summary purely to be shown in a warning
# line, and a BoQ description can run to thousands of characters. Truncate for storage -- the
# excel_row beside it is the durable handle if anyone needs the full text.
_SUMMARY_DESC_MAX = 200

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


@dataclass(frozen=True)
class _Loaded:
    """Everything one sheet's merge needs, loaded once.

    Holds the MatchRow lists as well as the raw rows because `diagnose_sheet` re-reads BOTH sides
    to explain the non-matches -- it needs the same primitives the matcher saw, not the DB rows.
    """

    match: object            # RowMatchResult
    content_rows: list       # revised rows with a non-blank description (the carry's input)
    review_rows: list        # every revised row, for the row_index -> docname map
    nodes: list              # the original's committed nodes
    original_rows: list      # MatchRow, original side
    revised_rows: list       # MatchRow, revised side, DOCUMENT order
    positionless_ids: frozenset  # content rows that never reached the matcher (no excel row)


def _load_and_match(boq_name: str, sheet_name: str, source_boq: str):
    """Load the revised review rows + the original's committed nodes and run the match.

    Returns a `_Loaded`, or `None` when there is nothing to match (unmapped sheet / no review rows
    / no committed nodes).

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

    return _Loaded(
        match=match_rows(original_rows, revised_rows),
        content_rows=content_rows,
        review_rows=review_rows,
        nodes=nodes,
        original_rows=original_rows,
        revised_rows=revised_rows,
        # A content row with no `source_row_number` cannot enter the match. Unreachable in
        # production, but it must still be STAMPED -- an unstamped row is invisible to the
        # finalize gate, so a gap here is a row that escapes review entirely.
        positionless_ids=frozenset(
            r.row_index for r in content_rows if r.source_row_number is None
        ),
    )


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

    S2 -- NEEDS REVIEW. Every non-copied CONTENT row is now stamped `Needs Review` with the reason
    code naming why it did not carry (and, for a shifted row, its offset + the block anchor). This
    REVERSES the Amendment B behaviour where a non-copied row was left completely untouched: blank
    no longer means "an ordinary parsed row", it means "not a revision row at all" (upload/template,
    or a spacer). Spacers are still never stamped -- they have nothing to classify, and a stamp
    would put them in front of the reviewer AND into the finalize gate.
    """
    loaded = _load_and_match(boq_name, sheet_name, source_boq)
    if loaded is None:
        return _empty_summary()

    carries, non_carry_reasons = decide_review_carry(
        [{"row_id": r.row_index} for r in loaded.content_rows],
        {n.name: n for n in loaded.nodes},
        loaded.match,
    )
    diagnosis = diagnose_sheet(
        loaded.original_rows,
        loaded.revised_rows,
        loaded.match,
        carried_ids=set(carries),
        non_carry_reasons=non_carry_reasons,
        positionless_ids=loaded.positionless_ids,
    )

    name_by_row_index = {r.row_index: r.name for r in loaded.review_rows}
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

    reason_counts: dict = {}
    for row_index, reason in diagnosis.reasons.items():
        # The needs-review stamp writes NO parser field -- it annotates, it does not decide. The
        # fresh parser's classification and parenting stand exactly as parsed, which is what makes
        # a needs-review row identical to a fresh-upload row apart from the stamp.
        frappe.db.set_value(
            "BoQ Review Row",
            name_by_row_index[row_index],
            {
                "revision_carry_status": NEEDS_REVIEW,
                "revision_review_reason": reason.code,
                "revision_shift_delta": reason.delta,
                "revision_shift_anchor": reason.anchor,
            },
            update_modified=False,
        )
        reason_counts[reason.code] = reason_counts.get(reason.code, 0) + 1

    copied = len(carries)
    needs_review = len(diagnosis.reasons)
    return {
        "copied": copied,
        # `copied + needs_review == total` holds BY CONSTRUCTION here: the taxonomy is total over
        # the content rows, so every one of them lands in exactly one of the two. Deriving total
        # this way (rather than from `match.revised_ids`) also makes it agree with what was
        # actually STAMPED, which is what the SQL read path below later counts.
        "needs_review": needs_review,
        "total": copied + needs_review,
        "reason_counts": reason_counts,
        "change_summary": _change_summary(diagnosis),
    }


def _empty_summary() -> dict:
    """The no-op summary -- an unmapped (declared-New) sheet, or a source with no committed nodes."""
    return {
        "copied": 0, "needs_review": 0, "total": 0,
        "reason_counts": {}, "change_summary": None,
    }


def _change_summary(diagnosis) -> dict | None:
    """The sheet-level event blob for `BoQ Sheet Draft.revision_change_summary`, or None.

    None when there is nothing to say, so a sheet whose rows all carried stores no blob at all.
    Both lists are already capped by `diagnose_sheet`; the true counts ride alongside so the
    warnings panel can say "showing 50 of 312" rather than silently under-reporting.
    """
    if not diagnosis.shift_blocks and not diagnosis.removed_rows:
        return None
    return {
        "shift_blocks": [
            {
                "anchor": b.anchor,
                "delta": b.delta,
                "change": b.change,
                "shifted_count": b.shifted_count,
                "inserted_excel_rows": list(b.inserted_excel_rows),
            }
            for b in diagnosis.shift_blocks
        ],
        "removed_rows": [
            {"excel_row": r.excel_row, "description": (r.description or "")[:_SUMMARY_DESC_MAX]}
            for r in diagnosis.removed_rows
        ],
        "block_count": diagnosis.block_count,
        "removed_count": diagnosis.removed_count,
    }


def revision_review_counts(boq_name: str, sheet_name: str) -> dict:
    """READ-ONLY sheet-level carry counts for the review screen's meta block.

    Derived from the PERSISTED `revision_carry_status`, not by re-running the match -- two cheap
    COUNTs instead of loading both sides of the sheet on every review-screen open. Safe because the
    stamp is written once at parse and nothing downstream mutates it (a human edit layers on top via
    the human fields; it never clears the stamp).

    `total` counts CONTENT rows only, using `TRIM(description) <> ''` -- which is EXACTLY the
    matcher's blank test, because `normalize_n2` can only empty a string that is already
    whitespace-only (collapsing INTERNAL whitespace never empties a non-empty string). A plain
    `description != ''` filter would over-count whitespace-only rows the matcher skipped.

    ⚠️ `needs_review` COUNTS THE STAMP; it is NOT derived as `total - copied` (S2 change). The two
    agree exactly on any sheet parsed since S2, because the taxonomy is total over the content
    rows. They diverge on a sheet parsed BEFORE S2, where non-copied rows carry no stamp -- and
    counting the stamp is the RIGHT answer there: those rows render "Original" and the finalize
    gate (which reads the same stamp) lets them through, so a derived count would be the only
    surface claiming work that nothing else believes in. Display and gate read ONE field
    (ADR-0010 F1); a re-parse stamps the sheet and the numbers converge.

    One raw query rather than three `frappe.db.count` calls: Frappe filters cannot express
    `TRIM(...)`, and this keeps every number from the same snapshot.
    """
    row = frappe.db.sql(
        """
        SELECT
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN revision_carry_status = %(copied)s THEN 1 ELSE 0 END), 0)
                AS copied,
            COALESCE(SUM(CASE WHEN revision_carry_status = %(needs)s THEN 1 ELSE 0 END), 0)
                AS needs_review
        FROM "tabBoQ Review Row"
        WHERE boq = %(boq)s
          AND sheet_name = %(sheet)s
          AND COALESCE(TRIM(description), '') <> ''
        """,
        {"boq": boq_name, "sheet": sheet_name, "copied": COPIED, "needs": NEEDS_REVIEW},
        as_dict=True,
    )
    if not row:
        return {"copied": 0, "needs_review": 0, "total": 0}
    return {
        "copied": int(row[0]["copied"]),
        "needs_review": int(row[0]["needs_review"]),
        "total": int(row[0]["total"]),
    }
