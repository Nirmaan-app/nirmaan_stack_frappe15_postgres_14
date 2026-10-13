# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Transaction Details card's cheque buttons on the PO and Work Order pages (#1416, spec #1407).

* `put_payment_on_new_cheque` -- Convert to Cheque (an Online payment, not Rejected) and Link a new
  cheque (a Cheque payment whose Cheque is Cancelled): a new one-line Cheque from the cheque's photo,
  as Request Payment makes. Once committed, the payment follows the cheque move: Approved and not on
  hold goes to Reconciliation Pending now, a waiting one on approval, a held one on release, and
  Reconciliation Pending or Paid stays.
* `switch_payment_to_online` -- a Cheque payment whose Cheque is Cancelled goes back to Online; its
  status does not change.

Thin: check who is asking, call the cheques service (`services/cheques/payment_actions.py`), commit,
move, publish.

Who: `CHEQUE_ACCESS_PROFILES` (Admin, Accountant, Accountant Lead and the Procurement profiles).
"""

import frappe

from nirmaan_stack.api.cheques.save_cheque import assert_cheque_access
from nirmaan_stack.api.payments.project_payments import _move_cheque_to_reconciliation
from nirmaan_stack.services.cheques.payment_actions import put_payment_on_new_cheque as _put_on_new_cheque
from nirmaan_stack.services.cheques.payment_actions import switch_payment_to_online as _switch_to_online
from nirmaan_stack.services.cheques.rules import PAYMENT_DOCTYPE, parse_header
from nirmaan_stack.services.cheques.writer import CHEQUES_CHANGED_EVENT


@frappe.whitelist(methods=["POST"])
def put_payment_on_new_cheque(
    payment: str,
    bank: str,
    cheque_no: str,
    cheque_date: str,
    cheque_amount,
    bank_name: str | None = None,
    cheque_attachment: str | None = None,
) -> dict:
    """Make a new one-line Cheque for `payment` and put the payment on it.

    `bank` is "ICICI Bank" or "Others" (then `bank_name` is required); `cheque_amount` is what the
    cheque is written for; `cheque_attachment` is the uploaded photo's file URL, required. A bank +
    cheque number already recorded is refused (`DuplicateChequeError`) and nothing changes.

    Returns `{cheque, payment, status}`, `status` being the payment's after the move.
    """
    user = frappe.session.user
    assert_cheque_access(user)
    header = parse_header({
        "bank": bank,
        "bank_name": bank_name,
        "cheque_no": cheque_no,
        "cheque_date": cheque_date,
        "amount": cheque_amount,
        "attachment": cheque_attachment,
    })
    cheque = _put_on_new_cheque(payment, header, user=user)
    frappe.db.commit()
    _move_cheque_to_reconciliation(payment)  # no-op unless Approved and not on hold
    frappe.publish_realtime(CHEQUES_CHANGED_EVENT, {"cheque": cheque.name})
    return {
        "cheque": cheque.name,
        "payment": payment,
        "status": frappe.db.get_value(PAYMENT_DOCTYPE, payment, "status"),
    }


@frappe.whitelist(methods=["POST"])
def switch_payment_to_online(payment: str) -> dict:
    """Switch a Cheque payment whose Cheque is Cancelled back to Online; refused while the Cheque is
    Issued or Cleared. Returns `{payment, mode_of_payment, status}`; the status is unchanged."""
    assert_cheque_access(frappe.session.user)
    pay = _switch_to_online(payment)
    frappe.db.commit()
    frappe.publish_realtime(CHEQUES_CHANGED_EVENT, {"payment": pay.name})
    return {"payment": pay.name, "mode_of_payment": pay.mode_of_payment, "status": pay.status}
