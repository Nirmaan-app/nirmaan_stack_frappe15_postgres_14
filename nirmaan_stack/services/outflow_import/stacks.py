# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Stacks: several INDISTINGUISHABLE transfers against several indistinguishable records.

PURE MODULE -- no `frappe`, no database, no request context. Callable from a plain unittest with no
bench, no site and no fixtures.

THE PROBLEM THIS SOLVES, IN THE OWNER'S OWN DATA. A vendor with SIX approved payments of Rs 9,000
and SEVEN transfers of Rs 9,000. Every transfer matches every payment equally well, so
`sole_suggestion` correctly refuses to pick one -- "the screen never guesses between two real
records" -- and all seven rows arrive with nothing pre-selected. Measured on the first real
statement: 58 rows in that state, and before the candidate-collapse fix was found, 124 doomed
confirmations because the screen HAD guessed and guessed the same record every time.

Refusing to guess is right ROW BY ROW and wrong for the SET. Six transfers against six payments has
exactly one sensible outcome -- settle each against one of them -- and which transfer goes with
which payment is a distinction without a difference when the records are interchangeable.

⚠️ "INTERCHANGEABLE" IS AN ASSUMPTION, NOT A FACT, AND THE OWNER MADE IT DELIBERATELY (ruling
2026-08-10). Six payments of Rs 9,000 to one vendor may sit on six DIFFERENT PROJECTS, and nothing
in a bank statement says which transfer paid which. An arbitrary pairing then produces the right
total and possibly the wrong project on every row. The owner accepted that in exchange for not
hand-pairing 58 rows a statement. TWO THINGS FOLLOW, and neither may be dropped as cosmetic:

  1. Every auto-paired row SAYS SO in its note, naming the stack it came from. The pairing is
     arbitrary; a reader is entitled to know that before confirming.
  2. Pairing is DETERMINISTIC (see `pair_stack`), so a re-run reproduces it exactly rather than
     reshuffling which transfer points at which payment under a reviewer mid-decision.

WHAT THIS MODULE IS NOT. It never settles, never reads a status, and never decides whether a
candidate is settleable -- `candidates.py` owns the pool and `status.py` owns the outcome. It takes
transfers and records that a caller has already established belong together, and answers one
question: does this set pair up 1:1, and if so how.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable, Sequence

from nirmaan_stack.services.outflow_import.disambiguate import NEAREST_DATE_WINDOW_DAYS

__all__ = [
    "StackKey",
    "Stack",
    "StackPair",
    "PAIR_BASIS_DATE",
    "PAIR_BASIS_ARBITRARY",
    "stack_key",
    "group_into_stacks",
    "pair_stack",
    "stack_note",
    "stack_surplus_note",
]

PAIR_BASIS_DATE = "date"
"""This pair was decided by a decision date that beat every rival still available."""

PAIR_BASIS_ARBITRARY = "arbitrary"
"""Nothing separated this pair -- the historic behaviour, and still the majority of them."""


@dataclass(frozen=True)
class StackPair:
    """One transfer, the record it was paired with, and WHETHER ANYTHING DECIDED IT.

    ⚠️ THE BASIS IS THE POINT OF THIS TYPE. `pair_stack` used to return bare `(transfer, record)`
    tuples, which was honest while every pairing was arbitrary and every note said so. Now that some
    are decided by evidence and some are not, a caller that cannot tell them apart has to either
    call all of them arbitrary -- wasting the evidence -- or none of them, which is a false claim on
    the majority. Both failures are silent, so the distinction travels WITH the pair.
    """

    transfer: object
    record: object
    basis: str

    @property
    def is_evidence(self) -> bool:
        return self.basis == PAIR_BASIS_DATE


