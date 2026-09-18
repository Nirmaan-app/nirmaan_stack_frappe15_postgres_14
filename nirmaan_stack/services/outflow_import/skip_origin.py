# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Who skipped a line that was skipped before `skip_origin` existed (#1273, parent #1270 Q17).

PURE: no `frappe`, no database. The back-fill patch (`patches/v3_0/backfill_outflow_skip_origin.py`)
reads the facts and writes the answer; this decides it.

⚠️ SINCE 2026-09-17 THE ORIGIN NO LONGER DECIDES UNSKIP -- the skip KIND does (`unskip_refusal`,
ADR-0022 Amendment C). The reasoning below is kept as the history of the back-fill it drove.

⚠️ EVERY DOUBT RESOLVES TO SYSTEM, AND THAT IS THE WHOLE DESIGN. A line called Manual can be unskipped;
a line called System cannot. Unskipping a system skip -- a duplicate, a transfer the bank refused, an
exclusion rule -- is how the same money gets recorded twice, while a hand skip wrongly called System
only costs someone a Desk edit. So Manual needs every piece of evidence at once:

  1. a person is on the line (`decided_by`) -- the old `review.skip_row` stamped one, and no system skip
     path ever has;
  2. `outcome_note` is not a sentence the software writes when it skips. The old endpoint accepted an
     ALREADY Skipped line and overwrote only `skip_reason`, so a system skip re-skipped by hand still
     carries its match-time sentence here (story 69);
  3. `skip_reason` is not one either -- an upload skip writes its sentence there;
  4. the line is not Cashbook, which keeps its own flow (Q16);
  5. the bank says the transfer succeeded.

Rule 5 is NOT in the ticket's wording and is added on purpose. An upload skip for a FAILED transfer
keeps its sentence only in `skip_reason`, which a hand re-skip overwrote -- so rules 1-4 alone would
call it Manual, and money the bank never moved would become unskippable, which story 59 forbids. Every
line staged as work is a success (`status.derive_staged_row_outcome` skips the rest), so this can only
ever move a line toward System.

