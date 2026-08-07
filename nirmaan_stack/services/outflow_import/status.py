# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Row and batch status derivation (Bulk Import Outflow, slice V0).

PURE MODULE -- no `frappe`, no database, no request context, and as of v3 no imports from this
package at all.

THE SINGLE DERIVER (ADR-0010 B3). Every `row_status` and every `Outflow Import Batch.status` in this
feature comes from here. Nothing else -- no endpoint, no controller, no frontend -- may compute one.
The frontend mirrors these rules in `outflowImportStatus.ts` and is pinned to this module by a
parity test; that mirror is a convenience, and this file is the authority.

⚠️ THIS FILE WAS REWRITTEN AT THE v3 REVERSAL (owner, 2026-08-06). The v2 spine was "the payment
branch never writes"; the new spine is:

    The import pays what someone has already approved. It never approves anything, and it never
    creates a Project Payment.

All three ledgers -- `Project Payments`, `Project Expenses`, `Non Project Expenses` -- settle
`Approved -> Paid` and nothing else. Anything in the surrounding v2 code that reads as though the
payment branch is read-only is history, not instruction. Spec: `docs/outflow-import/workflow.html`
section 0.

THE VOCABULARY -- seven statuses, and what a reviewer does with each:

    Pending match run   Staged from the sheet. Nothing has been looked up yet.  -> press Run match
    Matched             At least one APPROVED record was found at this amount.  -> confirm it
    Unmatched           The match ran and found nothing settleable.             -> create or link
    Mismatched          Amounts disagree. AMOUNTS ONLY -- never a reference.    -> resolve it
    Settled             We wrote. The record is now Paid and linked back.       -> terminal
    Skipped             Nothing to do, and the reason says which nothing.       -> terminal
    Error               The write was attempted and rolled back.                -> retry

FOUR RULES THAT LOOK LIKE DETAILS AND ARE NOT:

1. ONLY `Approved` RECORDS ARE EVER MATCHED. A transfer against a `Requested` or `CEO Pending`
   payment is simply `Unmatched`. There is no "matched but not approved" status, no approval nudge
   and no deep link into an approval queue -- nothing that cannot be settled is offered. This
   REVERSES an earlier stated goal (surfacing the 111 CEO-Pending payments, Rs 88.8 L); it was
   removed deliberately and must not be re-added. Enforcing it is `candidates.py`'s job -- this
   module simply never sees a non-Approved candidate, so `Matched` cannot lie.

2. THE ALREADY-PAID DUPLICATE CHECK SURVIVES, AND IT IS A SKIP, NOT A MATCH (owner ruling Q14). It
   is fed in through `paid_duplicate`, which comes from a query kept VISIBLY SEPARATE from the
   candidate query precisely so a later reader cannot mistake one for the other. Without it, a
   payment somebody ticked Paid by hand before uploading comes back `Unmatched`, and the obvious
   next click records the same money a second time. Mixed usage -- half a statement hand-ticked --
   is the NORMAL case under owner ruling Q12, not an edge case.

3. `Mismatched` IS ABOUT AMOUNTS, FULL STOP. The v2 `Reference mismatch` branch is DELETED, not
   folded in: the owner asked why the system would compare a stored reference on a payment that is
   already Paid, and there was no answer. A reference is now only ever WRITTEN into a blank, never
   compared. That deletion is also why this module no longer imports `matcher` -- the basis string
   was needed by the reference branch and by nothing else.

4. `Mismatched` MUST STAY RESOLVABLE. It is an OPEN status, and the screen gives it the same full
   decision dialog as any other open row. Reporting a disagreement with no way to act on it was the
   defect the owner named.

PRECEDENCE IS DELIBERATE. Duplicates and failed transfers are settled before anything is matched,
because both describe money that must not be recorded again -- or at all -- whatever a lookup would
otherwise find. The already-Paid check then runs BEFORE the candidate check, which is safe because
an already-Paid record is not in the candidate pool at all (rule 1), so the two can never contend.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable, Sequence

