# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Clearing and cancelling a cheque, and a Security Deposit cheque's moves (#1484, #1486, spec #1477,
ADR-0035). Pure: no `frappe.db`. `status.py` asks it.

Each `*_problem` function returns a short reason ("already Cleared"), or None.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from frappe.utils import flt

from nirmaan_stack.services.cheques.rules import (
    CANCELLED,
    CHEQUE_TYPE_PAYMENT,
    CHEQUE_TYPE_SECURITY_DEPOSIT,
    CLEARED,
    CLEARED_BY_BANK_IMPORT,
    CLEARED_BY_HAND,
    ICICI_BANK,
    ISSUED,
    LINES_TOLERANCE,
    PENDING,
    cheque_no_key,
    day_text,
    rupees,
)
from nirmaan_stack.services.settlement import (
    STATUS_PAID,
    STATUS_RECONCILIATION_PENDING,
)


#: The statuses each way of clearing may start from. By hand: Issued only (Q34). The bank import (#1485)
#: clears at any live status, because the bank has already paid: from Pending its payments are approved
#: by the import first, from Cancelled its Rejected payments are revived (`status.clear` does both).
CLEARABLE_FROM = {
    CLEARED_BY_HAND: (ISSUED,),
    CLEARED_BY_BANK_IMPORT: (ISSUED, PENDING, CANCELLED),
}
#: The starts the bank import brings to Reconciliation Pending itself before it pays (`status.clear`).
BANK_BRINGS_FORWARD = (PENDING, CANCELLED)
#: Why a cheque at a status no clear starts from cannot be cleared.
_NOT_CLEARABLE = {
    PENDING: f"it is {PENDING}: its payments are not approved yet",
    CANCELLED: "it is Cancelled: its payments are Rejected",
}
#: The bank-statement source whose lines clear cheques, and the direction that spends money
#: (`outflow_import/sources.BANK_STATEMENT_SOURCES`, `outflow_import/parser.DIRECTION_DEBIT`).
ICICI_STATEMENT_SOURCE = "ICICI Bank Statement"
DIRECTION_DEBIT = "Debit"
#: An imported line nobody has matched yet (`api/outflow_import/review._NOT_MATCHED_STATUSES`).
UNMATCHED_LINE_STATUSES = ("Pending match run", "Mismatched", "Error")


def clear_problem(
    *,
    status: str,
    cheque_type: str,
    old_type: bool,
    cleared_by: str,
    payments: Sequence[tuple[str, str | None]],
    bank_line: bool,
) -> str | None:
    """Why this cheque cannot be cleared, as a short reason ("already Cleared"), or None. Pure.

    `payments` holds `(payment, status)` for every Project Payment its lines name. Clearing pays them,
    so each must be waiting for the bank (Reconciliation Pending); one already Paid is left as it is,
    unless a bank line is being linked (that line would then pay it twice). The bank import starting
    from Pending or Cancelled (`BANK_BRINGS_FORWARD`) takes any unpaid payment: it approves or revives
    it first. An Old-type cheque is cleared by hand only, and with no bank line: its lines may pay
    expenses the line cannot be split across.
    """
    if cheque_type != CHEQUE_TYPE_PAYMENT:
        return "a Security Deposit cheque is never cashed"
    if status == CLEARED:
        return "already Cleared"
    if old_type and (bank_line or cleared_by != CLEARED_BY_HAND):
        return "an Old-type cheque is cleared by hand, without a bank line"
    if status not in CLEARABLE_FROM.get(cleared_by, ()):
        return _NOT_CLEARABLE.get(status, f"it is {status}")
    for name, payment_status in payments:
        payment_status = (payment_status or "").strip()
        if payment_status == STATUS_PAID:
            if bank_line:
                return f"payment {name} is already Paid"
        elif status in BANK_BRINGS_FORWARD and payment_status:
            continue
        elif payment_status != STATUS_RECONCILIATION_PENDING:
            return f"payment {name} is {payment_status or 'blank'}"
    return None


