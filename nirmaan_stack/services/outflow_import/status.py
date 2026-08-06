# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Row and batch status derivation (Bulk Import Outflow, slice S2).

PURE MODULE -- no `frappe`, no database, no request context.

THE SINGLE DERIVER (ADR-0010 B3). Every `row_status` and every `Outflow Import Batch.status` in this
feature comes from here. Nothing else -- no endpoint, no controller, no frontend -- may compute one.
The frontend mirrors these rules in `outflowImportStatus.ts` and is pinned to this module by a
parity test; that mirror is a convenience, and this file is the authority.

THE OUTCOME VOCABULARY, and which half of the feature each belongs to:

    READ-ONLY (payment branch -- nothing was written)
      Reconciled          matched a Paid payment (or a fan-out group), amounts agree
      Amount mismatch     matched, but the group total differs from the bank amount
      Reference mismatch  matched on vendor+amount+date, but the payment's stored reference is
                          not this bank reference
      Control exception   matched a payment that is NOT Paid -- money left the bank before the
                          approval completed

    WRITE (expense branch)
      Settled             an expense was marked Paid, or created at Paid

    OPEN
      Pending             staged, not yet reviewed
      Unmatched           nothing found; the row is expense work awaiting a decision
      Error               a write failed and was rolled back to its own savepoint

    Skipped               duplicate, non-SUCCESS transfer, or a deliberate manual skip

PRECEDENCE IS DELIBERATE AND IS NOT ALPHABETICAL. A `Control exception` outranks every other
matched outcome, because "money left the bank against a payment nobody had approved yet" is a
finding about the organisation, not about this file, and it must not be masked by an amount delta
that happens to sit on the same row.

THIS MODULE REPORTS. IT NEVER REPAIRS (owner ruling, 2026-08-06). A reference mismatch describes a
payment whose stored UTR is wrong -- 932 of 7,420 live Paid payments carry something that is not a
bank reference at all -- and describing it is the whole job. Nothing here proposes a correction.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable, Sequence

# status -> matcher is a one-way dependency (matcher never imports status), so the basis string is
# shared rather than duplicated as a literal that could silently drift.
from nirmaan_stack.services.outflow_import.matcher import BASIS_VENDOR_AMOUNT_DATE

__all__ = [
    "ROW_PENDING",
    "ROW_RECONCILED",
    "ROW_AMOUNT_MISMATCH",
    "ROW_REFERENCE_MISMATCH",
    "ROW_CONTROL_EXCEPTION",
    "ROW_UNMATCHED",
    "ROW_SETTLED",
    "ROW_SKIPPED",
    "ROW_ERROR",
    "TERMINAL_ROW_STATUSES",
    "OPEN_ROW_STATUSES",
    "EXCEPTION_ROW_STATUSES",
    "BATCH_DRAFT",
    "BATCH_IN_REVIEW",
    "BATCH_PARTIALLY_SETTLED",
    "BATCH_COMPLETED",
    "BATCH_COMPLETED_WITH_EXCEPTIONS",
    "RowOutcome",
    "derive_staged_row_outcome",
    "derive_row_outcome",
    "derive_batch_status",
    "derive_batch_counters",
    "SKIP_REASON_NOT_SUCCESSFUL",
    "SKIP_REASON_ALREADY_IMPORTED",
]

ROW_PENDING = "Pending"
ROW_RECONCILED = "Reconciled"
ROW_AMOUNT_MISMATCH = "Amount mismatch"
ROW_REFERENCE_MISMATCH = "Reference mismatch"
ROW_CONTROL_EXCEPTION = "Control exception"
ROW_UNMATCHED = "Unmatched"
ROW_SETTLED = "Settled"
ROW_SKIPPED = "Skipped"
ROW_ERROR = "Error"

# Terminal = needs no further action from anyone. A read-only finding IS terminal: it has been
# reported, and reporting it was the entire job.
TERMINAL_ROW_STATUSES = frozenset(
    {
        ROW_RECONCILED,
        ROW_AMOUNT_MISMATCH,
        ROW_REFERENCE_MISMATCH,
        ROW_CONTROL_EXCEPTION,
        ROW_SETTLED,
        ROW_SKIPPED,
    }
)

