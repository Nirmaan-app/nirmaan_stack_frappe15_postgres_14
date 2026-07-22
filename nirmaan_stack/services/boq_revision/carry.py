"""Review carry payload (ADR-0014 D7, **Amendment B** 2026-07-20) -- pure, no Frappe imports (B1).

Given the Amendment B match (`row_match.match_rows`), the original's committed node fields, and the
revision's freshly-parsed rows, decide -- per revised row -- what to write. The caller
(`api/boq/wizard/review_carry.py`) reads the DB and applies the returned writes; this module is pure
so the decision is unit-testable with plain dicts.

THE RULE
--------
A matched row copies the original's EFFECTIVE classification AND parenting, **together**:

  | copy           | source (committed `BOQ Nodes`) | write (revision `BoQ Review Row`)   |
  |----------------|-------------------------------|-------------------------------------|
  | classification | `row_class`   (EFFECTIVE)     | `classification`  (the PARSER layer)|
  | parent         | `parent_node` (EFFECTIVE)     | `parent_index`    (the PARSER layer)|

...and only when ALL THREE hold (the first two are the matcher's job, the third is this module's):

  1. the row's Excel position is unique on each side,
  2. the descriptions at that position are identical,
  3. **the original row's PARENT is itself a matched row** -- or the original row is a ROOT, which
     satisfies this trivially.

BOTH OR NEITHER (A4/A5). If the parent cannot be re-pointed, the row copies NOTHING -- not even the
classification. There is no half-carry and no `parent_lost` signal, because there is no longer such
a thing as a carried row with un-re-pointed parenting. Condition 3 is the DELIBERATE gate that
replaces the accidental `human_parent >= 0` gate Amendment A removed.

ONE STATUS. `Copied`, or nothing. A non-copied row is left entirely alone -> blank
`revision_carry_status` -> the Status column's existing bottom rung renders it `Original`, exactly
like a fresh upload, with every classifier warning, review flag, structural check and the finalize
gate applying unchanged (A9). `Matched` / `New` / `Ambiguous` / `Drifted` are all RETIRED.

WHY THE PARSER LAYER, not the human layer (unchanged from Amendment A, still load-bearing):
  * `row_class` carries the FULL taxonomy, but `_ASSIGNABLE_CLASSIFICATIONS` is only
    {line_item, preamble, note, spacer} -- `subtotal_marker` / `header_repeat` may NEVER be written
    to `human_classification`. The parser layer has no vocabulary gate.
  * `_row_has_override` keys on the human fields, so writing them would flip `has_override` true on
    every copied row -> `_guard_row_at_parser_baseline` blocks Apply-AI sheet-wide.
  * The row then renders "Original" -- which is TRUE: the human has not touched it in THIS revision.
    `resolve_effective`'s precedence is untouched, so a human edit or an AI accept still layers on
    top exactly as on a fresh upload.

  In effect: a copied row's PARSE BASELINE for the revision IS the original's accepted answer.

NEVER COPIED
------------
  * `level` -- always re-derived from the effective tree (ADR-0009,
    `commit_validation.derive_effective_levels`); a planted stale value makes the `BOQ Nodes`
    controller throw. Verified benign that a stale review-row `level` sits beside a copied parent:
    level is re-derived at BOTH validation and commit.
  * the human layer (`human_classification` / `human_parent` / `human_is_root`) -- see above.
  * anything at all on a non-matched row.
"""

from dataclasses import dataclass

from nirmaan_stack.services.boq_revision.reasons import (
    PARENT_NOT_CARRIED,
    SOURCE_UNCLASSIFIED,
)
from nirmaan_stack.services.boq_revision.row_match import RowMatchResult

# The one carry status. Blank (absent) is the only other outcome.
COPIED = "Copied"

# The parser-layer "no parent" sentinel (agreement #54). Also what a carried effective-root writes --
# an original node with `parent_node` NULL is effective-root by construction. Written EXPLICITLY
# because Frappe coerces Int None -> 0, and 0 is a VALID row_index (a twin at row_index 0 is a real
# parent).
NO_PARENT = -1


@dataclass(frozen=True)
class ReviewCarryWrite:
    """The field updates for ONE copied review row.

    Both payload fields are always populated -- both-or-neither means a `ReviewCarryWrite` exists
    only when there is a complete answer to write. A row that copies nothing is simply ABSENT from
    `build_review_carry`'s result.
    """

    revision_carry_status: str  # always COPIED
    classification: str
    parent_index: int


