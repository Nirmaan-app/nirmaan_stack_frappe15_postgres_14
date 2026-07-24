"""The revision needs-review vocabulary -- pure, zero imports (ADR-0010 B1).

A leaf module on purpose: `carry.py` produces two of these codes and `diagnose.py` produces the
other five, so neither can own the taxonomy without the other importing it sideways. Both import
THIS, and the dependency graph stays acyclic:

    normalize.py  reasons.py          (leaves)
    row_match.py  -> normalize
    carry.py      -> row_match, reasons
    diagnose.py   -> row_match, normalize, reasons

WHY CODES, NOT PROSE. The backend ships a stable machine code and the frontend owns the sentence --
the same split `review_screen` already uses for structural breaks (`type` on the wire,
`WARN_BREAK_LABELS` in `ReviewTree.tsx`). Wording can then change without a migration, and the
grouping logic never keys on display text.

THE TAXONOMY IS TOTAL. Every non-copied CONTENT row of a revision sheet gets exactly one code --
there is no "other" and no silent gap. That is load-bearing rather than tidy: a row with no code
gets no `Needs Review` stamp, and a row with no stamp is invisible to the finalize gate. A gap here
is a row that escapes review, not a cosmetic miss.

BLANK-DESCRIPTION ROWS ARE NOT IN SCOPE. A spacer never entered the match, has nothing to classify
and demands nothing -- it stays unstamped, renders "Original", and is neither affirmable nor
gating.
"""

# ---------------------------------------------------------------------------
# The carry status this vocabulary attaches to
# ---------------------------------------------------------------------------

# The `revision_carry_status` value every non-copied content row carries. Its sibling is `COPIED`
# in `carry.py` (which owns the CARRY payload); this module owns the DIAGNOSIS half of the same
# Select. Blank remains the third value and means "not a revision row at all".
NEEDS_REVIEW = "Needs Review"


# ---------------------------------------------------------------------------
# The seven per-row reason codes
# ---------------------------------------------------------------------------

# Produced by `diagnose.py` (position / description axis):

#: This row's text appears NOWHERE in the original -- genuinely new content. Either it sits
#: immediately above a shift block and accounts for that block's offset, or it sits at a position
#: the original had no content row at (an append past the original's last row).
ROW_INSERTED = "row_inserted"

#: Same text as the original, at a DIFFERENT Excel row, because rows were added or removed above
#: it. Collateral damage of someone else's edit -- see COLLATERAL_REASONS.
POSITION_SHIFTED = "position_shifted"

#: The original had a content row at this exact position and the text there changed, with no shift
#: explaining it. An in-place edit. ALSO the deliberate fallback whenever the shift probe cannot
#: resolve an offset unambiguously -- see the safe-direction note below.
DESCRIPTION_CHANGED = "description_changed"

#: This Excel position occurs more than once on the revised or the original side, so `match_rows`
#: dropped it from that side outright ("drop both", owner call 2026-07-20). Nothing can be said
#: about the row until the duplicate is resolved.
DUPLICATE_POSITION = "duplicate_position"

#: A content row carrying no `source_row_number`, so it never entered the match at all. Should be
#: unreachable in production -- it exists so the taxonomy stays TOTAL rather than because it is
#: expected. If it ever fires, the row is still stamped, still affirmable and still gating.
NO_EXCEL_POSITION = "no_excel_position"

# Produced by `carry.py` (matched, but `build_review_carry` still refused):

#: The row matched perfectly -- same position, same words -- but its PARENT did not, so
#: both-or-neither refused the whole payload. The row's place in the tree is no longer established
#: by the original.
PARENT_NOT_CARRIED = "parent_not_carried"

#: Matched, but the original's committed record gave no usable answer (blank `row_class`, or a
#: matcher/node-map disagreement). Defensive; should never fire on real committed data.
SOURCE_UNCLASSIFIED = "source_unclassified"


ALL_REASONS: frozenset[str] = frozenset({
    ROW_INSERTED,
    POSITION_SHIFTED,
    DESCRIPTION_CHANGED,
    PARENT_NOT_CARRIED,
    DUPLICATE_POSITION,
    NO_EXCEL_POSITION,
    SOURCE_UNCLASSIFIED,
})


# ---------------------------------------------------------------------------
# Collateral vs causal -- the bulk-affirm boundary
# ---------------------------------------------------------------------------

#: Reasons a row can be affirmed in BULK, one shift block at a time. Deliberately a single member:
#: a shifted row is unchanged content that merely moved, so a reviewer confirming the block is
#: making one judgement about one edit, not rubber-stamping N unrelated rows.
#:
#: Everything NOT in here is CAUSAL and must be affirmed individually -- that asymmetry is what
#: keeps the finalize gate meaningful. There is deliberately no sheet-wide "affirm everything".
COLLATERAL_REASONS: frozenset[str] = frozenset({POSITION_SHIFTED})


def is_collateral(reason: str) -> bool:
    """True iff `reason` may be cleared by a block-level bulk affirm.

    THE SAFE DIRECTION, and why `diagnose` falls back to `DESCRIPTION_CHANGED` whenever the shift
    probe is ambiguous: a row mislabelled causal costs the reviewer one extra click, while a row
    mislabelled collateral can be bulk-affirmed without anyone ever looking at it. When the
    evidence is thin, over-report the causal label.
    """
    return reason in COLLATERAL_REASONS
