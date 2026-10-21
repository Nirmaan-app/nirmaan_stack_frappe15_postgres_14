# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The bank import clears Payment cheques (#1485, spec #1477, ADR-0035). Pure: no `frappe.db`.
`bank_import.py` asks it: which imported line is a cheque line, which cheque it clears, and what the
import review says about it.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from frappe.utils import flt

from nirmaan_stack.services.cheques.clear_rules import DIRECTION_DEBIT, ICICI_STATEMENT_SOURCE
from nirmaan_stack.services.cheques.rules import (
    CANCELLED,
    CLEARED,
    CLEARED_BY_BANK_IMPORT,
    ISSUED,
    LINES_TOLERANCE,
    PENDING,
    cheque_no_key,
    day_text,
    join_words,
    rupees,
)


#: The note on the history row when the bank import approves an Approval Pending cheque's payments.
BANK_APPROVAL_NOTE = "approved by bank import"
#: The note on the history row when the bank import clears a Cancelled cheque.
BANK_REVIVAL_NOTE = "cancelled, but the bank paid it"
#: `Outflow Row Match.match_basis` of a payment a cheque line settled (pinned to the doctype by test).
BANK_MATCH_BASIS = "cheque number"


def bank_approval_note(approved: Sequence[tuple[str, str]]) -> str:
    """The history note when the bank import approves payments on a cheque that is not Approval Pending (an
    Old-type cheque's waiting ones): `approved` holds `(payment, the status it was at)`. Pure. An Approval
    Pending cheque's approval is its Issued row, `BANK_APPROVAL_NOTE` alone."""
    return f"{BANK_APPROVAL_NOTE}: {join_words([f'{name} (was {was})' for name, was in approved])}"


def bank_cheque_key(*, source: str | None, direction: str | None, reference_id) -> str:
    """The cheque number an imported bank line carries, in the compared form (`cheque_no_key`), or "".
    Pure. Only an ICICI statement DEBIT with its cheque column filled is a cheque line (whatever its
    remark says: CLG/, TRF/, TRFR TO:); a credit is money coming in and never clears our cheque."""
    if source != ICICI_STATEMENT_SOURCE or direction != DIRECTION_DEBIT:
        return ""
    return cheque_no_key(reference_id)


@dataclass(frozen=True)
class FoundCheque:
    """A Payment cheque on ICICI Bank (Old-type ones too, #1516) carrying a bank line's number."""

    name: str
    cheque_no: str
    status: str
    amount: float
    bank_line: str | None = None


def _fits(amount, other) -> bool:
    return abs(round(flt(amount), 2) - round(flt(other), 2)) <= LINES_TOLERANCE


def pick_bank_cheque(found: Sequence[FoundCheque], *, amount) -> tuple[FoundCheque | None, str | None]:
    """Which of the Payment cheques carrying a bank line's number that line clears. Pure.

    `(cheque, None)`: the one whose amount is within ₹5 of the line. `(None, hint)`: the number was found
    but no single cheque fits, so nothing is settled and the line says why. `(None, None)`: no Payment
    cheque carries the number, so the line is not the cheque pass's (a Security Deposit is never found).
    """
    if not found:
        return None, None
    fits = [c for c in found if _fits(c.amount, amount)]
    if len(fits) == 1:
        return fits[0], None
    if fits:
        return None, (
            f"Cheques {join_words([c.cheque_no for c in fits])} both carry this number and amount. Nothing was "
            "settled. Cancel the one the bank did not pay, then run the match again."
        )
    if len(found) == 1:
        return None, (
            f"Cheque {found[0].cheque_no} found, but its amount is {rupees(found[0].amount)}, not "
            f"{rupees(amount)}. Nothing was settled. Check the cheque, or match this line by hand."
        )
    return None, (
        f"Cheques {join_words([c.cheque_no for c in found])} carry this number, but none is for {rupees(amount)}. "
        "Nothing was settled. Check the cheques, or match this line by hand."
    )


@dataclass(frozen=True)
class DoublePayment:
    """A payment on a cancelled cheque's PO raised after the cancel: the PO may now be paid twice."""

    payment: str
    record: str
    amount: float
    status: str


def _payments(n: int) -> str:
    return f"{n} payment" if n == 1 else f"{n} payments"


def bank_cleared_note(*, cheque_no: str, started: str, payments: int, day, suspects: Sequence[DoublePayment] = ()) -> str:
    """What the import review says about a line that cleared cheque `cheque_no`, by the status the cheque
    was at (`started`; Cleared means it was cleared by hand and the line is only linked). Pure."""
    when = day_text(str(day))
    if started == CLEARED:
        return (
            f"Cheque {cheque_no} was already cleared by hand: this line is linked to it and its "
            f"{_payments(payments)}; nothing was paid again."
        )
    if started == PENDING:
        verb = "was" if payments == 1 else "were"
        return (
            f"Cheque {cheque_no} was {PENDING}: the bank paid it before approval. Its {_payments(payments)} {verb} "
            f"approved by bank import (approval date {when}), then Paid."
        )
    if started == CANCELLED:
        note = (
            f"Cheque {cheque_no} was cancelled, but the bank paid it: {_payments(payments)} Rejected → Paid, "
            f"payment date {when}."
        )
        if suspects:
            named = join_words([f"{s.record} has {s.payment} ({rupees(s.amount)}, {s.status})" for s in suspects])
            note += f" Check for double payment: {named}, raised after the cheque was cancelled."
        return note
    return f"Cheque {cheque_no} cleared: {_payments(payments)} Reconciliation Pending → Paid, payment date {when}."


def already_linked_note(*, cheque_no: str, bank_line: str) -> str:
    """A Cleared cheque that another bank line already clears: this line settles nothing. Pure."""
    return (
        f"Cheque {cheque_no} is already cleared with bank line {bank_line}. Nothing was settled. Match this "
        "line by hand if it is a different payment."
    )


def bank_clear_failed_note(*, cheque_no: str, reason: str) -> str:
    """A line that matches a cheque the cheques service refused to clear: nothing is settled. Pure."""
    return f"Cheque {cheque_no} matches this line but could not be cleared: {reason}. Nothing was settled."


def no_payment_cheque_note(number: str) -> str:
    """A cheque line whose number names no Payment cheque on ICICI Bank. Pure."""
    return (
        f"No Payment cheque {number} on ICICI Bank. A Security Deposit cheque is never matched. Match this "
        "line by hand."
    )


def bank_start(*, cleared_by: str | None, history: Sequence[tuple[str | None, str, str | None]]) -> str:
    """Where a Cleared cheque that records a bank line stood before that line, for the import review. Pure.

    `history` holds `(from, to, note)` per history row, oldest first. Cleared (by hand, the line only
    linked) unless the bank import cleared it; then the status its clear started from, Approval Pending when the
    import approved it on the way (`BANK_APPROVAL_NOTE`)."""
    if cleared_by != CLEARED_BY_BANK_IMPORT:
        return CLEARED
    rows = list(history)
    for i in range(len(rows) - 1, -1, -1):
        before, after, _note = rows[i]
        if after != CLEARED:
            continue
        if before == ISSUED and i > 0 and rows[i - 1][:2] == (PENDING, ISSUED) and rows[i - 1][2] == BANK_APPROVAL_NOTE:
            return PENDING
        return before or ISSUED
    return ISSUED
