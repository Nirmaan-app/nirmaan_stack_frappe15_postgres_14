# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Porter import's states (ADR-0032, spec #1442): each Porter Invoice's, and the import's own.

PURE MODULE -- no `frappe`, no database. Split out of `porter.py` (the statement's rules): the invoice
statuses the validation job (`api/outflow_import/porter_validation.py`) writes, `import_state` -- the
import's Validating / Validated / Validation failed / Creating / Created, DERIVED from its invoices and
lines, never stored -- and `CREATE_LINE_STATUSES`, the lines Create still writes (and Review may still
re-place).

Each Porter Invoice moves Queued -> Downloading -> Reading -> Comparing -> Passed / Failed / Error,
committed at every step so the dialog can show it. Comparing is `porter_verdict.judge_invoice`.
"""

from __future__ import annotations

from collections.abc import Iterable

from nirmaan_stack.services.outflow_import.status import (
    ROW_ERROR,
    ROW_MISMATCHED,
    ROW_PENDING_MATCH,
    ROW_SETTLED,
    ROW_SKIPPED,
)

__all__ = [
    "CREATE_LINE_STATUSES",
    "IMPORT_CREATED",
    "IMPORT_CREATING",
    "IMPORT_VALIDATED",
    "IMPORT_VALIDATING",
    "IMPORT_VALIDATION_FAILED",
    "INVOICE_COMPARING",
    "INVOICE_DOWNLOADING",
    "INVOICE_ERROR",
    "INVOICE_FAILED",
    "INVOICE_IN_FLIGHT",
    "INVOICE_PASSED",
    "INVOICE_QUEUED",
    "INVOICE_READING",
    "import_state",
]

#: `Porter Invoice.validation_status`, in the order an invoice moves through them.
INVOICE_QUEUED = "Queued"
INVOICE_DOWNLOADING = "Downloading"
INVOICE_READING = "Reading"
INVOICE_COMPARING = "Comparing"
INVOICE_PASSED = "Passed"
#: The PDF disagrees with the statement. FINAL: no retry and no override, for anyone (ADR-0032).
INVOICE_FAILED = "Failed"
#: The download or the read went wrong, so nothing was decided. Retryable, for that invoice alone.
INVOICE_ERROR = "Error"

#: The invoice is still being worked on: the import is not decided yet.
INVOICE_IN_FLIGHT = frozenset({INVOICE_QUEUED, INVOICE_DOWNLOADING, INVOICE_READING, INVOICE_COMPARING})

#: The import's own state, DERIVED from its invoices (`import_state`), never stored.
IMPORT_VALIDATING = "Validating"
IMPORT_VALIDATED = "Validated"
IMPORT_VALIDATION_FAILED = "Validation failed"
#: Create has started and not every completed line is created yet (#1445): running, stopped with a line
#: in Error, or a line reopened by Unreconcile. A re-run of Create finishes it.
IMPORT_CREATING = "Creating"
#: Every completed line has its Expense.
IMPORT_CREATED = "Created"

#: The line statuses Create writes an Expense for: never touched (Pending match run), failed on an earlier
#: run (Error), or reopened by Unreconcile after it was created (Mismatched, #1449). A Porter line never
#: runs the matcher, so Mismatched means only that. Settled and Skipped lines are never written.
CREATE_LINE_STATUSES = (ROW_PENDING_MATCH, ROW_ERROR, ROW_MISMATCHED)

_LINE_WAITING = ROW_PENDING_MATCH
_LINE_SETTLED = ROW_SETTLED
_LINE_SKIPPED = ROW_SKIPPED


def import_state(invoice_statuses: Iterable[str], line_statuses: Iterable[str] = ()) -> str:
    """The import's state, from its Porter Invoices' statuses and (once validated) its lines'.

    Validation, from the invoices: Validating while any invoice is still in hand; Validated only when
    there are invoices and every one Passed; otherwise Validation failed (a Failed invoice is final, an
    Error one waits for its Retry). Nothing about the lines can outrank this.

    Create (#1445), from the lines of a validated import, a cancelled (Skipped) line aside:
      * Validated -- no line has been touched by Create yet;
      * Created   -- there are completed lines and every one is Settled;
      * Creating  -- anything between: Create is running, or stopped with a line in Error, or a line was
        unreconciled after Create (#1449). Each of these is what a re-run of Create finishes.

    Called with the invoices alone it answers the validation question only: `porter_records.is_validated`.
    """
    statuses = list(invoice_statuses)
    if any(status in INVOICE_IN_FLIGHT for status in statuses):
        return IMPORT_VALIDATING
    if not statuses or not all(status == INVOICE_PASSED for status in statuses):
        return IMPORT_VALIDATION_FAILED
    completed = [status for status in line_statuses if status != _LINE_SKIPPED]
    if completed and all(status == _LINE_SETTLED for status in completed):
        return IMPORT_CREATED
    if any(status != _LINE_WAITING for status in completed):
        return IMPORT_CREATING
    return IMPORT_VALIDATED
