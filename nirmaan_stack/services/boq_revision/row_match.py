"""D6 row match -- pure, no Frappe imports (ADR-0010 B1).

At the post-parse merge seam (D7), the revision's freshly-parsed rows are matched to the
original's committed rows so the human's classification + parenting overrides can carry
forward. This module is the PURE match: it takes minimal per-row descriptors from BOTH sides
and returns the four-way outcome + the twin map. It never touches the DB -- the caller
(`api/boq/wizard/review_carry.py`) reads the committed `BOQ Nodes` and the revised
`BoQ Review Row`s and hands the primitives here.

The rule (ADR-0014 D6):

  * Key = N2-normalized joined `description` (the single `normalize.normalize_n2` home shared
    with sheets D3 and columns D5). Description-primary; content is rich and near-unique, so it
    is the good key for rows (columns invert this -- see D5). NO fuzzy tier in v1: fuzzy
    similarity is exactly what silently carries a wrong rate.

  * The duplicate tiebreak = the nearest preceding SECTION header (a strictly shallower parser
    `level`, in physical `source_row_number` order) then physical ordinal. Both inputs are
    parser-native and human-edit-immune: a row moved LOGICALLY B->A still sits PHYSICALLY under
    B on both sides, so the tiebreak survives a re-parent.

  Outcomes (N = original count for a key, M = revised count):
    | N=1, M=1  | MATCHED   -- section IGNORED (the forced pairing is rename-proof)          |
    | N=M>1     | disambiguate by section header then ordinal; unresolved -> AMBIGUOUS       |
    | N!=M (both>0) | whole group AMBIGUOUS                                                  |
    | N>0, M=0  | REMOVED   -- an ORIGINAL-side outcome (surfaces as the removed advisory)   |
    | N=0, M>0  | NEW                                                                       |

  *Why section is relaxed at N=M=1:* dropped ONLY when the description is globally unique on
  both sides, so exactly one candidate exists each way -- the pairing is forced, no collision
  is possible, and it rescues the common cosmetic section rename.

  Blank-description rows are NEVER matched (the caller filters them before calling; the key ""
  is also skipped defensively). A blank/spacer row carries nothing and demands nothing -- it is
  left with no `revision_carry_status`, the calm default.

  `original_to_revised` is keyed by the caller's ORIGINAL row_id (the committed node NAME):
  D7's parent re-point resolves `parent_node` (a node name) straight through this map to the
  twin's revised row_id, so the "-> source_row_number ->" hop in the ADR is conceptual, not a
  second lookup.
"""

from collections import defaultdict
from dataclasses import dataclass
from typing import Hashable

from nirmaan_stack.services.boq_revision.normalize import normalize_n2

MATCHED = "Matched"
NEW = "New"
REMOVED = "Removed"
AMBIGUOUS = "Ambiguous"


@dataclass(frozen=True)
class MatchRow:
    """A minimal row descriptor for D6 matching -- either side.

    row_id      -- opaque STABLE identity within its own side. The caller keys its own data by
                   this: original = committed node NAME (so `parent_node` indexes it directly),
                   revised = `row_index`.
    description -- raw joined description; N2-normalized internally for the key.
    order       -- physical order within the sheet (`source_row_number`). Drives the
                   section-header lookup and the ordinal tiebreak.
    level       -- parser `level`: numeric for section/preamble rows, None for everything else
                   (both sides share this convention -- ADR-0009). Used ONLY for the
                   duplicate-description section tiebreak.
    """

    row_id: Hashable
    description: str
    order: int
    level: int | None = None


@dataclass(frozen=True)
class RowMatchResult:
    """The D6 match between one sheet's original + revised content rows."""

    original_outcome: dict  # original row_id -> MATCHED | REMOVED | AMBIGUOUS
    revised_outcome: dict   # revised row_id  -> MATCHED | NEW | AMBIGUOUS
    original_to_revised: dict  # MATCHED: original row_id -> revised row_id (the twin map)
    revised_to_original: dict  # MATCHED: revised row_id  -> original row_id


def _is_shallower(candidate_level, row_level) -> bool:
    """True iff a candidate header at `candidate_level` is a valid section header for a row at
    `row_level`: the candidate must carry a numeric level, and the row must be strictly deeper
    (a level-less row -- level None -- is always deeper than any numeric header)."""
    if candidate_level is None:
        return False
    return row_level is None or candidate_level < row_level


