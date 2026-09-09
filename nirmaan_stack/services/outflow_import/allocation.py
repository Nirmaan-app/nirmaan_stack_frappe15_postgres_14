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
    "allocation_note",
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
    """More has been written than the bank moved.

    ⚠️ ITS ONE GATE IS `allocate_row`'s POST-LOOP BACKSTOP, AND SINCE THE ROW LOCK LANDED
    (whole-branch review, F1) THAT BACKSTOP IS UNREACHABLE SINGLE-THREADED. `allocate_row` now
    takes `FOR UPDATE` on the `Outflow Import Row` before its loop, so every leg's `allocation_fits`
    is judged against legs no other transaction can be adding to; the per-leg check is therefore
    sufficient on its own and the sum cannot end the loop negative. IT IS KEPT ANYWAY, deliberately:
    it is the one assertion that reads the FINAL sum rather than a per-leg fit, so it is what would
    catch an arithmetic change to `allocation_fits`, a future caller that writes legs without
    consulting it, or a lock that gets weakened or dropped. Do not delete it as dead code -- a
    backstop being unreachable is what a backstop is for. Today's other settle paths (`settle_row`,
    `settle_row_partial`, the TDS-deduction branch, `create_expense`) each write EXACTLY ONE leg per
    row -- `_load_settleable_row` refuses a second call once `row_status` reads `Settled` -- and
    that one leg is chosen to match the transfer within `settle.py`'s own amount window before it
    ever reaches `_record_settlement`, so none of them can leave a row here either.

    ⚠️ THE TDS-DEDUCTION LEG WAS THE ONE PATH THAT COULD BREAK THIS, AND IT IS FIXED AT THE CALL
    SITE, NOT HERE. `settle.SettleResult.amount` on that path is the GROSS approved figure -- the
    payment record is deliberately never rewritten, and `tds_written` carries the withheld part
    separately -- so `_record_settlement` must write `amount - tds_written` as `target_amount`, not
    `amount`. Writing the gross would make this function permanently `True` for every TDS-touched
    row, invisible today only because `is_fully_allocated` is one-sided and would have surfaced the
    moment Task 4 started gating writes on this instead.
    """
    return remaining_of(row_amount, legs) < -AMOUNT_TOLERANCE


def allocation_note(
    row_amount,
    legs: Iterable[Mapping],
    new_status: str,
    *,
    created: bool = False,
    correction: tuple | None = None,
) -> str:
    """The sentence a reviewer reads. It states the BALANCE, never a leg count.

    ⚠️ A COUNT WOULD BE THE ONE NUMBER THAT CANNOT BE CHECKED. "3 of 6 allocated" invites the
    question "six according to whom?", and nothing in the data answers it -- the transfer does not
    know how many payments it was meant to cover. The remaining amount is checkable against the
    statement line by eye, which is what a reviewer actually needs.

    PURE, LIKE THE REST OF THIS MODULE (moved out of `api/outflow_import/expenses.py` at review,
    ADR-0020): it is arithmetic-plus-wording over legs, which is this module's job, and living in
    `api/` had put its "Partly allocated" branch outside the bench-free pure suite where nothing
    exercised it.

    ⚠️ `created` AND `correction` RESTORE WHAT THE DELETED `_settled_note` SAID (whole-branch
    review, F2). Task 3 replaced that function wholesale and dropped both facts from every
    persisted note:

      * `created` -- "Recorded" (a record this import BROUGHT INTO EXISTENCE, i.e. `create_expense`)
        versus "Settled" (a record that was already sitting there approved). A created expense read
        `Settled Project Expenses PE-x.` for the whole of Task 3, which claims something that was
        never true of it.
      * `correction` -- `(original_amount, amount)` when slice X1's rewrite edited an APPROVED
        figure to the bank's, else `None`. THE NOTE IS THE ONLY PLACE THAT FACT SURVIVES ON THE
        IMPORT'S OWN SCREEN. The `Version` log holds it durably, but nobody opens a Version log to
        answer "why is this payment 31 paise different from what I approved". The escape hatch that
        was supposed to carry it instead -- `_summary`'s `amount_changed` -- has never had a single
        reader in `frontend/src/`.

    Silent by design when nothing changed: a note saying "amount unchanged" on every ordinary row
    would train people to stop reading it.

    ⚠️ BOTH ARE PASSED IN, NOT REACHED FOR. This module is PURE and must not learn what a
    `SettleResult` is; the caller unpacks the two facts it needs. They also ride the `ROW_SETTLED`
    branch ONLY, and that is not an omission: a rewrite is `settle_row`'s alone
    (`allocate_row` passes `rewrite_amount_to_bank=False`) and `settle_row`'s STRICT whole-transfer
    guard means such a settlement always leaves the row fully allocated. A creation is the same
    shape. Neither fact can arise on a row that is still `Partially Allocated`.
    """
    # ⚠️ `.strip()`, MATCHING `_is_live` (F10). A padded `match_kind` would otherwise enter the SUM
    # -- which strips -- and vanish from the NAMES, so the note would state a balance it did not
    # account for. `.get` for the same reason `_is_live` uses it: nothing else in this module
    # indexes a leg mapping hard, and a leg missing a key must not raise inside a sentence builder.
    live = [leg for leg in legs if _is_live(leg)]
    if not live:
        return "Nothing is allocated against this transfer."
    names = ", ".join(
        f"{leg.get('target_doctype')} {leg.get('target_name')}" for leg in live
    )
    if new_status == ROW_SETTLED:
        verb = "Recorded" if created else "Settled"
        note = f"Fully allocated. {verb} {names}."
        if correction:
            original, corrected = correction
            note += (
                f" Amount corrected from {original} to {corrected} to match the transfer."
            )
        return note
    return (
        f"Partly allocated: {allocated_of(legs)} of {to_decimal(row_amount)}, "
        f"{remaining_of(row_amount, legs)} still to allocate. Settled {names}."
    )