def _decide_row(rid, original_by_id, match: RowMatchResult):
    """The per-row carry decision -- the SINGLE home for the both-or-neither rule.

    Returns `(write, reason)`, exactly one of which is ever non-None, or `(None, None)`:

      (ReviewCarryWrite, None) -- the row copies.
      (None, <reason code>)    -- the row MATCHED but the carry still refused. The code names why,
                                  for the needs-review stamp.
      (None, None)             -- the row did not match at all. NOT this module's story to tell:
                                  the position/description axis belongs to `diagnose.py`, which has
                                  both sides' rows and can say whether the row shifted, is new, or
                                  was reworded. Returning None here rather than a vague code is
                                  what keeps the taxonomy honest.

    Split out of `build_review_carry` so the reason and the payload are decided ONCE, by one
    traversal of one rule set. Two functions re-deriving the same conditions would drift, and the
    drift would show up as a row stamped with a reason that contradicts its own carry outcome.
    """
    original_id = match.revised_to_original.get(rid)
    if original_id is None:
        return None, None  # conditions 1-2 failed -> diagnose.py owns this row's reason

    node = original_by_id.get(original_id)
    if node is None:
        # Defensive: matcher and node map disagree. Folded into SOURCE_UNCLASSIFIED rather than
        # given its own code -- both mean "the original's record gave no usable answer", and an
        # eighth code for an unreachable branch buys nothing.
        return None, SOURCE_UNCLASSIFIED

    # Classification: the committed EFFECTIVE value (human > AI-accepted > parser, folded at
    # commit). Blank is impossible on a real node; coerce defensively and copy NOTHING if so --
    # both-or-neither forbids carrying a parent without its classification.
    classification = (node.get("row_class") or "").strip()
    if not classification:
        return None, SOURCE_UNCLASSIFIED

    # Parent (condition 3). `parent_node` is a committed node NAME, which is exactly the
    # original side's row_id -- so the twin map resolves it in ONE relational hop to the
    # revision row at the same Excel position. NEVER `sort_order` (that is the ORIGINAL's
    # row_index -- the trap D7 named and Amendment B keeps).
    parent_name = node.get("parent_node")
    if not parent_name:
        # NULL parent_node == effective ROOT (commit links it from effective_parent_index), which
        # satisfies condition 3 trivially.
        parent_index = NO_PARENT
    else:
        twin = match.original_to_revised.get(parent_name)
        if twin is None:
            # The parent did not survive the match -- the row's place in the tree is no longer
            # established by the original. Copy NOTHING and let the fresh parser own this row.
            return None, PARENT_NOT_CARRIED
        parent_index = twin

    return ReviewCarryWrite(
        revision_carry_status=COPIED,
        classification=classification,
        parent_index=parent_index,
    ), None


def decide_review_carry(revised_rows, original_by_id, match: RowMatchResult):
    """Both halves of the decision in ONE pass: `(carries, non_carry_reasons)`.

    The parse seam calls THIS (one traversal); `build_review_carry` and `explain_non_carry` are
    thin projections of it for callers -- and tests -- that want only one half.

    Args:
      revised_rows   -- iterable of dicts, one per revised CONTENT row (the ones fed to the
                        matcher); each has "row_id" (the revised `row_index`).
      original_by_id -- {original row_id (committed node name) -> node fields dict}, each with
                        "row_class" and "parent_node". Duck-typed `.get()` -- a frappe._dict works
                        verbatim.
      match          -- the Amendment B RowMatchResult.

    Returns:
      carries  -- {revised row_id -> ReviewCarryWrite}, ONLY copied rows.
      reasons  -- {revised row_id -> reason code}, ONLY rows that matched and still did not copy.
                  A row that never matched is in NEITHER dict.
    """
    carries: dict = {}
    reasons: dict = {}
    for rr in revised_rows:
        rid = rr["row_id"]
        write, reason = _decide_row(rid, original_by_id, match)
        if write is not None:
            carries[rid] = write
        elif reason is not None:
            reasons[rid] = reason
    return carries, reasons


def build_review_carry(revised_rows, original_by_id, match: RowMatchResult) -> dict:
    """Decide the carry write per revised content row (see module docstring).

    Returns {revised row_id -> ReviewCarryWrite} containing ONLY copied rows. Every other row is
    absent and must be left completely untouched by the caller.

    Unchanged contract: this is a projection of `decide_review_carry`, kept as the carry's public
    face so every existing caller and test is byte-identical.
    """
    return decide_review_carry(revised_rows, original_by_id, match)[0]


def explain_non_carry(revised_rows, original_by_id, match: RowMatchResult) -> dict:
    """Why each MATCHED row still did not copy -- {revised row_id -> reason code}.

    The complement of `build_review_carry` over the matched set, and nothing more: a row that never
    matched is absent here because its reason lives on the position/description axis that
    `diagnose.py` owns. Feed both into `diagnose_sheet` to get the total per-row taxonomy.
    """
    return decide_review_carry(revised_rows, original_by_id, match)[1]
