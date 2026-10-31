# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What a cheque payment refuses (spec #1407, spec #1477, ADR-0035, #1487). Pure: no `frappe.db`.

A Project Payment's Mode of Payment changes only through a Cheque (`mode_change_problem`), only a PO payment
is paid by cheque (`cheque_mode_problem`), and a cheque's payments move together, so no one-payment action
(hold, Revert to Approved, split, paying it alone) takes one of them (`cheque_payment_problem`).

A Credit PO term may be paid before its due date only by a cheque dated on or after that date (owner,
2026-10-31): `credit_request_problem` at the request, `credit_cheque_date_problem` at every approval and cheque
date edit after it.

A cheque payment is Paid only when its cheque clears from the bank statement (#1552, ADR-0035 Amendment B):
no save moves one into or out of Paid but the cheques service's clear (`paid_move_problem`), and a payment
in Cheque mode always has its cheque (`no_cheque_problem`).
"""

from nirmaan_stack.services.cheques.rules import CANCELLED, PAYMENT_REJECTED, PO_DOCTYPE, day_text
from nirmaan_stack.services.settlement import STATUS_PAID


#: A Cheque payment's Cheque that no longer holds it to the cheque: Cancelled, or none at all (a
#: payment the backfill could not give a Cheque, its number refused). `None` is "no Cheque".
_RELEASED_CHEQUE_STATUSES = (CANCELLED, None)


def mode_change_problem(
    *,
    was_cheque: bool,
    now_cheque: bool,
    cheque: str | None,
    old_cheque_status: str | None,
    on_old_cheque_lines: bool,
    by_the_cheques_service: bool,
) -> str | None:
    """Why a payment's Mode of Payment may not change this way, or None (spec #1407). The Project
    Payments `validate` asks it on every save.

    Online -> Cheque happens only when the cheques service puts the payment on a Cheque
    (`by_the_cheques_service`, `writer.link_payments`), which sets the `cheque` link in the same save: a
    user's save naming a Cheque (a Cancelled one, by REST) is not that (review round 5, AA1).
    Cheque -> Online only once nothing holds the payment to its Cheque:
    that Cheque (`old_cheque_status`) is Cancelled, or it was on none, or its line has come off it
    (`on_old_cheque_lines` False: an edit took it off, #1418).
    """
    if was_cheque == now_cheque:
        return None
    if now_cheque:
        return None if cheque and by_the_cheques_service else (
            "An Online payment becomes a Cheque payment by putting it on a Cheque.")
    if old_cheque_status not in _RELEASED_CHEQUE_STATUSES and on_old_cheque_lines:
        return "A Cheque payment goes back to Online only once its Cheque is Cancelled."
    return None


def cheque_mode_problem(document_type: str | None) -> str | None:
    """Why a payment of a `document_type` record cannot be paid by cheque, or None. Only a PO payment can:
    Work Order payments are paid Online. The Project Payments `validate` asks it when a payment becomes
    a Cheque payment; a Work Order cheque payment already in flight finishes as it is."""
    if document_type == PO_DOCTYPE:
        return None
    return "A Work Order payment is paid Online: only a PO payment can be paid by cheque."


#: The one-payment actions a cheque payment refuses. A cheque's payments are approved, paid or rejected
#: together (one cheque, one decision), so none of them may move alone; cancelling the cheque is the undo.
CHEQUE_REFUSES_HOLD = "hold"
CHEQUE_REFUSES_REVERT = "revert"
#: CEO part-approval and the bank import's part-settlement, both `payment_split.split_payment`.
CHEQUE_REFUSES_SPLIT = "split"
#: A hand settle from the import's decision dialog, and the payments screen's fulfil: clearing pays them.
CHEQUE_REFUSES_PAY = "pay"
_CANCEL_INSTEAD = "a cheque's payments move together. Cancel the cheque in the Cheque Tracker instead."
#: How a cheque payment is paid: the one sentence every refusal to pay one otherwise ends with.
_PAID_BY_CLEAR = (
    "a cheque's payments are paid when a bank-statement line with the cheque's number and amount is imported, "
    "which clears the cheque"
)
_CHEQUE_REFUSALS = {
    CHEQUE_REFUSES_HOLD: f"cannot be put on hold: {_CANCEL_INSTEAD}",
    CHEQUE_REFUSES_REVERT: f"cannot go back to Approved: {_CANCEL_INSTEAD}",
    CHEQUE_REFUSES_SPLIT: "cannot be split: a cheque pays its payments in full or not at all.",
    CHEQUE_REFUSES_PAY: f"cannot be paid on its own: {_PAID_BY_CLEAR}.",
}
CHEQUE_PAYMENT_ACTIONS = tuple(_CHEQUE_REFUSALS)


def cheque_payment_problem(payment: str, action: str, *, is_cheque: bool, cheque_no: str | None = None) -> str | None:
    """Why `action` (a `CHEQUE_REFUSES_*`) is refused on `payment`, or None for an Online payment.
    `cheque_no` names the cheque in the refusal when known."""
    refusal = _CHEQUE_REFUSALS[action]
    if not is_cheque:
        return None
    cheque = f"cheque {cheque_no}" if cheque_no else "cheque"
    return f"{payment} is paid by {cheque}, so it {refusal}"


#: Set by the cheques service's clear (`status._pay`) on each payment save it makes, naming the cheque it
#: clears. Only server code sets it (a REST write cannot); it is what lets that one save make a cheque
#: payment Paid (`paid_move_problem`).
CLEARING_FLAG = "cheque_clearing"
#: Set by Request Payment on a new Cheque-mode payment it is about to insert, whose cheque it makes right
#: after the insert (`api/payments/payment_cheque.expect_new_cheque`). Only server code sets it; any other
#: insert of a Cheque-mode payment is refused (`no_cheque_problem`).
CHEQUE_FOLLOWS_FLAG = "cheque_follows"


def paid_move_problem(
    payment: str, *, from_status: str | None, to_status: str, is_cheque: bool, clearing: bool
) -> str | None:
    """Why a save that moves `payment` from `from_status` (None: a new payment) to `to_status` is refused, or
    None. The Project Payments `validate` asks it on every save (`payment_mode.validate_paid_by_clear`).

    Only a status move into or out of Paid of a cheque payment is refused; any other edit of a Paid one
    (its UTR, its date, its attachment) is not a move. Into Paid only when `clearing`: the save is the
    cheques service clearing the cheque the payment is on. Out of Paid never: a cheque has no undo.
    """
    if not is_cheque or from_status == to_status:
        return None
    if to_status == STATUS_PAID:
        return None if clearing else f"{payment} is a cheque payment, so it cannot be saved as Paid: {_PAID_BY_CLEAR}."
    if from_status == STATUS_PAID:
        return paid_set_back_problem(payment, f"be moved to {to_status}")
    return None


def paid_set_back_problem(payment: str, what: str) -> str:
    """Why Paid cheque payment `payment` may not `what` (e.g. "be moved to Approved", "be unreconciled"): a Paid
    one is never set back. The save rule (`paid_move_problem`) and the import's Unreconcile verdict
    (`outflow_import.unreconcile.leg_verdict`) both say it."""
    return f"{payment} is a Paid cheque payment, so it cannot {what}: {_PAID_BY_CLEAR}, and a Paid one is never set back."


def no_cheque_problem(payment: str, *, status: str, on_a_cheque: bool) -> str | None:
    """Why a save of `payment`, in Cheque mode at `status` and listed by a cheque only when `on_a_cheque`, is
    refused, or None (#1552, ADR-0035 Amendment B). The Project Payments `validate` asks it on every save
    (`payment_mode.validate_on_a_cheque`); a new one counts as on a cheque only when Request Payment makes its
    cheque right after the insert (`CHEQUE_FOLLOWS_FLAG`).

    Two kinds may be off every cheque's lines. A Rejected one: the backfill left Rejected payments off, and one
    rejected alone drops off its Old-type cheque (`detach.drop_off_cheques`). A Paid one: the backfill left a
    group off when it refused its cheque number. Any other is what a failed Request Payment or a Desk / REST
    insert leaves behind: it may not move on, and switching it to Online is its way out.
    """
    if on_a_cheque or status in (PAYMENT_REJECTED, STATUS_PAID):
        return None
    return (
        f"{payment} is in Cheque mode, but no cheque lists it, so it cannot be saved: a cheque payment always has "
        "its cheque. An Admin can switch its Mode of Payment to Online in Desk to pay it another way."
    )


#: A PO payment term's `payment_type` for credit: paid on or after its `due_date`.
CREDIT_TERM = "Credit"


def credit_cheque_date_problem(*, cheque_date, due_date, today) -> str | None:
    """Why a cheque dated `cheque_date` may not pay a Credit PO term due `due_date` while it is `today`, or None.
    Pure; days are `YYYY-MM-DD` (a `date` or a datetime string reads the same).

    Until the due date, the cheque must be dated on or after it, so the vendor cannot cash it early (owner,
    2026-10-31). From the due date on, any cheque date is fine: it can no longer be cashed before the due date.
    The request asks it (`credit_request_problem`), and so does the payment's `validate` at every approval and
    whenever its cheque date changes (`payment_mode.validate_credit_cheque_date`).
    """
    due = str(due_date or "")[:10]
    if not due or str(today)[:10] >= due:
        return None
    day = str(cheque_date or "")[:10]
    if day and day >= due:
        return None
    dated = f"dated {day_text(day)}" if day else "undated"
    return (
        f"The cheque is {dated}, before this credit term's due date of {day_text(due)}. "
        "Until the due date, a credit term is paid only by a cheque dated on or after it."
    )


def credit_request_problem(*, due_date, today, is_cheque: bool, cheque_date) -> str | None:
    """Why Request Payment on a Credit PO term due `due_date` is refused while it is `today`, or None. Pure.

    From the due date on, nothing here refuses it, Online or Cheque. Before it, only a cheque dated on or after
    the due date (`credit_cheque_date_problem`): an Online payment would go out at once.
    """
    due = str(due_date or "")[:10]
    if not due:
        return "Credit payment term must have a due date set."
    if str(today)[:10] >= due:
        return None
    if not is_cheque:
        return (
            f"This credit payment term is not yet due. Due date is {day_text(due)}. Before then it can be paid only "
            "by a cheque dated on or after the due date."
        )
    return credit_cheque_date_problem(cheque_date=cheque_date, due_date=due, today=today)
