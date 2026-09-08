# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""How much of a bank transfer has been allocated, and what that makes its row (ADR-0020).

PURE MODULE -- no frappe, no DB, no request context. It takes plain mappings so its tests run
without bench, and so the one arithmetic that decides a row's status has exactly one home.

⚠️ THERE IS NO COUNT ANYWHERE IN HERE, AND THAT IS THE DESIGN. "Have all the adjustments been made
against this transfer?" is answered by a BALANCE, never by a CARDINALITY. An aggregate over an open
set needs no count, which is precisely what makes an UNBOUNDED number of legs safe: no group id has
to be closed, no completion flag has to be flipped, and a leg arriving next month costs nothing.
The alternative -- a group id on the row plus a subset-sum search -- was analysed and rejected on
2026-08-10; the reasoning is kept struck-through under "Known limits" in
`.claude/context/domain/outflow-import.md`.

⚠️ `allocated` IS ALWAYS A FRESH SUM, NEVER `+= leg`. Root `CLAUDE.md`: "a derived field must be
RECOMPUTED FROM SOURCE, never incremented by a delta, so that any later ordinary save repairs it
exactly and a reconcile pass can always prove it."

⚠️ A REVERSED LEG CONTRIBUTES NOTHING, and an UNRECOGNISED kind contributes nothing either. Failing
closed matters here: a kind this module has never heard of counting as money would let a row read
`Settled` with nothing behind it.
"""

from decimal import Decimal
from typing import Iterable, Mapping

from nirmaan_stack.services.outflow_import.amounts import (
    AMOUNT_TOLERANCE,
    to_decimal,
)
from nirmaan_stack.services.outflow_import.status import (
    ROW_PARTIALLY_ALLOCATED,
    ROW_SETTLED,
)

__all__ = [
    "MATCH_SETTLED",
    "MATCH_REVERSED",
    "allocated_of",
    "remaining_of",
    "is_fully_allocated",
    "status_for_allocation",
    "allocation_fits",
    "is_over_allocated",
]

# The `Outflow Row Match.match_kind` vocabulary, owned here rather than on the doctype controller,
# so the arithmetic and the write path read one definition.
MATCH_SETTLED = "Settled"
MATCH_REVERSED = "Reversed"


def _is_live(leg: Mapping) -> bool:
    return (leg.get("match_kind") or "").strip() == MATCH_SETTLED


def allocated_of(legs: Iterable[Mapping]) -> Decimal:
    """How much of the transfer has actually been written, right now."""
    return sum(
        (to_decimal(leg.get("target_amount")) for leg in legs if _is_live(leg)),
        Decimal("0"),
    )


def remaining_of(row_amount, legs: Iterable[Mapping]) -> Decimal:
    """What is left to allocate. Signed: negative means over-allocated."""
    return to_decimal(row_amount) - allocated_of(legs)


def is_fully_allocated(row_amount, legs: Iterable[Mapping]) -> bool:
    """⚠️ ONE-SIDED ON `remaining_of`, NOT `amounts_match`'S ABS-DIFFERENCE WINDOW, AND DELIBERATELY
    SO (fixed while implementing this module -- the two-sided form fails
    `test_over_allocation_still_reads_settled_rather_than_inventing_a_status`). An over-allocated
    row (more written against it than the bank moved, however that happened) has nothing left to
    allocate either -- `status_for_allocation` has no fourth status to give that case, and the write
    path (`is_over_allocated`) is what refuses to leave a row there in the first place. This only
    has to answer honestly if a stray one gets through, and "remaining is very negative" must still
    read as fully allocated, not as `Partially Allocated`.

    ⚠️ THE SAME `AMOUNT_TOLERANCE` AS EVERY OTHER WINDOW IN THIS FEATURE, and this is where a paise
    gap lands: the allocation path never rewrites a payment's amount (it cannot -- the bank's figure
    is the whole transfer, not any one leg), so rounding is absorbed here instead.
    """
    return remaining_of(row_amount, legs) <= AMOUNT_TOLERANCE


def status_for_allocation(row_amount, legs: Iterable[Mapping], *, fallback: str) -> str:
    """The row's status, derived from its legs.

    `fallback` is what the row becomes when NOTHING is allocated -- after the last leg is reversed,
    say. It is the CALLER's to decide (`Matched` if a suggestion survives, else `Mismatched`),
    because this module cannot see the row's suggestion and must not guess one.
    """
    if not allocated_of(legs):
        return fallback
    return ROW_SETTLED if is_fully_allocated(row_amount, legs) else ROW_PARTIALLY_ALLOCATED


def allocation_fits(row_amount, legs: Iterable[Mapping], candidate_amount) -> bool:
    """May this record be allocated to what is left?

    ⚠️ DELIBERATELY WEAKER THAN `settle_row`'s guard, which demands the record match the WHOLE
    transfer. A leg is by definition smaller than the transfer, so the only thing that can be
    asserted is that it does not exceed the remainder. What catches a wildly wrong pick instead is
    that the row never reaches `Settled` -- it sits at `Partially Allocated` with a visible leftover
    balance. Visible, not silent, which is the whole argument for the weakening (ADR-0020).
    """
    return to_decimal(candidate_amount) <= remaining_of(row_amount, legs) + AMOUNT_TOLERANCE


def is_over_allocated(row_amount, legs: Iterable[Mapping]) -> bool:
    """More has been written than the bank moved. The write path refuses to leave a row here."""
    return remaining_of(row_amount, legs) < -AMOUNT_TOLERANCE
