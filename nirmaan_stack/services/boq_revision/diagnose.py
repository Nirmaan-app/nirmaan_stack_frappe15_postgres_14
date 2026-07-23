"""Why a revision row did not carry -- pure, no Frappe imports (ADR-0010 B1).

`match_rows` answers "did this row pair?" and nothing else. `carry.py` answers "did the pair
produce a payload?". Neither can say WHY a row failed, because the reason lives in the relationship
between the two sheets: a row that did not pair may have been inserted, may have merely moved
because something above it was inserted, or may have been reworded in place. This module is that
explanation.

⚠️ READ THIS BEFORE CHANGING ANYTHING -- the D6 boundary.
`row_match.py:42` carries an owner-locked instruction: *"Do not 'improve' this back toward a diff
or a walk."* This module IS a diff by another name, and it stays legal only because of where it
sits:

  * it runs AFTER the match, over rows that ALREADY failed it;
  * it produces NO pairs, and nothing it computes is fed back into `build_review_carry`;
  * the set of copied rows is byte-identical with or without this module.

It changes what the screen SAYS, never what carries. If a future change makes a diagnosis
influence the carry, that is the forbidden thing and needs the owner, not a refactor.

THE SHAPE OF THE PROBLEM. An insertion and an in-place rewording look IDENTICAL at the edited row
-- both are "text here is not what it was". What tells them apart is what happens BELOW: after a
real insertion every row shifts, so the count of shifted rows' offset IS the count of rows
inserted. That is why the classification runs in passes rather than row-by-row: a row's reason
depends on a block that starts below it.

    pass 1  per-row: shifted (offset resolved) / duplicate / unresolved / matched
    pass 2  group consecutive equal-offset shifted rows into blocks
    pass 3  a block of offset +N claims the N unresolved rows immediately above it as INSERTED
    pass 4  every remaining unresolved row: new content if the original had nothing at this
            position, otherwise a description change
    pass 5  original-side rows that vanished entirely -> the removed list

`row_match.py` is deliberately NOT modified: `committed_carry.py` shares `match_rows`, and keeping
that call site byte-identical is worth more than the small duplication of re-deriving the position
indexes here.
"""

from dataclasses import dataclass, field

from nirmaan_stack.services.boq_revision.normalize import normalize_n2
from nirmaan_stack.services.boq_revision.reasons import (
    DESCRIPTION_CHANGED,
    DUPLICATE_POSITION,
    NO_EXCEL_POSITION,
    POSITION_SHIFTED,
    ROW_INSERTED,
)
from nirmaan_stack.services.boq_revision.row_match import RowMatchResult

# Cap on the sheet-level lists that get persisted as a JSON blob on the sheet draft. A wholesale
# rewrite could otherwise produce thousands of removed rows and bloat a child-table column. The
# TRUE counts are reported separately, so the summary never lies about scale -- it only stops
# enumerating (the "no silent caps" rule: what was dropped is always visible in the count).
MAX_SUMMARY_ITEMS = 50


@dataclass(frozen=True)
class RowReason:
    """One revised row's diagnosis.

    `delta` and `anchor` use 0 as "not applicable", which is unambiguous here in a way the -1
    sentinels elsewhere in this codebase are not: a real shift can never have offset 0 (offset 0
    means same position, which means the row would have MATCHED), and Excel rows are 1-based, so
    no real anchor is 0 either. Frappe coerces an unset Int to 0, so the stored default already
    reads as "n/a" with no extra write.
    """

    code: str
    delta: int = 0
    anchor: int = 0


@dataclass(frozen=True)
class ShiftBlock:
    """One insertion or deletion, with its blast radius.

    Keyed by `(anchor, delta)`, not `anchor` alone: two blocks can in principle resolve to the same
    anchor with different offsets, and the bulk-affirm endpoint addresses a block by the pair.

    `delta` vs `change` is the load-bearing distinction on a sheet with more than one edit. `delta`
    is CUMULATIVE -- how far these rows sit from where they started, counting every edit above them
    -- and it is what gets stamped on the rows and keys the block. `change` is LOCAL: what happened
    at THIS anchor, which is the cumulative offset minus the one already in force above it. On a
    sheet with a single edit they are equal, which is exactly why a one-edit fixture cannot catch a
    mistake here.
    """

    anchor: int                 # the revised Excel row where the change begins
    delta: int                  # CUMULATIVE offset: > 0 pushed down, < 0 pulled up
    change: int                 # LOCAL: +N rows inserted here, -N rows deleted here
    shifted_count: int          # collateral rows below it that could not carry
    inserted_excel_rows: tuple = field(default_factory=tuple)  # empty for a deletion