@dataclass(frozen=True, order=True)
class StackKey:
    """What makes two transfers members of the same stack: THE SAME VENDOR ACCOUNT AND THE SAME
    AMOUNT (owner ruling 2026-08-10).

    ⚠️ THE AMOUNT IS COMPARED EXACTLY HERE, and that is a deliberate narrowing away from the +-Re 1
    window used everywhere else in this feature. Two reasons, and the second is the load-bearing one:

      * A tolerance window is NOT AN EQUIVALENCE RELATION. Amounts of 1.00, 1.90 and 2.80 pair-wise
        overlap at +-Re 1 but do not form a group -- 1.00 and 2.80 are Rs 1.80 apart. Grouping by a
        window therefore has no single correct answer; it depends on iteration order, which is
        exactly the kind of instability that makes a pairing reshuffle between two runs.
      * The window exists to absorb the bank ROUNDING A PAISE AMOUNT when comparing a transfer to a
        RECORD. Two transfers of the same repeated payment carry the same figure to the paise; there
        is nothing to absorb between them. The window still applies between a transfer and its
        record, upstream, where it belongs.

    ⚠️ THE ACCOUNT, NOT THE BENEFICIARY NAME. Names arrive from the bank in whatever form the payer
    typed; the account number is the identity. A row with no account cannot be stacked at all (see
    `stack_key`), because grouping on amount alone would put two unrelated vendors who both happened
    to be paid Rs 9,000 into one stack -- a coincidence, not an ambiguity.
    """

    account: str
    amount: Decimal


@dataclass(frozen=True)
class Stack:
    """One group of interchangeable transfers, with the records they could settle.

    `records` is the candidate set SHARED by the whole group. It is shared by construction: every
    member has the same account and the same amount, and those are the only two axes the candidate
    pool is filtered on, so asking each row separately would return the same set N times.
    """

    key: StackKey
    transfers: tuple
    records: tuple

    @property
    def size(self) -> int:
        return len(self.transfers)

    @property
    def is_balanced(self) -> bool:
        """Exactly as many records as transfers -- the case that pairs 1:1 with no leftovers."""
        return len(self.transfers) == len(self.records) and bool(self.transfers)

    @property
    def surplus_transfers(self) -> int:
        """Transfers with no record to take. The owner's 3 residual collisions are all this shape:
        the statement holds more transfers than the ledger holds records."""
        return max(len(self.transfers) - len(self.records), 0)

    @property
    def surplus_records(self) -> int:
        return max(len(self.records) - len(self.transfers), 0)


def stack_key(row) -> StackKey | None:
    """The stack a row belongs to, or `None` if it cannot be stacked.

    ⚠️ A BLANK ACCOUNT YIELDS `None` RATHER THAN AN EMPTY-STRING KEY, and the difference is not
    stylistic. An empty-string key groups every account-less row of the same amount into one stack
    -- transfers to unrelated parties that happen to share a figure -- and a balanced "stack" of
    those would auto-pair strangers to each other's payments. Refusing to stack them leaves them
    exactly where they were: open, and resolved by hand.
    """
    account = (getattr(row, "normalized_account", "") or "").strip()
    if not account:
        return None
    amount = getattr(row, "amount", None)
    if amount is None:
        return None
    return StackKey(account=account, amount=Decimal(amount))


def group_into_stacks(rows: Iterable, records_for) -> tuple[Stack, ...]:
    """Group rows into stacks and attach each stack's shared candidate records.

    `records_for(key, transfers)` is supplied by the caller because the records come from the
    database and this module does not touch it. It is called ONCE PER STACK, not once per row --
    the set is shared by construction (see `Stack.records`).

    ⚠️ GROUPS OF ONE ARE DROPPED. A single transfer is not a stack; it is the ordinary case, and it
    has already been through the per-row matcher, which either found it a sole candidate or
    deliberately declined to choose. Re-deciding it here would be a second opinion about a row that
    is not ambiguous in the way this module exists to resolve.

    Stacks come back in key order, so a caller that logs or reports them is stable run to run.
    """
    grouped: dict[StackKey, list] = {}
    for row in rows:
        key = stack_key(row)
        if key is None:
            continue
        grouped.setdefault(key, []).append(row)

    stacks: list[Stack] = []
    for key in sorted(grouped):
        transfers = _ordered_transfers(grouped[key])
        if len(transfers) < 2:
            continue
        stacks.append(
            Stack(key=key, transfers=transfers, records=tuple(records_for(key, transfers)))
        )
    return tuple(stacks)


