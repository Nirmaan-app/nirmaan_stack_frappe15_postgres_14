# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A payment's cheque, changed from the PO / Work Order page's Transaction Details (#1416, spec #1407).
Part of THE cheques service; never commits.

* `put_payment_on_new_cheque` -- Convert to Cheque (an Online payment that is not Rejected) and Link a
  new cheque (a Cheque payment, not Rejected, whose Cheque is Cancelled or that is on no Cheque). Both
  make a new one-line Cheque, made from the PO/WO page, through `writer.create_payment_cheque`; a
  replaced Cheque stays, Cancelled, with its history and its line. THE CALLER commits, then runs the
  cheque move (`cheque_payments.commit_move_to_reconciliation`): Approved and not on hold goes to
  Reconciliation Pending now, a waiting payment on approval, a held one on release, and
  Reconciliation Pending or Paid stays.
* `switch_payment_to_online` -- a Cheque payment whose Cheque is Cancelled (or, not Rejected, that is on
  no Cheque) goes back to Online and leaves that Cheque. Its status does not change. The Cancelled
  Cheque keeps its line as history.
* `validate_mode_change` -- the Project Payments `validate` rule that the mode changes only through a
  Cheque, which is what lets `mode_of_payment` drop `set_only_once`.

A Cheque moves no money figure, so nothing is recomputed.
"""

from dataclasses import replace

import frappe
from frappe import _

from nirmaan_stack.services.cheque_payments import MODE_ONLINE, is_cheque
from nirmaan_stack.services.cheques.rules import (
    NEW_CHEQUE_FROM_PAYMENT,
    PAYMENT_DOCTYPE,
    ChequeHeader,
    mode_change_problem,
    new_payment_cheque_problem,
    switch_to_online_problem,
)
from nirmaan_stack.services.cheques.writer import (
    CHEQUES,
    DuplicateChequeError,
    create_payment_cheque,
    payment_cheque_problem,
)


def put_payment_on_new_cheque(payment_name: str, header: ChequeHeader, *, user: str):
    """Make a new one-line Cheque for `payment_name` from `header` and put the payment on it. Returns
    the Cheque. The cheque is made out to the payment's PO / Work Order's Vendor, whatever `header`
    names. A bank + cheque number already recorded raises `DuplicateChequeError`."""
    pay = _locked_payment(payment_name)
    cheque_no, cheque_status = _cheque_of(pay)
    problem = new_payment_cheque_problem(
        pay.name, is_cheque=is_cheque(pay), status=pay.status, cheque_no=cheque_no, cheque_status=cheque_status
    )
    if problem:
        frappe.throw(_(problem))
    header = replace(header, vendor=frappe.db.get_value(pay.document_type, pay.document_name, "vendor"))
    refusal, existing = payment_cheque_problem(header, made_from=NEW_CHEQUE_FROM_PAYMENT)
    if existing:
        frappe.throw(_(refusal), DuplicateChequeError, title=_("Cheque Already Exists"))
    if refusal:
        frappe.throw(_(refusal))
    return create_payment_cheque(header, pay.name, user=user)


def switch_payment_to_online(payment_name: str):
    """Switch a Cheque payment whose Cheque is Cancelled back to Online and take it off that Cheque.
    Returns the payment. Its status, amount and everything else stay as they are; the number and date
    are cleared by its own `validate` (an Online payment has no cheque). Its Version row records who."""
    pay = _locked_payment(payment_name)
    cheque_no, cheque_status = _cheque_of(pay)
    problem = switch_to_online_problem(
        pay.name, is_cheque=is_cheque(pay), status=pay.status, cheque_no=cheque_no, cheque_status=cheque_status
    )
    if problem:
        frappe.throw(_(problem))
    pay.update({"mode_of_payment": MODE_ONLINE, "cheque": None})
    pay.save(ignore_permissions=True)
    return pay


def validate_mode_change(pay) -> None:
    """Refuse a save of the Project Payment `pay` that changes its Mode of Payment other than through
    a Cheque (`rules.mode_change_problem`). Called from its `validate`."""
    before = pay.get_doc_before_save()
    if not before:
        return
    old_cheque = before.get("cheque")
    problem = mode_change_problem(
        was_cheque=is_cheque(before),
        now_cheque=is_cheque(pay),
        cheque=pay.get("cheque"),
        old_cheque_status=frappe.db.get_value(CHEQUES, old_cheque, "status") if old_cheque else None,
    )
    if problem:
        frappe.throw(_(problem))


def _locked_payment(payment_name: str):
    """The payment, row-locked: two clicks at once cannot both make it a Cheque."""
    if not payment_name or not frappe.db.exists(PAYMENT_DOCTYPE, payment_name):
        frappe.throw(_("Payment {0} was not found.").format(payment_name))
    return frappe.get_doc(PAYMENT_DOCTYPE, payment_name, for_update=True)


def _cheque_of(pay) -> tuple[str | None, str | None]:
    """`(cheque_no, status)` of the Cheque the payment names; the status is None when it names none."""
    if not pay.get("cheque"):
        return pay.get("cheque_no") or None, None
    found = frappe.db.get_value(CHEQUES, pay.cheque, ["cheque_no", "status"], as_dict=True)
    if not found:
        return pay.get("cheque_no") or None, None
    return found.cheque_no, found.status