@dataclass(frozen=True)
class RemovedRow:
    """An original content row whose text is nowhere in the revision."""

    excel_row: int
    description: str


@dataclass(frozen=True)
class SheetDiagnosis:
    reasons: dict               # revised row_id -> RowReason (copied rows are ABSENT)
    shift_blocks: tuple         # ShiftBlock, capped at MAX_SUMMARY_ITEMS
    removed_rows: tuple         # RemovedRow, capped at MAX_SUMMARY_ITEMS
    block_count: int            # TRUE count before the cap
    removed_count: int          # TRUE count before the cap


def _position_counts(rows) -> dict:
    """{excel_row -> how many CONTENT rows sit there} for one side."""
    counts: dict = {}
    for r in rows:
        if not normalize_n2(r.description):
            continue
        counts[r.excel_row] = counts.get(r.excel_row, 0) + 1
    return counts


def _description_index(rows) -> dict:
    """{normalized description -> [excel positions]} over one side's CONTENT rows."""
    index: dict = {}
    for r in rows:
        key = normalize_n2(r.description)
        if not key:
            continue
        index.setdefault(key, []).append(r.excel_row)
    return index


def _resolve_delta(position: int, candidates, running_delta):
    """The offset this row moved by, or None when it cannot be established.

    `candidates` are the original positions carrying this row's text. Preference order:

      1. the offset already running for this block, if it lands on a candidate -- this is what
         keeps a repeated description ("Supply and fix conduit", ubiquitous in real BoQs) from
         resolving to whichever copy happens to be first;
      2. the only candidate, when there is exactly one;
      3. give up -- an ambiguous repeat with no running offset to corroborate it.

    Returning None is not a failure mode to be minimised: it routes the row to the CAUSAL label,
    which is the safe direction (see `reasons.is_collateral`).
    """
    if running_delta is not None and (position - running_delta) in candidates:
        return running_delta
    if len(candidates) == 1:
        delta = position - next(iter(candidates))
        # Offset 0 with no match is a contradiction (it would have paired). Treat as unresolved.
        return delta or None
    return None


def _classify_rows(revised_rows, orig_desc_index, dup_positions, carried_ids, non_carry_reasons):
    """Pass 1 -- per-row, in document order. Returns (reasons, unresolved, shifted_sequence).

    `shifted_sequence` is the ordered [(row_id, excel_row, delta, offset_above)] the block grouping
    walks, and `unresolved` is the ordered list passes 3-4 finish off.

    TWO offsets are tracked, with deliberately different reset rules -- collapsing them into one
    breaks one case or the other:

      `probe`  disambiguates a repeated description against the offset already running. It resets
               on ANY interruption, including an unresolved row, because an unresolved row IS a new
               edit point and the offset below it may differ. Without that reset a stale offset can
               claim a coincidental candidate and mis-group two blocks into one.

      `above`  is the offset PROVEN by the last matched or shifted row, and is what the next block
               subtracts to get its LOCAL change. It survives unresolved rows (they prove nothing)
               and resets to 0 only on a matched row, which proves alignment was restored.
    """
    reasons: dict = {}
    unresolved: list = []
    shifted: list = []
    probe = None
    above = 0

    for r in revised_rows:
        rid = r.row_id

        # A blank/spacer row is never diagnosed. The caller already filters these out (the matcher
        # skips them too), so this is defence, not flow control -- but it has to be here: without
        # it a blank row falls through every probe to pass 4 and is stamped a reason, which would
        # put an unclassifiable spacer in front of the reviewer AND into the finalize gate.
        if not normalize_n2(r.description):
            continue

        if rid in carried_ids:
            probe, above = None, 0        # this row matched -- alignment is proven here
            continue

        if rid in non_carry_reasons:
            # Matched, but the carry refused it (parent lost / unusable source record).
            reasons[rid] = RowReason(code=non_carry_reasons[rid])
            probe, above = None, 0        # it still MATCHED, so alignment is proven
            continue

        if dup_positions.get(r.excel_row):
            reasons[rid] = RowReason(code=DUPLICATE_POSITION)
            continue                      # deliberately leaves both offsets alone

        candidates = orig_desc_index.get(normalize_n2(r.description), [])
        delta = _resolve_delta(r.excel_row, candidates, probe) if candidates else None
        if delta is None:
            unresolved.append(r)
            probe = None                  # a new edit point -- the probe offset is void
            continue

        reasons[rid] = RowReason(code=POSITION_SHIFTED, delta=delta)
        shifted.append((rid, r.excel_row, delta, above))
        probe, above = delta, delta

    return reasons, unresolved, shifted