# Open = a person still owes this row a decision. `Unmatched` is open because the row is expense
# work nobody has done yet; `Error` is open because the write must be retried.
OPEN_ROW_STATUSES = frozenset({ROW_PENDING, ROW_UNMATCHED, ROW_ERROR})

EXCEPTION_ROW_STATUSES = frozenset(
    {ROW_AMOUNT_MISMATCH, ROW_REFERENCE_MISMATCH, ROW_CONTROL_EXCEPTION}
)

BATCH_DRAFT = "Draft"
BATCH_IN_REVIEW = "In Review"
BATCH_PARTIALLY_SETTLED = "Partially Settled"
BATCH_COMPLETED = "Completed"
BATCH_COMPLETED_WITH_EXCEPTIONS = "Completed with exceptions"

SKIP_REASON_NOT_SUCCESSFUL = "Transfer did not succeed at the bank ({status})."
SKIP_REASON_ALREADY_IMPORTED = "Already imported in batch {batch}."
SKIP_REASON_DUPLICATE_IN_FILE = "This transfer appears earlier in the same statement."

_PAID = "Paid"


@dataclass(frozen=True)
class RowOutcome:
    """A derived status plus the sentence that explains it to a reviewer.

    `note` is the reported finding -- the amount delta and its implied rate, the payment whose
    reference disagrees, or the target's actual status. It is written for a person, not parsed.
    """

    status: str
    note: str = ""

    @property
    def is_terminal(self) -> bool:
        return self.status in TERMINAL_ROW_STATUSES