def clearance_date_problem(clearance_date, *, issue_date, today) -> str | None:
    """Why `clearance_date` cannot be a cheque's clearance date, or None. Pure. It becomes each payment's
    payment date, so it is required, never after `today` and never before the cheque was issued."""
    if not clearance_date:
        return "Choose the clearance date."
    day = str(clearance_date)[:10]
    if day > str(today)[:10]:
        return "The clearance date cannot be after today."
    if issue_date and day < str(issue_date)[:10]:
        return f"The clearance date cannot be before the cheque was issued ({day_text(str(issue_date))})."
    return None


def cancel_problem(*, status: str) -> str | None:
    """Why a cheque at `status` cannot be cancelled by hand, as a short reason, or None. Pure. Pending and
    Issued cheques may be (their payments are Rejected); a Cleared one has no undo (ADR-0035 §5)."""
    if status == CLEARED:
        return "it is Cleared: a cleared cheque cannot be cancelled"
    if status == CANCELLED:
        return "already Cancelled"
    return None


def cancel_note_problem(note: str | None) -> str | None:
    """Cancelling rejects every payment on the cheque, with the note as their reason: it is required."""
    if not (note or "").strip():
        return "Write a note saying why the cheque is cancelled."
    return None


def issue_date_problem(issue_date, *, today) -> str | None:
    """Why `issue_date` cannot be a Security Deposit cheque's issue date (the day it was handed over), or
    None. Pure. It is typed (today by default), so it is required and never after `today`. It may be before
    or after the cheque date: a deposit cheque is often post-dated."""
    if not issue_date:
        return "Enter the issue date: the day it was handed over."
    if str(issue_date)[:10] > str(today)[:10]:
        return "The issue date cannot be after today."
    return None


def deposit_cancel_problem(*, status: str, cheque_type: str) -> str | None:
    """Why this cheque cannot be cancelled as a Security Deposit, as a short reason, or None. Pure. A deposit
    is Issued from the start and Cancelled when it comes back (story 64); no other move exists."""
    if cheque_type != CHEQUE_TYPE_SECURITY_DEPOSIT:
        return "it is a Payment cheque, not a Security Deposit"
    if status == CANCELLED:
        return "already Cancelled"
    if status != ISSUED:
        return f"it is {status}"
    return None


@dataclass(frozen=True)
class BankLine:
    """An imported bank-statement line (`Outflow Import Row`) as the clearing rules read it."""

    name: str
    source: str | None
    direction: str | None
    row_status: str | None
    reference_id: str | None
    amount: float


def bank_line_matches(line: BankLine, *, cheque_no: str, amount) -> bool:
    """Does `line` carry this cheque's number (leading zeros ignored) and amount (within ₹5)? Pure."""
    key = cheque_no_key(line.reference_id)
    return (
        bool(key)
        and key == cheque_no_key(cheque_no)
        and abs(round(flt(line.amount), 2) - round(flt(amount), 2)) <= LINES_TOLERANCE
    )


def bank_line_problem(line: BankLine, *, bank: str, cheque_no: str, amount) -> str | None:
    """Why `line` cannot clear this cheque, as a short reason, or None. Pure.

    The bank match rule (spec #1477): an ICICI Bank cheque only, an ICICI statement DEBIT nobody has
    matched yet, the same number with leading zeros ignored, the amount within ₹5.
    """
    if bank != ICICI_BANK:
        return "only an ICICI Bank cheque is matched to a bank line"
    if line.source != ICICI_STATEMENT_SOURCE:
        return f"line {line.name} is not from an ICICI bank statement"
    if line.direction != DIRECTION_DEBIT:
        return f"line {line.name} is a credit, not a debit"
    if line.row_status not in UNMATCHED_LINE_STATUSES:
        return f"line {line.name} is already {line.row_status}"
    if cheque_no_key(line.reference_id) != cheque_no_key(cheque_no):
        number = (line.reference_id or "").strip() or "none"
        return f"line {line.name} carries cheque number {number}, not {cheque_no}"
    if not bank_line_matches(line, cheque_no=cheque_no, amount=amount):
        return f"line {line.name} is for {rupees(line.amount)}, but the cheque is for {rupees(amount)}"
    return None