def _section_keys(rows) -> dict:
    """Map each row_id -> its section key: the N2 description of the nearest preceding row (in
    physical `order`) at a strictly shallower parser level. "" when there is no such header.

    A monotonic stack of numeric-level rows (increasing level bottom->top) gives O(n): only
    rows WITH a numeric level can be section headers; a level-less row consults the stack but
    never joins it.
    """
    ordered = sorted(rows, key=lambda r: (r.order, str(r.row_id)))
    stack: list = []  # candidate headers, strictly increasing level bottom -> top
    out: dict = {}
    for r in ordered:
        while stack and not _is_shallower(stack[-1].level, r.level):
            stack.pop()
        out[r.row_id] = normalize_n2(stack[-1].description) if stack else ""
        if r.level is not None:
            stack.append(r)
    return out


def _by_key(rows) -> dict:
    """Bucket rows by N2 description key (blank keys dropped -- never matched)."""
    out: dict = defaultdict(list)
    for r in rows:
        key = normalize_n2(r.description)
        if key:
            out[key].append(r)
    return out


def match_rows(original_rows, revised_rows) -> RowMatchResult:
    """Match the original's committed content rows to the revision's parsed content rows (D6).

    Callers pass content rows only (non-blank N2 description); a blank row is skipped here too.
    """
    orig_by_key = _by_key(original_rows)
    rev_by_key = _by_key(revised_rows)
    orig_section = _section_keys(original_rows)
    rev_section = _section_keys(revised_rows)

    original_outcome: dict = {}
    revised_outcome: dict = {}
    o2r: dict = {}
    r2o: dict = {}

    def _pair(o: MatchRow, r: MatchRow) -> None:
        original_outcome[o.row_id] = MATCHED
        revised_outcome[r.row_id] = MATCHED
        o2r[o.row_id] = r.row_id
        r2o[r.row_id] = o.row_id

    for key in set(orig_by_key) | set(rev_by_key):
        origs = orig_by_key.get(key, [])
        revs = rev_by_key.get(key, [])
        n, m = len(origs), len(revs)

        if n and not m:
            for o in origs:
                original_outcome[o.row_id] = REMOVED
        elif not n and m:
            for r in revs:
                revised_outcome[r.row_id] = NEW
        elif n == 1 and m == 1:
            # Forced pairing -- section IGNORED, so a cosmetic section rename still matches.
            _pair(origs[0], revs[0])
        elif n == m:
            # N == M > 1: disambiguate within the duplicate cluster by section then ordinal.
            _disambiguate(origs, revs, orig_section, rev_section, _pair,
                          original_outcome, revised_outcome)
        else:
            # N != M, both > 0 -> the whole group is ambiguous on both sides.
            for o in origs:
                original_outcome[o.row_id] = AMBIGUOUS
            for r in revs:
                revised_outcome[r.row_id] = AMBIGUOUS

    return RowMatchResult(
        original_outcome=original_outcome,
        revised_outcome=revised_outcome,
        original_to_revised=o2r,
        revised_to_original=r2o,
    )


def _disambiguate(origs, revs, orig_section, rev_section, pair,
                  original_outcome, revised_outcome) -> None:
    """N == M > 1 duplicate cluster: sub-bucket by section header, pair k-th<->k-th by physical
    ordinal within a section that has equal counts on both sides; anything else is AMBIGUOUS."""
    o_by_sec: dict = defaultdict(list)
    for o in origs:
        o_by_sec[orig_section.get(o.row_id, "")].append(o)
    r_by_sec: dict = defaultdict(list)
    for r in revs:
        r_by_sec[rev_section.get(r.row_id, "")].append(r)

    for sec in set(o_by_sec) | set(r_by_sec):
        os_ = sorted(o_by_sec.get(sec, []), key=lambda x: x.order)
        rs_ = sorted(r_by_sec.get(sec, []), key=lambda x: x.order)
        if os_ and rs_ and len(os_) == len(rs_):
            for o, r in zip(os_, rs_):
                pair(o, r)
        else:
            for o in os_:
                original_outcome[o.row_id] = AMBIGUOUS
            for r in rs_:
                revised_outcome[r.row_id] = AMBIGUOUS
