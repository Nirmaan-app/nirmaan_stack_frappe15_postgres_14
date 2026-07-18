"""D7 review carry -- pure payload builder, no Frappe imports (ADR-0010 B1).

Given the D6 match (row_match.match_rows), the original's committed node fields, and the
revision's freshly-parsed rows, decide -- per revised row -- the `revision_carry_status` stamp
plus the human OVERRIDE SET to carry. The caller (`api/boq/wizard/review_carry.py`) reads the
DB and applies the returned writes; this module is pure so the trap-laden re-point + drift
logic is unit-testable with plain dicts.

The rules (ADR-0014 D7):

  * Carry the OVERRIDE SET ONLY -- never the effective value. ~87% of rows carry nothing (the
    revision's own parse reproduces the parser layer for free); only the human's corrections
    move. Wholesale-stamping the effective value was rejected (it flips every matched row to
    "Edited" and blocks the AI flow).

  | carry           | source (committed BOQ Nodes)                          | write (review row)      |
  |-----------------|-------------------------------------------------------|-------------------------|
  | classification  | `human_classification` (non-blank only)               | `human_classification`  |
  | parent          | `human_parent >= 0` => `parent_node` -> D6 twin        | `human_parent` (twin idx)|
  | root            | `human_is_root = 1`                                   | `human_is_root=1`, `human_parent=-1` |

  * Parent re-point is RELATIONAL: `parent_node` (the effective-parent node NAME) indexes the
    twin map straight to the twin's revised `row_index`. NEVER `sort_order` (that is the
    ORIGINAL's row_index -- a trap). A MISSING twin (the parent has no D6 match) => the parent
    override is dropped and that row's parenting reverts to the fresh parser (D7 "-> review").

  * `-1` is written explicitly for a root's parent (Frappe coerces Int None->0, and 0 is a
    valid row_index). A twin at row_index 0 is a REAL override -- 0 there is correct, not the
    sentinel. `level` is NEVER carried (ADR-0009: it re-derives from the effective tree; the
    `BOQ Nodes` controller throws if a stale level is planted).

  * Drift: a MATCHED row with NO carried classification override whose original effective
    `row_class` != the revision's fresh parser `classification` => `Drifted` (needs-action).
    Read `row_class` (the full taxonomy), never `node_type` (a lossy 3-value projection).

  Status stamps map 1:1 to the `BoQ Review Row.revision_carry_status` Select options. REMOVED
  is never a value -- it is an original-side outcome (no revised row exists to stamp).
"""

from dataclasses import dataclass

from nirmaan_stack.services.boq_revision.row_match import (
    AMBIGUOUS,
    MATCHED,
    NEW,
    RowMatchResult,
)

DRIFTED = "Drifted"


@dataclass(frozen=True)
class ReviewCarryWrite:
    """The field updates for ONE revised review row.

    A None field means "leave the review row's fresh-parse default untouched" -- the caller
    writes only the non-None fields. `human_parent` is an explicit int when carried (a twin's
    row_index, or -1 for a root); None means "no parent override, keep the parser default -1".
    """

    revision_carry_status: str          # Matched | New | Ambiguous | Drifted
    human_classification: str | None = None
    human_parent: int | None = None
    human_is_root: int | None = None


def build_review_carry(revised_rows, original_by_id, match: RowMatchResult) -> dict:
    """Decide the carry write per revised content row (see module docstring).

    Args:
      revised_rows    -- iterable of dicts, one per revised CONTENT row (the ones fed to the
                         matcher): each has "row_id" (revised row_index) and "classification"
                         (the fresh parser value, for drift).
      original_by_id  -- {original row_id (committed node name) -> node fields dict}, each with
                         "row_class", "human_classification", "human_parent", "human_is_root",
                         "parent_node". Duck-typed .get() -- a frappe._dict works verbatim.
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
        carry_classification = (node.get("human_classification") or "").strip() or None
        carry_parent: int | None = None
        carry_is_root: int | None = None

        if node.get("human_is_root"):
            # Root override: explicit is-root + the -1 no-parent sentinel. Root != no-parent.
            carry_is_root = 1
            carry_parent = -1
        else:
            human_parent = node.get("human_parent")
            if human_parent is not None and human_parent >= 0:
                # Parent override: re-point through the parent NODE -> its D6 twin's row_index.
                parent_name = node.get("parent_node")
                twin = match.original_to_revised.get(parent_name) if parent_name else None
                if twin is not None:
                    carry_parent = twin
                # else: missing twin -> drop the parent, parenting reverts to the parser.

        # Drift: a MATCHED row that carried NO override at all (D7 "no carried override") whose
        # original effective row_class disagrees with the fresh parser classification. A row that
        # carried any human decision is a calm "Matched" -- the human already engaged with it, so
        # Edited and Drifted stay disjoint sets.
        carried_nothing = carry_classification is None and carry_parent is None and carry_is_root is None
        drifted = carried_nothing and (node.get("row_class") or "") != (rr.get("classification") or "")

        out[rid] = ReviewCarryWrite(
            revision_carry_status=DRIFTED if drifted else MATCHED,
            human_classification=carry_classification,
            human_parent=carry_parent,
            human_is_root=carry_is_root,
        )
    return out