def derive_staged_row_outcome(
    row,
    already_imported_in: str | None = None,
    duplicate_in_file: bool = False,
) -> RowOutcome:
    """The outcome a row gets AT UPLOAD, before any matching has run.

    A separate entry point rather than a mode flag on `derive_row_outcome`, because the two answer
    genuinely different questions. At upload there IS no match, so "did this find a payment?" is
    unanswerable -- and `derive_row_outcome` would answer `Unmatched`, which is a FINDING and would
    be a lie about work that has not happened yet. Only the facts knowable without matching are
    decided here; everything else stays `Pending`.

    `duplicate_in_file` covers the same transfer id appearing TWICE IN ONE STATEMENT, which is
    different from `already_imported_in` (the same transfer in an EARLIER batch) and has to be
    caught separately because the cross-batch lookup cannot see the file it is currently reading.
    Leaving it uncaught is not cosmetic: both copies would match the same payment, and the second
    `Outflow Row Match` insert would violate the (transfer_id, target) unique constraint and abort
    the whole match pass with a database error.

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
    return RowOutcome(ROW_PENDING, "")


def derive_row_outcome(
    row,
    match=None,
    already_imported_in: str | None = None,
) -> RowOutcome:
    """Derive one bank row's outcome from its match result.

    `already_imported_in` names an EARLIER batch that already carries this transfer id, if any.
    That check is the caller's (it needs the database); the consequence is decided here.
    """
    # 1. Duplicates first. A transfer already handled elsewhere is not re-decided, whatever it
    #    would otherwise match -- offering it again is how the same money gets recorded twice.
    if already_imported_in:
        return RowOutcome(
            ROW_SKIPPED, SKIP_REASON_ALREADY_IMPORTED.format(batch=already_imported_in)
        )

    # 2. Money that never moved. A FAILED transfer still carries a bank reference and would match a
    #    payment perfectly well, so this must come before any matching is considered.
    if not getattr(row, "is_success", False):
        status_raw = (getattr(row, "status_raw", "") or "unknown").strip() or "unknown"
        return RowOutcome(ROW_SKIPPED, SKIP_REASON_NOT_SUCCESSFUL.format(status=status_raw))

    group = getattr(match, "best_payment_group", None) if match else None
    if group is None:
        return RowOutcome(ROW_UNMATCHED, _unmatched_note(match))

    # 3. A non-Paid target outranks every other finding -- see the module docstring.
    unpaid = [t for t in group.targets if (t.status or "").strip() != _PAID]
    if unpaid:
        listed = ", ".join(f"{t.name} ({t.status or 'no status'})" for t in unpaid[:3])
        more = "" if len(unpaid) <= 3 else f" and {len(unpaid) - 3} more"
        return RowOutcome(
            ROW_CONTROL_EXCEPTION,
            f"Money left the bank against a payment that is not Paid: {listed}{more}.",
        )

    bank_amount = getattr(row, "amount", Decimal("0"))
    total = group.total_amount

    # 4. Pass A matched on the reference, so a delta here is real. Pass B matched on an exact
    #    amount, so a delta there is arithmetically impossible -- which is why these two outcomes
    #    are mutually exclusive by construction rather than by precedence.
    if total != bank_amount:
        return RowOutcome(ROW_AMOUNT_MISMATCH, _delta_note(bank_amount, total, group))

    if getattr(group, "basis", "") == BASIS_VENDOR_AMOUNT_DATE:
        row_reference = getattr(row, "normalized_reference", "") or ""
        target = group.targets[0]
        if row_reference and target.normalized_reference != row_reference:
            stored = (target.reference or "").strip() or "nothing"
            return RowOutcome(
                ROW_REFERENCE_MISMATCH,
                f"{target.name} matches on vendor, amount and date, but its recorded reference is "
                f"{stored} rather than {getattr(row, 'bank_reference_no', '')}. Reported only; "
                f"this import never edits a payment.",
            )

    if group.is_fan_out:
        return RowOutcome(
            ROW_RECONCILED,
            f"One transfer settling {len(group.targets)} payments: "
            f"{', '.join(t.name for t in group.targets)}.",
        )
    return RowOutcome(ROW_RECONCILED, f"Matches {group.targets[0].name}.")


def _unmatched_note(match) -> str:
    candidates = len(getattr(match, "expense_candidates", ()) or ())
    if candidates:
        return (
            f"No payment found. {candidates} approved expense(s) match this amount -- "
            f"settle one, or record a new expense."
        )
    return "No payment or approved expense found for this transfer."


def _delta_note(bank_amount: Decimal, total: Decimal, group) -> str:
    delta = total - bank_amount
    if delta > 0:
        implied = (delta / total * 100) if total else Decimal("0")
        shortfall = (
            f"The bank paid {delta} less than the payment total of {total} "
            f"({implied:.2f}% of it). A deduction such as TDS would look like this. "
            f"Reported only -- this import never writes a TDS figure."
        )
    else:
        shortfall = (
            f"The bank paid {-delta} MORE than the payment total of {total}. "
            f"More money left the account than any matched payment claims."
        )
    which = ", ".join(t.name for t in group.targets)
    return f"{shortfall} Matched: {which}."


def derive_batch_status(
    row_statuses: Iterable[str],
    force_closed: bool = False,
) -> str:
    """Derive a batch's status from its rows' statuses.

    `force_closed` is the explicit "close with exceptions" action. It lives here rather than in the
    endpoint so that this module stays the ONLY writer of a batch status (B3) -- an endpoint that
    set the string itself would be a second deriver by another name.
    """
    statuses = list(row_statuses)
    if not statuses:
        return BATCH_DRAFT

    open_rows = [s for s in statuses if s in OPEN_ROW_STATUSES]
    terminal_rows = [s for s in statuses if s in TERMINAL_ROW_STATUSES]

    if not open_rows:
        return BATCH_COMPLETED
    if force_closed:
        return BATCH_COMPLETED_WITH_EXCEPTIONS
    if terminal_rows:
        return BATCH_PARTIALLY_SETTLED
    return BATCH_IN_REVIEW


def derive_batch_counters(row_statuses: Sequence[str]) -> dict:
    """The denormalised counters on the batch. Derived here so the list page and the review screen
    can never disagree about how much of a batch is done."""
    statuses = list(row_statuses)
    return {
        "total_rows": len(statuses),
        "reviewed_rows": sum(1 for s in statuses if s != ROW_PENDING),
        "reconciled_rows": sum(1 for s in statuses if s == ROW_RECONCILED),
        "settled_rows": sum(1 for s in statuses if s == ROW_SETTLED),
        "skipped_rows": sum(1 for s in statuses if s == ROW_SKIPPED),
        "exception_rows": sum(1 for s in statuses if s in EXCEPTION_ROW_STATUSES),
        "error_rows": sum(1 for s in statuses if s == ROW_ERROR),
    }