__all__ = [
    "ROW_PENDING_MATCH",
    "ROW_MATCHED",
    "ROW_UNMATCHED",
    "ROW_MISMATCHED",
    "ROW_SETTLED",
    "ROW_SKIPPED",
    "ROW_ERROR",
    "ROW_STATUSES",
    "TERMINAL_ROW_STATUSES",
    "OPEN_ROW_STATUSES",
    "BATCH_DRAFT",
    "BATCH_IN_REVIEW",
    "BATCH_PARTIALLY_SETTLED",
    "BATCH_COMPLETED",
    "BATCH_STATUSES",
    "RowOutcome",
    "Suggestion",
    "derive_staged_row_outcome",
    "derive_row_outcome",
    "sole_suggestion",
    "derive_batch_status",
    "derive_batch_counters",
    "SKIP_REASON_NOT_SUCCESSFUL",
    "SKIP_REASON_ALREADY_IMPORTED",
    "SKIP_REASON_DUPLICATE_IN_FILE",
    "SKIP_REASON_ALREADY_PAID",
]

ROW_PENDING_MATCH = "Pending match run"
ROW_MATCHED = "Matched"
ROW_UNMATCHED = "Unmatched"
ROW_MISMATCHED = "Mismatched"
ROW_SETTLED = "Settled"
ROW_SKIPPED = "Skipped"
ROW_ERROR = "Error"

# The vocabulary in the order a reviewer meets it. The doctype's `row_status` Select carries this
# exact list in this exact order, and so does the frontend mirror.
ROW_STATUSES = (
    ROW_PENDING_MATCH,
    ROW_MATCHED,
    ROW_UNMATCHED,
    ROW_MISMATCHED,
    ROW_SETTLED,
    ROW_SKIPPED,
    ROW_ERROR,
)

# Terminal = nobody owes this row anything further.
#
# ⚠️ THIS IS NARROWER THAN v2, AND THE NARROWING IS THE POINT. Under v2 a read-only FINDING was
# terminal, because reporting it WAS the whole job. Under v3 the import settles, so a row that
# found something and has not been confirmed is unfinished work -- `Matched` and `Mismatched` are
# both OPEN. Only a row we wrote (`Settled`) or deliberately declined (`Skipped`) is done.
TERMINAL_ROW_STATUSES = frozenset({ROW_SETTLED, ROW_SKIPPED})

# Open = a person still owes this row a decision. Everything that is not terminal.
OPEN_ROW_STATUSES = frozenset(
    {ROW_PENDING_MATCH, ROW_MATCHED, ROW_UNMATCHED, ROW_MISMATCHED, ROW_ERROR}
)

BATCH_DRAFT = "Draft"
BATCH_IN_REVIEW = "In Review"
BATCH_PARTIALLY_SETTLED = "Partially Settled"
BATCH_COMPLETED = "Completed"

# ⚠️ `Completed with exceptions` is GONE (owner ruling). It preserved a signal the three tabs --
# Pending / Settled / Skipped -- now show directly, and it made a batch closed with work
# outstanding indistinguishable from one where the work was genuinely finished only by reading a
# second field. Closing a batch is bookkeeping: it records `closed_at`, and the derived status
# stays honest about how much is actually decided.
BATCH_STATUSES = (BATCH_DRAFT, BATCH_IN_REVIEW, BATCH_PARTIALLY_SETTLED, BATCH_COMPLETED)

SKIP_REASON_NOT_SUCCESSFUL = "Transfer did not succeed at the bank ({status})."
SKIP_REASON_ALREADY_IMPORTED = "Already imported in batch {batch}."
SKIP_REASON_DUPLICATE_IN_FILE = "This transfer appears earlier in the same statement."
SKIP_REASON_ALREADY_PAID = "Already recorded as Paid on {records}."


