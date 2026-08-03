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

⚠️ AMENDMENT G (WBC-S11, 2026-07-30, owner-directed): an OPT-IN SECOND PASS on
`serial number + description`, for rows that MOVED. `serial_second_pass` defaults to **False**, so
the consumers that must not have it are unaffected BY CONSTRUCTION and not by care:

    call site                                                        second pass
    committed_carry.committed_excel_row_match                            ON
      -> cross_boq_carry: the RATE carry AND the opt-in layer carry
         (categories / remarks / colours / dismissals) read ONE match
    committed_carry.version_addressed_excel_row_match                    off
      -> pricing.apply_copy_forward, the within-BoQ copy-forward
    review_carry.merge_revision_review_carry                             off
      -> the PARSE-TIME classification + parenting carry

THE BOUNDARY is **structure vs. everything else** -- NOT rates vs. layers (owner ruling
2026-07-30, correcting the slice's own opening framing). Position is the entire safety argument
above, and it buys one specific thing: a row can never be re-parented under a stale or superseded
heading. A wrong RATE is a visible number a human catches in the pricing grid; a wrong PARENT is a
structural fault that propagates silently through every descendant. **They do not deserve the same
caution.** That structural risk lives in the parse-time carry, which stays strict.

Categories, remarks, colours and dismissals are ROW-ADDRESSED ANNOTATIONS, not parenting. Carrying
them onto a row the match has ALREADY decided is the same row adds no structural risk the rate does
not already carry -- so they ride the same match, and `cross_boq_carry` derives it once. Splitting
the derivation to hold layers back would also have partly undone AMENDMENT E, whose whole point is
that the carry moves categories and rates in ONE action so the category gate cannot block its own
remedy; a moved row left priced-but-uncategorised would reinstate exactly the manual finishing step
E removed.

This is a deliberate, owner-approved, narrowly-scoped exception to the "do not loosen this back
toward a diff or a walk" warning above, NOT drift. What makes it safe rather than a re-run of the
description-only engine D6 rejected: pass 2 never guesses. A key must occur EXACTLY ONCE among the
unmatched rows on EACH side, or nothing pairs -- the same "second sighting -> neither is trustworthy
-> drop the key outright" discipline pass 1 already applies to duplicate positions. The owner's
chosen failure mode: **a bad serial LOSES a match, it never CREATES a wrong one.**

Deliberately NOT attempted (owner ruling): float repair. Live `code` values include prose section
headers, date strings, and formula cells whose float precision leaked into stored text
("2.3000000000000003"). Numeric coercion is exactly how a wrong pairing gets made, so such rows stay
unmatched. Recorded as a possible later refinement, not an oversight.
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
    serial      -- the row's printed serial number, raw. AMENDMENT G's pass-2 key half; IGNORED
                   unless the caller opts in. Defaults to "" so every existing construction stays
                   valid and every non-opted-in consumer keeps its exact behaviour. On committed
                   `BOQ Nodes` this is `code`; pre-commit `BoQ Review Row` calls it `sl_no_value`.
    """

    row_id: Hashable
    excel_row: int
    description: str
    serial: str = ""


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
    #: AMENDMENT G -- the ORIGINAL row_ids paired by the SERIAL second pass rather than by position.
    #: A strict subset of `original_to_revised`'s keys; each maps to its revised twin there, so one
    #: side is enough. ADDITIVE with a default: a consumer that does not opt in reads an empty set
    #: and a consumer that does not care never has to look. Always empty when the pass is off.
    serial_matched: frozenset = frozenset()

    def unmatched_original(self) -> frozenset:
        """Original content rows with no counterpart -- gone, or moved, or reworded."""
        return self.original_ids - frozenset(self.original_to_revised)

    def unmatched_revised(self) -> frozenset:
        """Revised content rows with no counterpart -- these carry nothing and are ordinary parsed
        rows (the review surface for "needs a human")."""
        return self.revised_ids - frozenset(self.revised_to_original)


def _entered(rows) -> list:
    """The rows that ENTER a match: a non-blank N2 description, and nothing else asked of them.

    ONE definition, shared by both passes -- a row pass 1 could not place must be exactly the set
    pass 2 gets to try, or the two passes would disagree about what a content row is. Blank rows
    never enter (they carry nothing and demand nothing)."""
    return [r for r in rows if normalize_n2(r.description)]


def _unique_index(rows, key) -> dict:
    """Index `rows` by `key(row)`, keeping ONLY keys that occur EXACTLY ONCE.

    The module's one ambiguity rule, parameterised over the key so pass 1 (position) and pass 2
    (serial + description) cannot drift apart in how they handle a collision. A second sighting
    means neither row is trustworthy, so the key is dropped OUTRIGHT and the drop is STICKY -- a
    third sighting must not re-add it. A dropped row is simply absent from the index; it stays in
    the caller's id set, because it entered the match and merely found no partner.
    """
    seen: dict = {}
    dropped: set = set()
    for r in rows:
        k = key(r)
        if k in dropped:
            continue
        if k in seen:
            del seen[k]
            dropped.add(k)
            continue
        seen[k] = r
    return seen


def _serial_key(row) -> tuple:
    """AMENDMENT G's pass-2 key: (N2 serial, N2 description). Reuses `normalize_n2` on BOTH halves.

    ⚠️ `normalize_n2` is deliberately single-homed and shared across three unrelated carry axes, so
    it is REUSED here and NOT changed, and no separate serial normalizer was introduced -- trim +
    lowercase + whitespace-collapse is already exactly the right rule for a printed serial. Nothing
    else is folded: no numeric coercion, no trailing-zero repair, no punctuation stripping. Case
    folding cannot mis-pair even where a sheet uses both "A" and "a", because a fold that collided
    two real serials would produce a DUPLICATE key, which `_unique_index` drops.
    """
    return (normalize_n2(row.serial), normalize_n2(row.description))


def _serial_second_pass(orig_unmatched, rev_unmatched) -> list:
    """AMENDMENT G. Pair leftovers on (serial + description). Returns [(original, revised)] pairs.

    PURE: it decides, the caller records. Runs ONLY over rows unmatched on BOTH sides after pass 1,
    which is what makes position take precedence structurally rather than by a tiebreak.

    A blank serial never enters -- a row with no serial has nothing to be identified BY, and half a
    key is not a key. Both sides' descriptions are already non-blank (`_entered`)."""
    o_index = _unique_index([r for r in orig_unmatched if normalize_n2(r.serial)], _serial_key)
    r_index = _unique_index([r for r in rev_unmatched if normalize_n2(r.serial)], _serial_key)
    return [(o, r_index[k]) for k, o in o_index.items() if k in r_index]


def match_rows(original_rows, revised_rows, *, serial_second_pass: bool = False) -> RowMatchResult:
    """Pair the original's committed content rows with the revision's parsed content rows.

    PASS 1 (always, and it takes precedence): same Excel row + same N2 description, each position
    unique on both sides.

    PASS 2 (`serial_second_pass=True` ONLY -- AMENDMENT G): over the rows pass 1 left unmatched on
    BOTH sides, same N2 serial + same N2 description, that pair unique on both sides. The flag is
    KEYWORD-ONLY and defaults to False; see the module docstring for which consumer gets it and why
    the rate carry is the only one that may.
    """
    orig = _entered(original_rows)
    rev = _entered(revised_rows)
    original_ids = frozenset(r.row_id for r in orig)
    revised_ids = frozenset(r.row_id for r in rev)

    orig_by_pos = _unique_index(orig, lambda r: r.excel_row)
    rev_by_pos = _unique_index(rev, lambda r: r.excel_row)

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

    serial_matched: frozenset = frozenset()
    if serial_second_pass:
        pairs = _serial_second_pass(
            [r for r in orig if r.row_id not in o2r],
            [r for r in rev if r.row_id not in r2o],
        )
        for o, r in pairs:
            o2r[o.row_id] = r.row_id
            r2o[r.row_id] = o.row_id
        serial_matched = frozenset(o.row_id for o, _ in pairs)

    return RowMatchResult(
        original_to_revised=o2r,
        revised_to_original=r2o,
        original_ids=original_ids,
        revised_ids=revised_ids,
        serial_matched=serial_matched,
    )
