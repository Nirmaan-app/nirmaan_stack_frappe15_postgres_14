# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Clearing and cancelling a cheque, and a Security Deposit cheque's moves (#1484, #1486, spec #1477,
ADR-0035). Pure: no `frappe.db`. `status.py` asks it.

Only a bank-statement line clears a Payment cheque (#1516, ADR-0035 Amendment A): nobody clears one by
hand, and the import clears Old-type cheques too, each line's record settled for the line's amount.

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
    ICICI_BANK,
    ISSUED,
    LINES_TOLERANCE,
    PAYMENT_DOCTYPE,
    PENDING,
    cheque_no_key,
    rupees,
)
from nirmaan_stack.services.settlement import (
    STATUS_APPROVED,
    STATUS_PAID,
    STATUS_RECONCILIATION_PENDING,
)


#: The statuses a bank line clears a Payment cheque from (#1485): any live one, because the bank has
#: already paid. From Pending its payments are approved by the import first, from Cancelled its Rejected
#: payments are revived (`status.clear` does both). An Old-type cheque is cleared from Issued only.
CLEARABLE_FROM = (ISSUED, PENDING, CANCELLED)
#: The starts the bank import brings to Reconciliation Pending itself before it pays (`status.clear`).
BANK_BRINGS_FORWARD = (PENDING, CANCELLED)
#: The payment statuses an Old-type cheque's clear takes: Approved and Reconciliation Pending ones are paid,
#: a Paid one is left as it is (`status.clear`).
OLD_TYPE_PAYMENT_STATUSES = (STATUS_APPROVED, STATUS_RECONCILIATION_PENDING, STATUS_PAID)
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
    payments: Sequence[tuple[str, str | None]],
    bank_line: bool,
) -> str | None:
    """Why this cheque cannot be cleared, as a short reason ("already Cleared"), or None. Pure.

    Only a bank-statement line clears a cheque (`bank_line`), never a person (#1516). `payments` holds
    `(payment, status)` for every Project Payment its lines name. Clearing pays them, so each must be
    waiting for the bank (Reconciliation Pending); one already Paid refuses, since the line would pay it
    twice. Starting from Pending or Cancelled (`BANK_BRINGS_FORWARD`) the import takes any unpaid payment:
    it approves or revives it first.

    An Old-type cheque is cleared from Issued only, with every line paid in full (ADR-0035 Amendment A):
    its payments may be Approved or Reconciliation Pending (paid by the clear) or already Paid (left as
    they are), never waiting for approval or Rejected. Its old status says nothing about its payments
    (#1478), so the import neither approves nor revives them; it is never Approval Pending, and a
    Cancelled one was torn up under rules that left its payments as they were.
    """
    if cheque_type != CHEQUE_TYPE_PAYMENT:
        return "a Security Deposit cheque is never cashed"
    if not bank_line:
        return "only a bank-statement line with its number and amount clears a cheque"
    if status == CLEARED:
        return "already Cleared"
    if old_type:
        if status != ISSUED:
            return f"it is {status}: an Old-type cheque is cleared only while Issued"
        for name, payment_status in payments:
            payment_status = (payment_status or "").strip()
            if payment_status not in OLD_TYPE_PAYMENT_STATUSES:
                return f"payment {name} is {payment_status or 'blank'}"
        return None
    if status not in CLEARABLE_FROM:
        return f"it is {status}"
    for name, payment_status in payments:
        payment_status = (payment_status or "").strip()
        if payment_status == STATUS_PAID:
            return f"payment {name} is already Paid"
        if status in BANK_BRINGS_FORWARD and payment_status:
            continue
        if payment_status != STATUS_RECONCILIATION_PENDING:
            return f"payment {name} is {payment_status or 'blank'}"
    return None


@dataclass(frozen=True)
class OldTypeLine:
    """One line of an Old-type cheque as its clear reads it: the record it names (`doctype` + `name`, a
    Project Payment or an expense), the line's amount and, for a Project Payment, the payment's amount."""

    idx: int
    doctype: str | None
    name: str | None
    amount: float
    record_amount: float | None = None


def old_type_lines_problem(lines: Sequence[OldTypeLine], *, bank_amount) -> str | None:
    """Why a bank line of `bank_amount` cannot settle this Old-type cheque's lines, or None. Pure.

    The line settles every record the lines name, each for its line's amount, with one bank match per
    line (#1516). So every line names a record, the lines add up to the bank line within ₹5 (the line
    then reads Settled, never part allocated), and a payment line pays its whole payment: the import
    pays a payment in full or not at all.
    """
    if not lines:
        return "it has no lines, so the bank line would settle nothing"
    for line in lines:
        if not line.name:
            return f"line {line.idx} names no payment"
    total = round(sum(flt(line.amount) for line in lines), 2)
    if abs(total - round(flt(bank_amount), 2)) > LINES_TOLERANCE:
        return f"its lines add up to {rupees(total)}, but the bank line is for {rupees(bank_amount)}"
    for line in lines:
        if line.doctype == PAYMENT_DOCTYPE and abs(flt(line.amount) - flt(line.record_amount)) > LINES_TOLERANCE:
            return (
                f"line {line.idx} pays {rupees(line.amount)} of payment {line.name}, which is for "
                f"{rupees(line.record_amount)}"
            )
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