@dataclass(frozen=True)
class RowOutcome:
    """A derived status plus the sentence that explains it to a reviewer.

    `note` is written for a person, not parsed. It carries the amount delta and its implied rate,
    the record already recorded as Paid, or how many approved candidates were found.
    """

    status: str
    note: str = ""

    @property
    def is_terminal(self) -> bool:
        return self.status in TERMINAL_ROW_STATUSES


@dataclass(frozen=True)
class Suggestion:
    """The ONE record a matched row should open with already chosen.

    A pair rather than a whole target, because that is all the screen needs and all the import row
    stores: `(target_doctype, target_name)` addresses any of the three ledgers.
    """

    doctype: str
    name: str


def derive_staged_row_outcome(
    row,
    already_imported_in: str | None = None,
    duplicate_in_file: bool = False,
) -> RowOutcome:
    """The outcome a row gets AT UPLOAD, before any matching has run.

    A separate entry point rather than a mode flag on `derive_row_outcome`, because the two answer
    genuinely different questions. At upload there IS no match, so "did this find a record?" is
    unanswerable -- and `derive_row_outcome` would answer `Unmatched`, which is a FINDING and would
    be a lie about work that has not happened yet. Only the facts knowable without matching are
    decided here; everything else stays `Pending match run`.

    `duplicate_in_file` covers the same transfer id appearing TWICE IN ONE STATEMENT, which is
    different from `already_imported_in` (the same transfer in an EARLIER batch) and has to be
    caught separately because the cross-batch lookup cannot see the file it is currently reading.
    Leaving it uncaught is not cosmetic: both copies would offer the same record, and settling both
    would violate the `Outflow Row Match` unique constraint.

    Skip reasons are shared verbatim with `derive_row_outcome`, so a row skipped at upload and a
    row skipped after matching read identically to a reviewer.
    """
    if already_imported_in:
        return RowOutcome(
            ROW_SKIPPED, SKIP_REASON_ALREADY_IMPORTED.format(batch=already_imported_in)
        )
    if duplicate_in_file:
        return RowOutcome(ROW_SKIPPED, SKIP_REASON_DUPLICATE_IN_FILE)
    if not getattr(row, "is_success", False):
        status_raw = (getattr(row, "status_raw", "") or "unknown").strip() or "unknown"
        return RowOutcome(ROW_SKIPPED, SKIP_REASON_NOT_SUCCESSFUL.format(status=status_raw))
    return RowOutcome(ROW_PENDING_MATCH, "")


