# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Approving a Payment cheque's payments: one cheque, one decision (#1480, spec #1477, ADR-0035). Pure: no
`frappe.db`. `decide.py` (the decision), `status.issue` (the backstop) and the Tracker's save ask it.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from frappe.utils import flt

from nirmaan_stack.services.approval_tiers import status_after_l1
from nirmaan_stack.services.cheques.rules import (
    LINES_TOLERANCE,
    WAITING_STATUSES,
    join_words,
    rupees,
)
from nirmaan_stack.services.settlement import (
    STATUS_APPROVED,
    STATUS_CEO_PENDING,
    STATUS_REQUESTED,
)


#: The payment steps that wait for an approval, and where an approval can land a payment.
_APPROVAL_TARGETS = (STATUS_CEO_PENDING, STATUS_APPROVED)


@dataclass(frozen=True)
class ApprovalLine:
    """One Cheque line as the approval rules read it: the payment it names (None: "No payment yet"),
    its PO (to name the line in a refusal) and its amount."""

    payment: str | None
    record: str | None
    amount: float


def approval_problem(*, cheque_no: str, amount, lines: Sequence[ApprovalLine]) -> str | None:
    """Why a Payment cheque's payments cannot be approved yet, or None. Pure.

    Approving needs every line to name a payment (a "No payment yet" line is named, story 12) and the
    lines to add up to the cheque amount within `LINES_TOLERANCE` (C2, story 13): the bank line that
    clears the cheque equals the cheque amount and pays the payments, so a gap leaves money unexplained.
    """
    if not lines:
        return f"Cheque {cheque_no} has no lines, so it has no payments to approve."
    for n, line in enumerate(lines, 1):
        if not line.payment:
            return (
                f"Line {n} of cheque {cheque_no} has no payment yet ({line.record}, {rupees(line.amount)}). "
                "Pick its payment in the Cheque Tracker first; then all payments on the cheque are approved "
                "together."
            )
    # `round`, not `flt(x, 2)`: Frappe's rounding reads the site's settings, and this module needs none.
    total = round(sum(flt(line.amount) for line in lines), 2)
    if abs(total - round(flt(amount), 2)) > LINES_TOLERANCE:
        return (
            f"The lines of cheque {cheque_no} add up to {rupees(total)}, but the cheque is for {rupees(amount)}. "
            f"Correct them in the Cheque Tracker first: they must agree within {rupees(LINES_TOLERANCE)}."
        )
    return None


def decision_step_problem(payment_statuses: Sequence[tuple[str, str | None]], *, expected: str) -> str | None:
    """Why a cheque's payments are not all at the `expected` step, naming each one that is not, or None.
    Pure. `payment_statuses` holds `(payment, status)` for every line. One cheque moves as one."""
    off = [f"{name} is {(status or '').strip() or 'blank'}" for name, status in payment_statuses
           if (status or "").strip() != expected]
    if off:
        return f"Every payment on the cheque must be {expected} to approve it together: {join_words(off)}."
    return None


def is_approval(from_status: str | None, to_status: str | None) -> bool:
    """Is this payment save an approval: a move out of a step that waits (Requested, CEO Pending) on to
    the next one (CEO Pending, Approved)? Pure. Born approved (no `from_status`), Revert to Approved and
    Unreconcile's Paid -> Approved are not."""
    before, after = (from_status or "").strip(), (to_status or "").strip()
    return before in WAITING_STATUSES and after in _APPROVAL_TARGETS and before != after


def lone_approval_problem(
    *,
    cheque_no: str,
    payment_lines: int,
    deciding: bool,
    from_status: str,
    to_status: str,
    cheque_amount,
) -> str | None:
    """Why this approval of one payment on a Payment cheque is refused, or None (story 32). Pure.

    The payment's own `validate` asks it, so no path approves a cheque payment apart from its cheque:
    a save made by the cheque's decision (`deciding`, `services/cheques/decide.py`) passes; any other
    is refused while the cheque has other lines (`payment_lines` counts them all, "No payment yet" ones
    included), or when it lands where the cheque amount does not (C3: L1 forwards to the CEO above
    ₹50,000 of CHEQUE, whatever the payment's own amount).
    """
    if deciding:
        return None
    if payment_lines > 1:
        return (
            f"This payment is on cheque {cheque_no} with {payment_lines - 1} other line(s). A cheque is approved "
            f"as one: approve all {payment_lines} together from the payment's approval dialog."
        )
    expected = status_after_l1(cheque_amount) if (from_status or "").strip() == STATUS_REQUESTED else STATUS_APPROVED
    if (to_status or "").strip() != expected:
        needs = "CEO approval as well" if expected == STATUS_CEO_PENDING else "L1 approval only"
        return f"Cheque {cheque_no} is for {rupees(cheque_amount)}, so its payments need {needs}."
    return None