def _transfer_date(row):
    """The day the money moved, as a plain `date`.

    `_StagedRow` exposes `added_on_date`; a raw row may carry only `added_on`, which is a datetime.
    Both are accepted because this module is pure and does not get to say who builds its input.
    """
    value = getattr(row, "added_on_date", None)
    if value is None:
        value = getattr(row, "added_on", None)
    if value is None:
        return None
    return value.date() if hasattr(value, "date") else value


def _date_ranked_pairs(transfers: Sequence, records: Sequence) -> list[tuple[int, int, int]]:
    """Every `(gap, transfer index, record index)` where BOTH sides carry a date, nearest first.

    Indices rather than objects: they are unique within an already-ordered sequence, so they make
    the sort total without needing the rows themselves to be comparable.
    """
    out: list[tuple[int, int, int]] = []
    for ti, transfer in enumerate(transfers):
        td = _transfer_date(transfer)
        if td is None:
            continue
        for ri, record in enumerate(records):
            rd = getattr(record, "decided_on", None)
            if rd is None:
                continue
            out.append((abs((rd - td).days), ti, ri))
    out.sort()
    return out


def pair_stack(stack: Stack) -> tuple["StackPair", ...]:
    """Pair a BALANCED stack 1:1, or return nothing.

    ⚠️ IT PAIRS ONLY WHEN THE COUNTS ARE EQUAL (owner ruling 2026-08-10). Unequal counts are the
    case a person has to resolve: with 7 transfers and 6 records, SOME transfer settles nothing, and
    choosing which one is a judgement about money that this module has no basis for. It returns an
    empty tuple rather than a partial pairing -- a partial one would silently decide the very
    question it cannot answer, and the leftover would look like an oversight rather than a decision.

    ⚠️ THE ORDER IS THE GUARANTEE. Transfers by `(added_on, name)`, records by `(doctype, name)`,
    then zipped. Both orders are total -- `name` is unique in each set, so no tie can survive to be
    broken by dict or query order. That is what makes a re-run reproduce the identical pairing
    instead of reshuffling which transfer points at which payment while a reviewer is mid-decision.
    Record names are sequential by creation in Frappe, so `name` order is also, incidentally, the
    order the payments were raised -- but the property being relied on is UNIQUENESS, not that.

    ⚠️ IT RE-ORDERS BOTH SIDES ITSELF RATHER THAN TRUSTING `stack.transfers`, and the first version
    of this function did not -- it ordered the records and took the transfers as given, because
    `group_into_stacks` had already sorted them. That made the determinism guarantee depend on WHO
    BUILT THE STACK: a `Stack` constructed anywhere else, in a test or by a later caller reading
    rows straight from a query, paired in whatever order the rows arrived. A function whose whole
    contract is "the same input gives the same pairing" cannot delegate half of that contract to its
    caller. Sorting an already-sorted sequence costs nothing.

    A record is never handed to two transfers: each index is consumed exactly once. Guarding a
    record against being claimed by a DIFFERENT stack is the caller's job, since only the caller can
    see across stacks.

    ⚠️ IT PAIRS BY DECISION DATE FIRST, AND FALLS BACK TO THE ZIP (2026-08-11). The zip above is
    ARBITRARY -- it always was, and every paired row had to say so. Where the records carry decision
    dates that actually separate them, the pairing is no longer a coin flip and the row should not
    claim it is: those pairs come back with `PAIR_BASIS_DATE` and a note that states the evidence.

    ⚠️ NO DATES, OR EVERY GAP TIED, REPRODUCES THE OLD ZIP EXACTLY -- and that is not luck, it is
    the reason the greedy is keyed on `(gap, transfer index, record index)` over ALREADY-ORDERED
    sequences. With no dates the ranked list is empty and everything falls through to the zip; with
    every gap equal the indices break every tie in order, which IS the zip. The dateless fixtures in
    `test_stacks` are the guard that says so.

    ⚠️ MEASURED ON THE FIRST REAL STATEMENT, AND THE HEADLINE IS SMALLER THAN IT SOUNDS: of 112
    stack pairings, 25 come out evidence-decided and 76 arbitrary -- but only TWO point at a
    different record than the arbitrary zip already chose. Most of what this pass buys is not a
    better pairing, it is a TRUE SENTENCE about a pairing that was already right: those 25 rows used
    to tell a reviewer the records were "interchangeable on amount" when they had been decided days
    apart. Do not let a later reader mistake the 25 for 25 corrections.
    """
    if not stack.is_balanced:
        return ()

    transfers = _ordered_transfers(stack.transfers)
    records = _ordered_records(stack.records)

    ranked = _date_ranked_pairs(transfers, records)
    taken_t: set[int] = set()
    taken_r: set[int] = set()
    by_transfer: dict[int, tuple[int, str]] = {}

    for gap, ti, ri in ranked:
        if ti in taken_t or ri in taken_r:
            continue
        # ⚠️ EVIDENCE ONLY IF IT BEAT SOMETHING -- but the comparison is against EVERY OTHER RECORD
        # IN THE STACK, not only the ones still free, and that distinction took a red test to find.
        #
        # Judged against the free ones, the LAST pair of any stack can never be evidence: there is
        # nothing left to be nearer than. That sounds conservative and is actually WRONG, because
        # the note it produces is a false statement -- "the records are interchangeable on amount"
        # said about two records decided a week apart, which is the one thing a reviewer would have
        # used to check it. Whether some other transfer got there first has no bearing on whether
        # the dates favour THIS pairing.
        #
        # A transfer that lost a nearer record to a rival still comes out ARBITRARY, which is
        # correct: it did not win on evidence, it took what was left.
        rivals = [g for g, t, r in ranked if t == ti and r != ri]
        basis = (
            PAIR_BASIS_DATE
            if rivals and gap < min(rivals) and gap <= NEAREST_DATE_WINDOW_DAYS
            else PAIR_BASIS_ARBITRARY
        )
        taken_t.add(ti)
        taken_r.add(ri)
        by_transfer[ti] = (ri, basis)

    # Whatever the date pass could not speak for is zipped in the original order -- the arbitrary
    # pairing, unchanged, over the leftovers.
    spare = [ri for ri in range(len(records)) if ri not in taken_r]
    for ti in range(len(transfers)):
        if ti in by_transfer:
            continue
        by_transfer[ti] = (spare.pop(0), PAIR_BASIS_ARBITRARY)

    return tuple(
        StackPair(
            transfer=transfers[ti],
            record=records[by_transfer[ti][0]],
            basis=by_transfer[ti][1],
        )
        for ti in range(len(transfers))
    )