⚠️ KNOWN LIMIT: an upload skip for a REPEAT (already imported, repeated in the file) or an EXCLUSION that
was later re-skipped by hand carries no trace of its first sentence and back-fills Manual. On the dev
database that shape does not occur (all seven decided skips carry a non-skip matcher note); the patch
prints what it classified so production can be checked.
"""

from nirmaan_stack.services.outflow_import.parser import BANK_SUCCESS_STATUS
from nirmaan_stack.services.outflow_import.skip_kinds import (
    SKIP_KIND_ALREADY_IMPORTED,
    SKIP_KIND_BANK_REFUSED,
    SKIP_KIND_NO_AMOUNT,
    SKIP_KIND_REPEATED_IN_FILE,
    SKIP_KINDS,
)
from nirmaan_stack.services.outflow_import.sources import source_runs_the_matcher
from nirmaan_stack.services.outflow_import.status import (
    OPEN_ROW_STATUSES,
    ROW_PARTIALLY_ALLOCATED,
    ROW_SETTLED,
    ROW_SKIPPED,
    SKIP_ORIGIN_MANUAL,
    SKIP_ORIGIN_SYSTEM,
    SYSTEM_SKIP_SENTENCES,
)

__all__ = [
    "UNSKIP_LOCKED_KINDS",
    "classify_skip_origin",
    "is_system_skip_sentence",
    "manual_skip_refusal",
    "unskip_refusal",
]

SKIP_REFUSED_SETTLED = "This transfer has already settled a record, so it cannot be skipped."
SKIP_REFUSED_PARTIALLY_ALLOCATED = (
    "This transfer has already settled part of its amount. Reverse its allocations before "
    "skipping it."
)
SKIP_REFUSED_ALREADY_SKIPPED = "This transfer is already skipped."
SKIP_REFUSED_NOT_OPEN = "This transfer is {status}, so it cannot be skipped."
SKIP_REFUSED_CASHBOOK = (
    "Cashbook lines can't be skipped here. The Cashbook import decides which of its lines to skip."
)


def manual_skip_refusal(*, row_status: str | None, source: str | None) -> str | None:
    """Why a person may NOT skip this line, as the sentence to show -- or `None` when they may (#1273).

    ⚠️ OPEN LINES ONLY, AND "ALREADY SKIPPED" IS REFUSED TOO. The old endpoint accepted a Skipped
    line, which let a system skip -- a duplicate, a refused transfer -- be relabelled a hand skip and
    so become unskippable. A Settled or Partially Allocated line has money written against it.

    ⚠️ CASHBOOK IS REFUSED BY SOURCE, whatever its status (parent #1270 Q16): its lines carry the plan
    its own job writes from, and the matcher never runs over them.
    """
    status = (row_status or "").strip()
    if status not in OPEN_ROW_STATUSES:
        if status == ROW_SETTLED:
            return SKIP_REFUSED_SETTLED
        if status == ROW_PARTIALLY_ALLOCATED:
            return SKIP_REFUSED_PARTIALLY_ALLOCATED
        if status == ROW_SKIPPED:
            return SKIP_REFUSED_ALREADY_SKIPPED
        return SKIP_REFUSED_NOT_OPEN.format(status=status or "in no known state")
    if not source_runs_the_matcher(source or ""):
        return SKIP_REFUSED_CASHBOOK
    return None


UNSKIP_REFUSED_NOT_SKIPPED = "This transfer is not skipped, so there is nothing to unskip."
UNSKIP_REFUSED_CASHBOOK = "Cashbook rows can't be unskipped."
UNSKIP_REFUSED_NO_KIND = "This transfer has no skip type, so it can't be unskipped."

# The four kinds that stay skipped, each with the sentence the disabled button shows (owner, 2026-09-17,
# decision A1). Every one names the SAME money being somewhere else, or no money at all:
#   * Already imported / Repeated in same file -- another line already holds this transfer, so bringing
#     this one back is the duplicate path itself;
#   * No amount -- nothing moved;
#   * Bank refused -- nothing moved, and the re-check would skip it again at once (a button that does
#     nothing is worse than a disabled one that says why).
UNSKIP_LOCKED_KINDS: dict[str, str] = {
    SKIP_KIND_ALREADY_IMPORTED: "The same transfer is in an earlier statement.",
    SKIP_KIND_REPEATED_IN_FILE: "The same transfer appears earlier in this statement.",
    SKIP_KIND_NO_AMOUNT: "No money moved on this line.",
    SKIP_KIND_BANK_REFUSED: "The bank never moved this money.",
}


def unskip_refusal(
    *, row_status: str | None, skip_kind: str | None, source: str | None
) -> str | None:
    """Why this line may NOT be unskipped, as the sentence to show -- or `None` when it may.

    ⚠️ KEYED ON THE SKIP KIND, NO LONGER ON THE ORIGIN (owner, 2026-09-17 -- REVERSES #1274's "Manual
    only", ADR-0022 Amendment C). Every kind may come back except `UNSKIP_LOCKED_KINDS`. What keeps the
    rest safe is the re-check `review.unskip_row` runs in the same transaction: a line whose money is
    still recorded is skipped again straight away, as Outflow / Inflow Already Recorded. A bank-rule
    kind has no such re-check (exclusions are decided at upload), so the popup warns before it goes back.

    ⚠️ A BLANK OR UNKNOWN KIND IS REFUSED. Every Skipped line was back-filled with a kind, so a blank
    one is a line nobody can vouch for.

    ⚠️ CASHBOOK IS REFUSED WHATEVER ITS KIND (parent #1270 Q16, owner decision B1). Its lines carry the
    plan its own job writes from, and the re-check an unskip runs never reaches them.
    """
    if (row_status or "").strip() != ROW_SKIPPED:
        return UNSKIP_REFUSED_NOT_SKIPPED
    if not source_runs_the_matcher(source or ""):
        return UNSKIP_REFUSED_CASHBOOK
    kind = (skip_kind or "").strip()
    if kind in UNSKIP_LOCKED_KINDS:
        return UNSKIP_LOCKED_KINDS[kind]
    if kind not in SKIP_KINDS:
        return UNSKIP_REFUSED_NO_KIND
    return None


# The fixed text before each template's first placeholder -- what every filled-in sentence starts with.
_SYSTEM_SKIP_PREFIXES = tuple(sentence.split("{", 1)[0] for sentence in SYSTEM_SKIP_SENTENCES)


def is_system_skip_sentence(text: str | None) -> bool:
    """Does `text` read as one of the sentences the software writes when it skips a line?"""
    text = (text or "").strip()
    return bool(text) and any(text.startswith(prefix) for prefix in _SYSTEM_SKIP_PREFIXES)


def classify_skip_origin(
    *,
    decided_by: str | None,
    outcome_note: str | None,
    skip_reason: str | None,
    source: str | None,
    status_raw: str | None,
) -> str:
    """`Manual` only when every rule in the module docstring holds; `System` otherwise."""
    manual = (
        bool((decided_by or "").strip())
        and not is_system_skip_sentence(outcome_note)
        and not is_system_skip_sentence(skip_reason)
        # Cashbook is the one source the matcher never runs over -- the same predicate the unskip
        # re-check refuses it by (`review.match_line`).
        and source_runs_the_matcher(source or "")
        and (status_raw or "").strip().upper() == BANK_SUCCESS_STATUS
    )
    return SKIP_ORIGIN_MANUAL if manual else SKIP_ORIGIN_SYSTEM