def _group_blocks(shifted):
    """Pass 2 -- fold shifted rows into blocks, one per EDIT.

    `change` is the block's LOCAL edit -- its cumulative offset minus the offset already in force
    above it. On a second edit point the two differ, and only `change` names what a human did there.

    THE CONTINUATION TEST IS `change == 0`, i.e. "the offset did not change at this row". A block
    STARTS exactly where the offset moves, which is exactly where someone edited.

    ⚠️ It is deliberately NOT Excel-row adjacency, which is what this originally used and which was
    WRONG. Blank/spacer rows never enter the match, so a sheet with a spacer between two shifted
    rows has a GAP in Excel numbering with no edit behind it. The adjacency test read that gap as a
    new block, and because such a block inherits the offset already in force, its `change` came out
    as 0 -- a "block" recording no edit at all, which then rendered as a phantom "0 rows deleted".
    Live case: BOQ-26-00214 sheet FPS, one insertion at Excel 7 reported as three blocks.

    Alignment genuinely being RESTORED still starts a new block, and needs no special case: a
    matched row resets `offset_above` to 0 in pass 1, so the next shifted row has
    `change == delta != 0`.
    """
    blocks: list = []
    for rid, excel_row, delta, offset_above in shifted:
        change = delta - offset_above
        if blocks and change == 0:
            # The offset did not move here -- this row is collateral of the block above, however
            # many spacers or unresolved rows sit between them.
            blocks[-1]["rows"].append(rid)
            continue
        blocks.append({
            "delta": delta,
            "change": change,
            "first_excel": excel_row,
            "rows": [rid],
        })
    return blocks


def _anchor_for(block) -> int:
    """The revised Excel row where the change that caused this block begins.

    Insertion (`change` > 0): the inserted rows occupy `[first - change, first - 1]`, so the change
    begins at `first - change`. Deletion (`change` < 0): content went missing AT `first`, which is
    where the row below the deletion now sits. Both read as "the row the user should look at".

    Uses `change`, NOT `delta` -- with two edits above it, `first - delta` points at the FIRST
    edit's anchor rather than this block's own.
    """
    if block["change"] > 0:
        return block["first_excel"] - block["change"]
    return block["first_excel"]