def derive_row_outcome(
    row,
    match=None,
    already_imported_in: str | None = None,
    paid_duplicate=None,
) -> RowOutcome:
    """Derive one bank row's outcome from its match result.

    `already_imported_in` names an EARLIER batch that already carries this transfer id, if any.

    `paid_duplicate` is the already-Paid duplicate finding of rule 2 -- a group-shaped object with
    `.targets` and `.total_amount`, or `None`. It comes from a query that is deliberately NOT the
    candidate query. It is a group rather than a single record so that a fan-out (one transfer
    against several payments, 40 real cases covering 99 payments) is still recognised as one
    already-recorded transfer rather than reported as a partial.

    Both are the caller's to supply -- they need the database, and this module does not touch it.
    """
    # 1. Duplicates first. A transfer already handled elsewhere is not re-decided, whatever it
    #    would otherwise match -- offering it again is how the same money gets recorded twice.
    if already_imported_in:
        return RowOutcome(
            ROW_SKIPPED, SKIP_REASON_ALREADY_IMPORTED.format(batch=already_imported_in)
        )

    # 2. Money that never moved. A FAILED transfer still carries a bank reference and would match
    #    perfectly well, so this must come before any matching is considered.
    if not getattr(row, "is_success", False):
        status_raw = (getattr(row, "status_raw", "") or "unknown").strip() or "unknown"
        return RowOutcome(ROW_SKIPPED, SKIP_REASON_NOT_SUCCESSFUL.format(status=status_raw))

    bank_amount = _amount_of(row)

    # 3. Already recorded as Paid by hand (rule 2). Safe to test before the candidate pool because
    #    an already-Paid record is not IN the candidate pool (rule 1) -- the two cannot contend.
    if paid_duplicate is not None and getattr(paid_duplicate, "targets", ()):
        total = _total_of(paid_duplicate)
        if total != bank_amount:
            # The ONLY route to `Mismatched`, and it is a narrow, honest one: the bank amount
            # disagrees with what the already-Paid record(s) claim. The candidate passes cannot
            # produce this -- they match on an EXACT amount, so a disagreement is arithmetically
            # impossible there.
            return RowOutcome(ROW_MISMATCHED, _delta_note(bank_amount, total, paid_duplicate))
        return RowOutcome(
            ROW_SKIPPED,
            SKIP_REASON_ALREADY_PAID.format(records=_name_list(paid_duplicate)),
        )

    candidates = _settleable_candidates(match)
    if not candidates:
        return RowOutcome(ROW_UNMATCHED, _unmatched_note())

    # 4. At least one APPROVED record at this amount. One candidate is a confident suggestion the
    #    screen pre-selects; several is an ambiguity the screen presents without guessing between
    #    them (owner: the screen never guesses between two real records). Both are `Matched` --
    #    something settleable was found, and a person confirms which. The vocabulary is fixed at
    #    seven statuses and deliberately has no "Ambiguous"; the distinction is a screen concern,
    #    carried in the note rather than in the status.
    return RowOutcome(ROW_MATCHED, _matched_note(candidates))


def _settleable_candidates(match) -> tuple:
    """Every approved record this row could settle, payments and expenses alike.

    Both ledgers reach the same final step, so both are `Matched`. Payments arrive grouped (one
    transfer may cover several, and the group is what settles together); expenses arrive as
    individual candidates.
    """
    if match is None:
        return ()
    out: list = []
    group = getattr(match, "best_payment_group", None)
    if group is not None and getattr(group, "targets", ()):
        out.append(group)
    out.extend(getattr(match, "expense_candidates", ()) or ())
    return tuple(out)


def sole_suggestion(outcome: RowOutcome, match=None) -> Suggestion | None:
    """The one record to pre-select for this row, or `None` to pre-select nothing.

    ⚠️ IT TAKES THE OUTCOME, NOT JUST THE MATCH, AND THE GATE IS THE POINT. `derive_row_outcome`
    short-circuits on a duplicate, a failed transfer and an already-Paid record BEFORE it ever looks
    at candidates -- so a match result can hold perfectly good candidates for a row that was
    correctly Skipped. Deciding from the match alone would pre-select a record on a row nobody may
    settle. Only `Matched` yields a suggestion, and the caller cannot forget the gate because it is
    not the caller's to apply.

    ⚠️ IT READS THE SAME CANDIDATE LIST `_matched_note` COUNTS, on purpose. Before this existed the
    screen re-derived its own pre-selection from `payment_groups` -- ALL of them -- while the note
    counted `best_payment_group` plus expenses, so a row could read "One approved record at this
    amount" and still refuse to pre-select it. One list, one answer.

    ⚠️ EXACTLY ONE, OR NOTHING (owner ruling, re-affirmed 2026-08-06). Two approved records is an
    ambiguity and the screen never guesses between two real records. A FAN-OUT -- one transfer
    settling several payments -- returns `None` for the same reason from the other direction: there
    is no single record to name, and the shape of a `(doctype, name)` pair enforces that rather than
    trusting a caller to notice.
    """
    if outcome.status != ROW_MATCHED:
        return None

    candidates = _settleable_candidates(match)
    if len(candidates) != 1:
        return None

    only = candidates[0]
    targets = getattr(only, "targets", None)
    if targets is not None:
        if len(targets) != 1:
            return None
        return Suggestion(targets[0].doctype, targets[0].name)

    target = getattr(only, "target", None)
    if target is None:
        return None
    return Suggestion(target.doctype, target.name)


