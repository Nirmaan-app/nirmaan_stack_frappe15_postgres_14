"""D6/D7 review carry -- pure payload builder, no Frappe imports (ADR-0010 B1).

Given the D6 match (row_match.match_rows), the original's committed node fields, and the
revision's freshly-parsed rows, decide -- per revised row -- the `revision_carry_status` stamp
plus the values to carry. The caller (`api/boq/wizard/review_carry.py`) reads the DB and
applies the returned writes; this module is pure so the re-point logic is unit-testable with
plain dicts.

OWNER AMENDMENT 2026-07-20 -- SUPERSEDES ADR-0014 D7's "carry the OVERRIDE SET only".
=====================================================================================
D7 read the original's `human_classification` / `human_parent` / `human_is_root`. That is
PROVABLY LOSSY, and it silently dropped the most valuable decisions on the sheet:

  commit_pipeline writes the node as
      node.row_class   = eff["effective_classification"]   # human > AI-accepted > parser
      node.parent_node = eff["effective_parent_index"]     # same three-layer chain
      node.human_*     = the RAW manually-typed layer ONLY

  so an ACCEPTED Claude/Gemini suggestion reaches the committed tier folded into `row_class` /
  `parent_node` and leaves `human_classification` blank + `human_parent` at -1. Reading the
  human layer therefore carried NOTHING for an AI-accepted row -- and because the parent
  re-point was gated on `human_parent >= 0`, that branch never even ran. Observed live.

The rule is now SIMPLE, and it reads the fields that already hold the answer:

  | carry          | source (committed BOQ Nodes) | write (revision BoQ Review Row)      |
  |----------------|------------------------------|--------------------------------------|
  | classification | `row_class`   (EFFECTIVE)    | `classification`  (the PARSER layer) |
  | parent         | `parent_node` (EFFECTIVE)    | `parent_index`    (the PARSER layer) |

WHY THE PARSER LAYER, not the human layer (owner decision, 2026-07-20):
  * `row_class` carries the FULL taxonomy, but `_ASSIGNABLE_CLASSIFICATIONS` is only
    {line_item, preamble, note, spacer} -- `subtotal_marker` / `header_repeat` may NEVER be
    written to `human_classification`. The parser layer has no such vocabulary limit.
  * `_row_has_override` keys on the human fields, so writing them would flip `has_override`
    true on every matched row -> `_guard_row_at_parser_baseline` blocks Apply-AI sheet-wide.
    The parser layer leaves the AI flow fully available on the revision.
  * The row then renders "Original" (calm, no action needed) -- which is TRUE: the human has
    not touched it in THIS revision. A human edit or an AI accept still layers on top exactly
    as on a fresh upload, because `resolve_effective`'s precedence is untouched.

  In effect: a matched row's PARSE BASELINE for the revision IS the original's accepted answer.

`Drifted` IS RETIRED. It existed only to surface the hole that override-only carry left (a
matched row whose original effective class disagreed with the fresh parse). Carrying the
effective value closes that hole by construction, so the status is never produced again. Only
`New` and `Ambiguous` are surfaced to the human, plus two muted panel advisories (REMOVED
originals, and the `parent_lost` rows flagged here).

Still load-bearing, unchanged:
  * `-1` is written explicitly for a root's `parent_index` (Frappe coerces Int None -> 0, and 0
    is a valid row_index). A twin at row_index 0 is a REAL parent -- 0 there is correct.
  * `level` is NEVER carried (ADR-0009: it re-derives from the effective tree at both read and
    commit; a planted stale level makes the `BOQ Nodes` controller throw).
  * The parent re-point is RELATIONAL -- `parent_node` (a node NAME) indexes the D6 twin map
    straight to the twin's fresh `row_index`. NEVER `sort_order` (that is the ORIGINAL's
    row_index -- the trap D7 named and this amendment keeps).
  * Status stamps map 1:1 to `BoQ Review Row.revision_carry_status`. REMOVED is never a value
    (it is an original-side outcome -- no revised row exists to stamp).
"""

from dataclasses import dataclass

from nirmaan_stack.services.boq_revision.row_match import MATCHED, RowMatchResult

# The parser-layer "no parent" sentinel (agreement #54). Also what a carried effective-root
# writes -- an original node with `parent_node` NULL is effective-root by construction.
NO_PARENT = -1


@dataclass(frozen=True)
class ReviewCarryWrite:
    """The field updates for ONE revised review row.

    A None field means "leave the review row's fresh-parse value untouched" -- the caller writes
    only the non-None fields. `parent_index` is an explicit int when carried (a twin's row_index,
    or -1 for an effective root).

    `parent_lost` is NOT a write -- it is a read-side signal: this row MATCHED, but its original
    parent's description has no twin in the revision, so the parent could not be re-pointed and
    the row keeps the fresh parser's parent. Surfaced as a muted panel advisory (owner: keep it
    a panel line, not a row badge).
    """

    revision_carry_status: str          # Matched | New | Ambiguous
    classification: str | None = None
    parent_index: int | None = None
    parent_lost: bool = False


def build_review_carry(revised_rows, original_by_id, match: RowMatchResult) -> dict:
    """Decide the carry write per revised content row (see module docstring).

    Args:
      revised_rows    -- iterable of dicts, one per revised CONTENT row (the ones fed to the
                         matcher); each has "row_id" (the revised `row_index`).
      original_by_id  -- {original row_id (committed node name) -> node fields dict}, each with
                         "row_class" and "parent_node". Duck-typed .get() -- a frappe._dict works
                         verbatim.
      match           -- the D6 RowMatchResult.

    Returns {revised row_id -> ReviewCarryWrite} for every row that gets a stamp. A row with no
    match outcome (a non-content / blank row the matcher skipped) is ABSENT -> left blank.
    """
    out: dict = {}
    for rr in revised_rows:
        rid = rr["row_id"]
        outcome = match.revised_outcome.get(rid)
        if outcome is None:
            continue  # non-content row the matcher skipped -> no stamp (calm default)
        if outcome != MATCHED:
            out[rid] = ReviewCarryWrite(revision_carry_status=outcome)  # New | Ambiguous
            continue

        node = original_by_id[match.revised_to_original[rid]]

        # Classification: the committed EFFECTIVE value (human > AI-accepted > parser, folded at
        # commit). Blank is impossible on a real node, but coerce defensively -> leave untouched.
        carry_classification = (node.get("row_class") or "").strip() or None

        # Parent: the committed EFFECTIVE parent node -> its D6 twin -> the twin's fresh row_index.
        # A NULL parent_node is an effective ROOT (commit links parent_node from
        # effective_parent_index, so NULL there means "no effective parent"), which carries as the
        # explicit -1 sentinel.
        parent_name = node.get("parent_node")
        carry_parent: int | None
        parent_lost = False
        if not parent_name:
            carry_parent = NO_PARENT
        else:
            twin = match.original_to_revised.get(parent_name)
            if twin is not None:
                carry_parent = twin
            else:
                # The parent row itself is REMOVED/AMBIGUOUS in this revision -- nothing to point
                # at. Keep the fresh parser's parent and flag it for the muted panel advisory.
                carry_parent = None
                parent_lost = True

        out[rid] = ReviewCarryWrite(
            revision_carry_status=MATCHED,
            classification=carry_classification,
            parent_index=carry_parent,
            parent_lost=parent_lost,
        )
    return out
