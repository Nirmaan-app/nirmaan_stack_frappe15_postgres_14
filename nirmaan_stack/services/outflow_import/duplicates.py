# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""How duplicate-heavy an uploaded statement is, and what to do about it (slice V3).

PURE MODULE -- no `frappe`, no database, no request context. It takes counts and returns a verdict.

THE RULE IS OWNER RULING Q2, OPTION B, and it has exactly two behaviours over one threshold:

    every row already imported   ->  REFUSE. Nothing is written: no File, no batch, no rows.
    90% or more already imported ->  WARN in the preview. Never blocks; you can always proceed.
    below 90%                    ->  import normally; duplicates stage and auto-skip with reasons.

⚠️ 90% IS ONE CONSTANT, and the owner said so in as many words: "say a different number and it
moves". `DUPLICATE_WARN_RATIO` is that number. Do not grow a second threshold beside it, and do not
make the refusal a ratio -- refusing is for the case where there is genuinely nothing new, which is
a COUNT (`new == 0`), not a percentage. A sheet 99.9% duplicated still has a row worth importing.

WHY REFUSE AT ALL, rather than importing an empty batch: a batch with nothing new in it is a
staging record nobody will ever action, sitting in the list looking like work. The message names the
earlier batch so the reader can go and look at the real one instead.

WHY THIS IS NOT THE SAFETY NET. The real guarantee that one transfer cannot settle the same record
twice is the DB unique constraint on `Outflow Row Match (transfer_id, target_doctype, target_name)`.
This module is ERGONOMICS -- a clear message and saved work. That is precisely what makes it safe
for the caller to narrow its duplicate lookup by period first: a missed duplicate here costs a
confusing row, not double-paid money.
"""

from __future__ import annotations

from dataclasses import dataclass

__all__ = [
    "DUPLICATE_WARN_RATIO",
    "DuplicateVerdict",
    "assess_duplicates",
]

# Owner ruling Q2. One number, deliberately.
DUPLICATE_WARN_RATIO = 0.90


@dataclass(frozen=True)
class DuplicateVerdict:
    """What an upload should do about the duplicates it found.

    `refuse` and `warn` are mutually exclusive: a refusal is not a loud warning, it is a different
    outcome, and a caller that treated both as "show a message" would import a batch with nothing
    in it.
    """

    total: int
    duplicates: int
    new: int
    refuse: bool
    warn: bool
    message: str
    earliest_batch: str | None = None

    @property
    def ratio(self) -> float:
        """Share of this statement already imported. 0.0 for an empty statement -- an empty file
        is a format problem, reported elsewhere, and must not read as 100% duplicated."""
        return (self.duplicates / self.total) if self.total else 0.0


def assess_duplicates(
    total: int,
    duplicates: int,
    earliest_batch: str | None = None,
    filename: str | None = None,
) -> DuplicateVerdict:
    """Decide refuse / warn / proceed for a statement with `duplicates` of `total` rows seen before.

    `earliest_batch` names the batch to point the reader at. It is optional because the message has
    to stay honest when the caller could not identify one -- a vague "already imported" beats naming
    the wrong batch.
    """
    total = max(int(total or 0), 0)
    duplicates = min(max(int(duplicates or 0), 0), total)
    new = total - duplicates

    if total == 0 or duplicates == 0:
        return DuplicateVerdict(
            total=total, duplicates=duplicates, new=new,
            refuse=False, warn=False, message="", earliest_batch=earliest_batch,
        )

    where = f" in batch {earliest_batch}" if earliest_batch else ""
    what = f"'{filename}'" if filename else "this file"

    if new == 0:
        return DuplicateVerdict(
            total=total, duplicates=duplicates, new=0,
            refuse=True, warn=False, earliest_batch=earliest_batch,
            message=(
                f"Not imported. All {total} transfers in {what} were already imported{where}. "
                f"Nothing in this file is new, so no records were created."
            ),
        )

    if duplicates / total >= DUPLICATE_WARN_RATIO:
        return DuplicateVerdict(
            total=total, duplicates=duplicates, new=new,
            refuse=False, warn=True, earliest_batch=earliest_batch,
            message=(
                f"Only {new} of {total} transfers in {what} are new. "
                f"The other {duplicates} were already imported{where}."
            ),
        )

    return DuplicateVerdict(
        total=total, duplicates=duplicates, new=new,
        refuse=False, warn=False, earliest_batch=earliest_batch,
        message=(
            f"{duplicates} of {total} transfers were already imported{where}. "
            f"They will be staged and skipped, not re-matched."
        ),
    )