def stack_note(stack: Stack, record_name: str, basis: str = PAIR_BASIS_ARBITRARY) -> str:
    """The sentence an auto-paired row carries, in place of the matcher's own.

    ⚠️ THE ARBITRARY WORDING IS AN OWNER-RULED SAFETY CONTROL, NOT PROSE. The owner accepted
    arbitrary pairing between interchangeable records; a note that read like an ordinary confident
    match would hide the one fact a reviewer needs in order to catch the case where the records were
    NOT interchangeable after all -- six payments of the same amount sitting on six different
    projects. "Check the project before confirming" is what turns an accepted risk into a reviewable
    one, and it must survive any edit to this function.

    ⚠️ THE DATE VARIANT DOES NOT DROP THAT INSTRUCTION, and the reason is worth stating because the
    opposite is tempting. A decision date says these two records are distinguishable; it does not
    say the pairing is on the right PROJECT, which is precisely where a wrong pick bills the wrong
    job. So the evidence is stated AND the check is still asked for: what changes is the claim, not
    the caution. (On the first real statement none of the 25 date-decided pairs were cross-project
    -- but only one stack spanned projects at all, so that is a fact about this statement, not a
    property of the rule, and it must not be read as one.)
    """
    lead = (
        f"One of {stack.size} identical transfers of {stack.key.amount} to this account, "
        f"paired 1:1 with {len(stack.records)} approved records. "
    )
    if basis == PAIR_BASIS_DATE:
        return (
            f"{lead}This one is assigned to {record_name}, which was decided closest to the day "
            f"this transfer moved -- nearer than any other record still available. "
            f"Check the project before confirming."
        )
    return (
        f"{lead}This one is assigned to {record_name}; the pairing between them is arbitrary "
        f"because the records are interchangeable on amount. Check the project before confirming."
    )


