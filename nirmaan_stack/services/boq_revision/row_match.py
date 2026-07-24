"""Row match (ADR-0014 D6, **Amendment B** 2026-07-20) -- pure, no Frappe imports (ADR-0010 B1).

At the post-parse merge seam the revision's freshly-parsed rows are matched to the original's
committed rows so the reviewed classification + parenting can carry forward. This module is the
PURE match: it takes minimal per-row descriptors from BOTH sides and returns the pairing. It never
touches the DB -- the callers read the rows and hand the primitives here.

THE RULE (Amendment B -- this SUPERSEDES D6's description-bucket engine entirely):

    same Excel row + same description

A row pairs with its counterpart only if it is still in the SAME PLACE with the SAME WORDS:

  1. Its `excel_row` appears **exactly once on each side** (a position appearing twice on either
     side is DROPPED from that side -- owner call 2026-07-20, "drop both": conservative, and it can
     never mis-pair. Live-measured dev-bench: `source_row_number` is unique within its sheet for all
     29,752 current committed nodes, so this is defence, not a live workaround. The known collider is
     a synthetic review row committed with its `row_index` as its row number,
     `commit_pipeline.py:207`).
  2. The rows at that shared position have an IDENTICAL `normalize_n2(description)`.

Blank-description rows never enter (they carry nothing and demand nothing). There is no fuzzy tier,
no section-header walk, no ambiguity class, and no duplicate-cluster disambiguation -- all deleted
with the bucket engine.

WHY POSITION IS THE ENTIRE SAFETY ARGUMENT
------------------------------------------
A parent always sits ABOVE its child (`services/boq_parser/hierarchy.py:618` -- `parent_index =
stack[-1]`, a monotonic stack of PRECEDING indices), and any inserted or deleted row shifts every
position below it. So the instant a row is introduced, nothing beneath it can satisfy condition (1)
-- the match simply stops and the fresh parser's answer flows through untouched.

The failure Amendment B exists to fix (the carry dragging rows back under a superseded heading)
becomes STRUCTURALLY IMPOSSIBLE rather than guarded against. This is also why no "did the parser
find a new parent?" check is needed anywhere downstream.

⚠️ HONEST RECORD: `source_row_number` + description is the key D6 explicitly NAMED AND REJECTED as
"the same-file key -- one inserted row shifts everything below => mass non-match => defeats the
feature's whole point." That objection is correct and was NOT overturned. It is reinstated anyway,
because the yield description-only matching recovered was bought with CORRECTNESS. Fewer rows
carrying, correctly, beats more rows carrying, silently mis-parented. Do not "improve" this back
toward a diff or a walk -- it went through four owner narrowings to get here.

⚠️ `level` MUST NEVER RE-ENTER THIS MODULE. Both inputs are now immutable after parse and neither is
a function of the tree, which is what makes the parse-seam run and the committed-tier run PROVABLY
IDENTICAL -- and that is what lets the committed tier re-derive the `Copied` set with no new schema.

`row_id` is the caller's OPAQUE identity within its own side, deliberately NOT the Excel row:
  * review carry  -- original = the committed node NAME (so `parent_node` indexes the twin map
                     directly, keeping the parent re-point a one-hop relational lookup);
                     revised = the fresh `row_index`.
  * committed tier -- both sides = `source_row_number`.
"""

from dataclasses import dataclass
from typing import Hashable

from nirmaan_stack.services.boq_revision.normalize import normalize_n2


@dataclass(frozen=True)
class MatchRow:
    """A minimal row descriptor for the Amendment B match -- either side.

    row_id      -- opaque STABLE identity within its own side (see module docstring).
    excel_row   -- `source_row_number`, the durable Excel address. THE KEY.
    description -- raw joined description; N2-normalized internally for the comparison.
    """

    row_id: Hashable
    excel_row: int
    description: str


@dataclass(frozen=True)
class RowMatchResult:
    """The Amendment B pairing between one sheet's original + revised content rows.

    Only PAIRS are represented. There is no per-row outcome vocabulary any more -- a row is matched
    or it is not, and "not" needs no further classification (the four-way MATCHED / NEW / REMOVED /
    AMBIGUOUS taxonomy is retired). `original_ids` / `revised_ids` carry every CONTENT row that
    entered, so a caller can derive its own unmatched set without re-filtering the inputs.
    """

    original_to_revised: dict  # matched: original row_id -> revised row_id (the twin map)
    revised_to_original: dict  # matched: revised row_id  -> original row_id
    original_ids: frozenset    # every original content row that entered the match
    revised_ids: frozenset     # every revised content row that entered the match

    def unmatched_original(self) -> frozenset:
        """Original content rows with no counterpart -- gone, or moved, or reworded."""
        return self.original_ids - frozenset(self.original_to_revised)

    def unmatched_revised(self) -> frozenset:
        """Revised content rows with no counterpart -- these carry nothing and are ordinary parsed
        rows (the review surface for "needs a human")."""
        return self.revised_ids - frozenset(self.revised_to_original)


def _index_by_excel_row(rows) -> tuple[dict, frozenset]:
    """Index one side by `excel_row`, keeping ONLY positions that occur exactly once.

    Returns `(position -> MatchRow, every content row_id that entered)`. A row with a blank
    normalized description never enters either. A duplicated position is dropped from the index but
    its rows STAY in the id set -- they entered the match and simply found no partner, so they must
    still count as "not carried" downstream.
    """
    seen: dict = {}
    dropped: set = set()
    ids: set = set()
    for r in rows:
        if not normalize_n2(r.description):
            continue
        ids.add(r.row_id)
        pos = r.excel_row
        if pos in dropped:
            continue
        if pos in seen:
            # Second sighting -> neither is trustworthy. Drop the position outright.
            del seen[pos]
            dropped.add(pos)
            continue
        seen[pos] = r
    return seen, frozenset(ids)


def match_rows(original_rows, revised_rows) -> RowMatchResult:
    """Pair the original's committed content rows with the revision's parsed content rows.

    Same Excel row + same N2 description, each position unique on both sides. See module docstring.
    """
    orig_by_pos, original_ids = _index_by_excel_row(original_rows)
    rev_by_pos, revised_ids = _index_by_excel_row(revised_rows)

    o2r: dict = {}
    r2o: dict = {}
    for pos, o in orig_by_pos.items():
        r = rev_by_pos.get(pos)
        if r is None:
            continue  # position not present (or dropped as duplicate) on the revised side
        if normalize_n2(o.description) != normalize_n2(r.description):
            continue  # same place, different words -> a real edit, not a carry
        o2r[o.row_id] = r.row_id
        r2o[r.row_id] = o.row_id

    return RowMatchResult(
        original_to_revised=o2r,
        revised_to_original=r2o,
        original_ids=original_ids,
        revised_ids=revised_ids,
    )
