"""A record is claimed once -- the pure half.

THE CASE, MEASURED ON THE FIRST REAL STATEMENT. `sole_suggestion` asks a question about ONE row:
"did this transfer find exactly one approved record?" It is a good question and it is answered
independently for every row, which means two transfers can each find the SAME single record and
each be told, correctly, that they found exactly one. Five records were in that state across 15
rows; ten of the 807 confirms were doomed before anybody pressed the button, because a record can
be settled once and the second write fails with `AlreadyPaidError`.

⚠️ THE VENDOR ROLLUP IS WHY THIS BECAME URGENT RATHER THAN MERELY WRONG. The competing transfers
are usually to DIFFERENT beneficiaries -- one record was suggested to transfers for Saraswathi PG,
Nadeem khan, IN Engineering Works and Mohammad Aquib. A flat list puts them near each other when
sorted by amount, so a person could notice. A tree grouped by vendor puts them in four separate
branches, and the conflict becomes invisible from every screen position. The rollup does not create
the defect; it removes the last chance of seeing it.

⚠️ `_resolve_stacks` ALREADY GUARDS THIS, AND ONLY FOR ITSELF. It reads a `claimed` set before
pairing so the stack pass cannot hand out a record a 1:1 row is holding. That guard protects the
pass that has it. Nothing protected the per-row loop from itself, which is where all 15 came from.

WHY A PURE MODULE. Same reason as `stacks.py`: which row keeps a contested record is a rule, and
the rule has to be deterministic and testable without a database. This module decides; `review.py`
owns the writes, exactly as `stacks.py` decides and `_resolve_stacks` writes.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

__all__ = [
    "Claim",
    "ClaimOutcome",
    "resolve_claims",
    "claim_note",
]


@dataclass(frozen=True)
class Claim:
    """One row's hold on one record.

    `releasable` is the scope fence and it is load-bearing. A match run may only clear suggestions
    it is responsible for -- the rows of the batch it is running over. A row in ANOTHER batch that
    already holds this record keeps it: that row was not re-derived by this run, its note was not
    rewritten by this run, and silently stripping its pre-selection would change a screen somebody
    may be looking at for a reason they could not discover. So an unreleasable claim always wins,
    and this run's rows give way to it.

    `added_on` orders the contenders. It is a string because that is what the database hands over,
    and an empty one sorts first, which is the same fallback `_ordered_transfers` uses in
    `stacks.py`. The row name breaks the tie and is unique, so no tie survives to be broken by
    query order -- the same guarantee `pair_stack` relies on.
    """

    row: str
    record: tuple[str, str]
    added_on: str = ""
    releasable: bool = True


@dataclass(frozen=True)
class ClaimOutcome:
    """What the run must do about the contested records.

    `releases` names the rows whose suggestion must be cleared. `rivals` says, for each of those
    rows, how many transfers wanted that record in total -- which is the number the note needs, and
    the reason this is not just a set of row names.
    """

    releases: tuple[str, ...] = ()
    rivals: dict[str, int] = None  # row -> total contenders for the record it lost

    def __post_init__(self):
        if self.rivals is None:
            object.__setattr__(self, "rivals", {})


def resolve_claims(claims: Iterable[Claim]) -> ClaimOutcome:
    """Decide which rows keep a contested record and which must let go.

    ⚠️ IT RELEASES, IT NEVER REASSIGNS. A row that loses is left with NO suggestion, not with the
    next-best record. The whole point of the "exactly one, or nothing" rule is that the screen does
    not guess between two real records, and a transfer that lost a contest has not thereby been
    shown to belong to something else. It falls to a person, which is where it always belonged.

    ⚠️ AN UNRELEASABLE CLAIM WINS EVEN IF IT SORTS LAST. See `Claim.releasable`: the ordering
    decides between contenders this run may touch, and it is consulted only after the out-of-scope
    holders have taken the record. Two unreleasable claims on one record is a pre-existing conflict
    this run cannot fix -- the releasable ones still give way, because they could not win either
    way, and reporting a conflict by ALSO creating one would be a strange trade.
    """
    grouped: dict[tuple[str, str], list[Claim]] = {}
    for claim in claims:
        if not claim.row or not claim.record or not all(claim.record):
            continue
        grouped.setdefault(claim.record, []).append(claim)

    releases: list[str] = []
    rivals: dict[str, int] = {}

    for record in sorted(grouped):
        contenders = grouped[record]
        if len(contenders) < 2:
            continue

        held = [c for c in contenders if not c.releasable]
        if held:
            losers = [c for c in contenders if c.releasable]
        else:
            ordered = sorted(contenders, key=lambda c: (c.added_on or "", c.row))
            losers = ordered[1:]

        for loser in losers:
            releases.append(loser.row)
            rivals[loser.row] = len(contenders)

    return ClaimOutcome(releases=tuple(releases), rivals=rivals)


def claim_note(record_name: str, contenders: int) -> str:
    """What a row that lost a contested record says in the Outcome column.

    ⚠️ IT NAMES THE RECORD AND THE NUMBER, because without both the sentence is unactionable. "This
    needs a choice" tells a reviewer nothing they can act on; "PAY-00103-074 also matches 4 other
    transfers" tells them what to go and look at, and that the answer is not in this row alone.

    It deliberately does NOT say which transfer won. That row is a click away by searching the
    record id, and naming it here would read as a verdict about the other transfer -- which this
    module has no basis for. It ordered contenders; it did not investigate them.
    """
    others = max(contenders - 1, 1)
    transfers = "transfer" if others == 1 else "transfers"
    return (
        f"{record_name} also matches {others} other {transfers} at this amount, and one record can "
        f"be settled once. Choose which record this transfer settled, or link a different one."
    )