def _matched_note(candidates: Sequence) -> str:
    if len(candidates) == 1:
        only = candidates[0]
        names = _name_list(only)
        targets = getattr(only, "targets", None)
        if targets and len(targets) > 1:
            return f"One transfer settling {len(targets)} approved payments: {names}."
        return f"One approved record at this amount: {names}."
    listed = ", ".join(_name_list(c) for c in candidates[:3])
    more = "" if len(candidates) <= 3 else f" and {len(candidates) - 3} more"
    return (
        f"{len(candidates)} approved records match this amount: {listed}{more}. "
        f"Choose which one this transfer settled."
    )


def _unmatched_note() -> str:
    return (
        "No approved payment or expense matches this transfer. Record a new expense, or link one "
        "by hand."
    )


def _delta_note(bank_amount: Decimal, total: Decimal, group) -> str:
    delta = total - bank_amount
    if delta > 0:
        implied = (delta / total * 100) if total else Decimal("0")
        shortfall = (
            f"The bank paid {delta} less than the recorded total of {total} "
            f"({implied:.2f}% of it). A deduction such as TDS would look like this."
        )
    else:
        shortfall = (
            f"The bank paid {-delta} MORE than the recorded total of {total}. "
            f"More money left the account than any matched record claims."
        )
    return f"{shortfall} Already recorded as Paid on {_name_list(group)}."


def _name_list(candidate) -> str:
    """The record name(s) behind a group or a single candidate, as a reviewer would read them."""
    targets = getattr(candidate, "targets", None)
    if targets:
        return ", ".join(t.name for t in targets)
    target = getattr(candidate, "target", None)
    if target is not None:
        return target.name
    return getattr(candidate, "name", "") or "an unnamed record"


def _amount_of(row) -> Decimal:
    return getattr(row, "amount", Decimal("0")) or Decimal("0")


def _total_of(group) -> Decimal:
    total = getattr(group, "total_amount", None)
    if total is not None:
        return total
    return sum((t.amount for t in getattr(group, "targets", ())), Decimal("0"))


def derive_batch_status(row_statuses: Iterable[str]) -> str:
    """Derive a batch's status from its rows' statuses.

    ⚠️ THE `force_closed` PARAMETER IS GONE with `Completed with exceptions` (owner ruling). Closing
    a batch no longer changes what its status SAYS -- it records `closed_at` and nothing more, so a
    batch closed with rows outstanding still reads `Partially Settled`, which is the truth. The
    three tabs show the outstanding work directly, which is what the retired status was standing in
    for.
    """
    statuses = list(row_statuses)
    if not statuses:
        return BATCH_DRAFT

    open_rows = [s for s in statuses if s in OPEN_ROW_STATUSES]
    terminal_rows = [s for s in statuses if s in TERMINAL_ROW_STATUSES]

    if not open_rows:
        return BATCH_COMPLETED
    if terminal_rows:
        return BATCH_PARTIALLY_SETTLED
    return BATCH_IN_REVIEW


def derive_batch_counters(row_statuses: Sequence[str]) -> dict:
    """The denormalised counters on the batch. Derived here so the list page and the review screen
    can never disagree about how much of a batch is done.

    ⚠️ `reconciled_rows` and `exception_rows` were REMOVED with the statuses they counted (owner
    ruling: remove the dead fields). Every key here still maps to a live field on
    `Outflow Import Batch`; adding one without adding the field would write nothing and report
    nothing, silently.
    """
    statuses = list(row_statuses)
    return {
        "total_rows": len(statuses),
        "reviewed_rows": sum(1 for s in statuses if s != ROW_PENDING_MATCH),
        "settled_rows": sum(1 for s in statuses if s == ROW_SETTLED),
        "skipped_rows": sum(1 for s in statuses if s == ROW_SKIPPED),
        "error_rows": sum(1 for s in statuses if s == ROW_ERROR),
    }
