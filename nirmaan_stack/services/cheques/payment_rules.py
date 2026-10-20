# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What a cheque payment refuses (spec #1407, spec #1477, ADR-0035, #1487). Pure: no `frappe.db`.

A Project Payment's Mode of Payment changes only through a Cheque (`mode_change_problem`), only a PO payment
is paid by cheque (`cheque_mode_problem`), and a cheque's payments move together, so no one-payment action
(hold, Revert to Approved, split, paying it alone) takes one of them (`cheque_payment_problem`).
"""

from nirmaan_stack.services.cheques.rules import CANCELLED, PO_DOCTYPE


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
) -> str | None:
    """Why a payment's Mode of Payment may not change this way, or None (spec #1407). The Project
    Payments `validate` asks it on every save.

    Online -> Cheque happens when the cheques service puts the payment on a Cheque, which sets the
    `cheque` link in the same save. Cheque -> Online only once nothing holds the payment to its Cheque:
    that Cheque (`old_cheque_status`) is Cancelled, or it was on none, or its line has come off it
    (`on_old_cheque_lines` False: an edit took it off, #1418).
    """
    if was_cheque == now_cheque:
        return None
    if now_cheque:
        return None if cheque else "An Online payment becomes a Cheque payment by putting it on a Cheque."
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
_CHEQUE_REFUSALS = {
    CHEQUE_REFUSES_HOLD: f"cannot be put on hold: {_CANCEL_INSTEAD}",
    CHEQUE_REFUSES_REVERT: f"cannot go back to Approved: {_CANCEL_INSTEAD}",
    CHEQUE_REFUSES_SPLIT: "cannot be split: a cheque pays its payments in full or not at all.",
    CHEQUE_REFUSES_PAY: (
        "cannot be paid on its own: a cheque's payments are paid when a bank-statement line with the cheque's "
        "number and amount is imported, which clears the cheque."
    ),
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