def stack_surplus_note(stack: Stack) -> str:
    """Why an UNBALANCED stack was left alone -- the sentence that replaced a whole screen.

    ⚠️ THIS EXISTS BECAUSE THE "RESOLVE N STACKS" DIALOG WAS DELETED (2026-08-11), AND WITHOUT IT
    THE REASONING WENT WITH IT. That dialog opened on a proposal and stated the surplus in words:
    seven transfers, six records, one settles nothing. Its rows now fall into the ordinary worklist
    as `Not-Matched`, and a row sitting there with the generic "could not choose" note tells a
    reviewer nothing about WHY it is unresolvable -- they would look for a seventh record that does
    not exist. Deleting a screen is allowed; deleting the explanation it carried is not.

    ⚠️ IT IS ONLY TRUE COMPUTED ACROSS IMPORTS, which is why `_resolve_stacks` writes it from a
    read that spans them. The other six transfers of this stack may sit in last month's batch, and
    a count taken inside one batch would state a surplus that is not the real one.
    """
    transfers = len(stack.transfers)
    records = len(stack.records)
    lead = (
        f"One of {transfers} identical transfers of {stack.key.amount} to this account, "
        f"against {records} approved record{'' if records == 1 else 's'}."
    )
    if records == 0:
        return (
            f"{lead} Every record at this amount is already spoken for by another transfer, so "
            f"there is nothing left for this one to settle. Link a record by hand, or leave it."
        )
    if transfers > records:
        spare = transfers - records
        return (
            f"{lead} There are {spare} more transfer{'' if spare == 1 else 's'} than records, so "
            f"at least {'one settles' if spare == 1 else f'{spare} settle'} nothing. Nothing was "
            f"paired automatically, because choosing which one goes without is a judgement about "
            f"money. Link the ones you can by hand."
        )
    spare = records - transfers
    return (
        f"{lead} There {'is' if spare == 1 else 'are'} {spare} more record{'' if spare == 1 else 's'} "
        f"than transfers, so at least {'one' if spare == 1 else f'{spare}'} will stay unpaid. "
        f"Nothing was paired automatically. Link the ones you can by hand."
    )


# A placeholder occupying the timestamp slot for rows that have none. The boolean ahead of it in
# the sort key puts every such row in its own bucket, so this value is only ever compared against
# ITSELF -- never against a real datetime, which would raise.
_NO_TIMESTAMP = 0


def _ordered_transfers(rows: Sequence) -> tuple:
    """⚠️ `added_on` MAY BE `None`, AND `None` CANNOT BE COMPARED TO A DATETIME. A single row with a
    missing timestamp would otherwise raise a TypeError in the middle of a match run and take the
    whole batch down with it -- so presence is the FIRST element of the sort key, which puts the
    timestamped rows first and keeps the two kinds from ever being compared to each other."""
    return tuple(
        sorted(
            rows,
            key=lambda r: (
                getattr(r, "added_on", None) is None,
                getattr(r, "added_on", None) or _NO_TIMESTAMP,
                getattr(r, "name", ""),
            ),
        )
    )


def _ordered_records(records: Sequence) -> tuple:
    return tuple(
        sorted(records, key=lambda t: (getattr(t, "doctype", ""), getattr(t, "name", "")))
    )