def diagnose_sheet(
    original_rows,
    revised_rows,
    match: RowMatchResult,
    carried_ids=(),
    non_carry_reasons=None,
    positionless_ids=(),
) -> SheetDiagnosis:
    """Explain every non-copied revised CONTENT row (see module docstring).

    Args:
      original_rows      -- the original side's MatchRows, as handed to `match_rows`.
      revised_rows       -- the revised side's MatchRows, in DOCUMENT order (`row_index` ascending).
                            The order is load-bearing: "the rows immediately above a block" and
                            "consecutive shifted rows" are both defined by it.
      match              -- the RowMatchResult those two produced.
      carried_ids        -- revised row_ids that DID copy (keys of `build_review_carry`).
      non_carry_reasons  -- {revised row_id -> code} from `explain_non_carry`: matched but refused.
      positionless_ids   -- content row_ids that never reached the matcher for want of a
                            `source_row_number`. Stamped NO_EXCEL_POSITION so the taxonomy stays
                            total; unreachable in practice.

    Returns a SheetDiagnosis whose `reasons` covers EXACTLY the non-copied content rows -- copied
    rows are absent, and so are blank/spacer rows (they never enter here).
    """
    carried_ids = set(carried_ids)
    non_carry_reasons = dict(non_carry_reasons or {})

    # Positions that are ambiguous on EITHER side. `match_rows` drops both, so a row sitting on one
    # can never pair regardless of its text -- checked before the description probe for that reason.
    orig_counts = _position_counts(original_rows)
    rev_counts = _position_counts(revised_rows)
    dup_positions = {
        pos: True
        for pos in set(orig_counts) | set(rev_counts)
        if orig_counts.get(pos, 0) > 1 or rev_counts.get(pos, 0) > 1
    }

    orig_desc_index = _description_index(original_rows)
    orig_content_positions = {p for p, c in orig_counts.items() if c >= 1}

    reasons, unresolved, shifted = _classify_rows(
        revised_rows, orig_desc_index, dup_positions, carried_ids, non_carry_reasons
    )

    blocks = _group_blocks(shifted)

    # Pass 3 -- a LOCAL change of +N is evidence that N rows were inserted directly above the block.
    # Claim the contiguous unresolved rows sitting immediately above its first shifted row; they are
    # the CAUSE of the shift, and everything below them is collateral.
    #
    # Claim up to `change` rather than exactly `change`: an inserted BLANK row never enters the
    # match, so a +2 block can legitimately have only one unresolved row above it. Claiming what is
    # actually there beats asserting a count the sheet does not support.
    unresolved_by_excel = {r.excel_row: r for r in unresolved}
    claimed: set = set()
    for block in blocks:
        anchor = _anchor_for(block)
        if block["change"] <= 0:
            block["inserted"] = ()
            continue
        inserted: list = []
        pos = block["first_excel"] - 1
        while len(inserted) < block["change"] and pos in unresolved_by_excel:
            inserted.append(unresolved_by_excel[pos])
            pos -= 1
        inserted.reverse()
        for r in inserted:
            claimed.add(r.row_id)
            reasons[r.row_id] = RowReason(code=ROW_INSERTED, anchor=anchor)
        block["inserted"] = tuple(r.excel_row for r in inserted)

    # Stamp the block anchor onto its shifted rows so the bulk affirm can address them, and build
    # the persisted summary.
    shift_blocks: list = []
    for block in blocks:
        anchor = _anchor_for(block)
        for rid in block["rows"]:
            reasons[rid] = RowReason(code=POSITION_SHIFTED, delta=block["delta"], anchor=anchor)
        shift_blocks.append(ShiftBlock(
            anchor=anchor,
            delta=block["delta"],
            change=block["change"],
            shifted_count=len(block["rows"]),
            inserted_excel_rows=block.get("inserted", ()),
        ))

    # Pass 4 -- whatever is left. New content if the original had NOTHING at this position (an
    # append past its last row, or a gap filled in); otherwise the text at an occupied position
    # changed, which is an in-place edit.
    for r in unresolved:
        if r.row_id in claimed:
            continue
        code = DESCRIPTION_CHANGED if r.excel_row in orig_content_positions else ROW_INSERTED
        reasons[r.row_id] = RowReason(code=code)

    for rid in positionless_ids:
        reasons[rid] = RowReason(code=NO_EXCEL_POSITION)

    # Pass 5 -- original rows that vanished. "Unmatched" alone is not enough: after an insertion
    # every original below it is unmatched while still being present in the revision. A row is
    # REMOVED only when its text appears nowhere revised AND it was not simply overwritten in place
    # (a DESCRIPTION_CHANGED row at the same position IS the overwrite, and reporting it as both a
    # removal and a reword would double-count one edit).
    revised_desc_keys = set(_description_index(revised_rows))
    overwritten_positions = {
        r.excel_row for r in revised_rows
        if reasons.get(r.row_id) is not None
        and reasons[r.row_id].code == DESCRIPTION_CHANGED
    }
    unmatched_original = match.unmatched_original()
    removed: list = []
    for r in original_rows:
        if r.row_id not in unmatched_original:
            continue
        key = normalize_n2(r.description)
        if not key or key in revised_desc_keys or r.excel_row in overwritten_positions:
            continue
        removed.append(RemovedRow(excel_row=r.excel_row, description=r.description))

    return SheetDiagnosis(
        reasons=reasons,
        shift_blocks=tuple(shift_blocks[:MAX_SUMMARY_ITEMS]),
        removed_rows=tuple(removed[:MAX_SUMMARY_ITEMS]),
        block_count=len(shift_blocks),
        removed_count=len(removed),
    )
