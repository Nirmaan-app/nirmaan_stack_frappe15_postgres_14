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

__all__ = [
    "StackKey",
    "Stack",
    "stack_key",
    "group_into_stacks",
    "pair_stack",
    "stack_note",
]


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


def pair_stack(stack: Stack) -> tuple[tuple, ...]:
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

    A record is never handed to two transfers: `zip` over two same-length sequences consumes each
    exactly once. Guarding a record against being claimed by a DIFFERENT stack is the caller's job,
    since only the caller can see across stacks.
    """
    if not stack.is_balanced:
        return ()
    return tuple(zip(_ordered_transfers(stack.transfers), _ordered_records(stack.records)))


def stack_note(stack: Stack, record_name: str) -> str:
    """The sentence an auto-paired row carries, in place of the matcher's own.

    ⚠️ IT SAYS THE PAIRING WAS ARBITRARY, IN SO MANY WORDS, and that is the whole point of it. The
    owner accepted arbitrary pairing between interchangeable records; a note that read like an
    ordinary confident match would hide the one fact a reviewer needs in order to catch the case
    where the records were NOT interchangeable after all -- six payments of the same amount sitting
    on six different projects. "Check the project before confirming" is the instruction that turns
    an accepted risk into a reviewable one.
    """
    return (
        f"One of {stack.size} identical transfers of {stack.key.amount} to this account, "
        f"paired 1:1 with {len(stack.records)} approved records. "
        f"This one is assigned to {record_name}; the pairing between them is arbitrary because the "
        f"records are interchangeable on amount. Check the project before confirming."
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
