# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Request Payment in Cheque mode: the payment and its new one-line Cheque, in one request (#1414).

Both PO / Work Order request endpoints (`project_payments.create_project_payment` and
`create_payment_request_for_service`) call these three steps, in this order:

1. `cheque_header` -- the cheque the dialog sends (read off its photo), or None for Online.
2. `refuse_unless_cheque_can_be_made` -- BEFORE `pay.insert()`. A Project Payment's `after_insert`
   commits (its notifications), so once the payment is inserted a refusal can no longer take it back.
   A bank + cheque number already recorded raises `DuplicateChequeError`.
3. `put_on_new_cheque` -- after the insert: the cheques service makes the Cheque and puts the payment
   on it. Should that still fail (another user recorded the same number in between), the payment is
   withdrawn, so no Cheque payment is left without its Cheque.

The endpoint then commits and runs the usual cheque move: a payment born Approved goes on to
Reconciliation Pending.
"""

import frappe
from frappe import _

from nirmaan_stack.services import cheque_payments
from nirmaan_stack.services.cheques.rules import ChequeHeader, parse_header
from nirmaan_stack.services.cheques.writer import (
    CHEQUES_CHANGED_EVENT,
    DuplicateChequeError,
    create_payment_cheque,
    payment_cheque_problem,
)

def cheque_header(source: dict, *, vendor: str) -> ChequeHeader | None:
    """The cheque a request names, made out to the PO / Work Order's `vendor`; None for Online.

    `source` carries `mode_of_payment`, `bank`, `bank_name`, `cheque_no`, `cheque_date`,
    `cheque_amount` (what the cheque is written for) and `cheque_attachment` (the photo's file URL).
    """
    if (source.get("mode_of_payment") or "").strip() != cheque_payments.MODE_CHEQUE:
        return None
    return parse_header({
        "bank": source.get("bank"),
        "bank_name": source.get("bank_name"),
        "cheque_no": source.get("cheque_no"),
        "cheque_date": source.get("cheque_date"),
        "amount": source.get("cheque_amount"),
        "vendor": vendor,
        "attachment": source.get("cheque_attachment"),
    })


def refuse_unless_cheque_can_be_made(header: ChequeHeader | None) -> None:
    """Throw now if the Cheque could not be made: no photo, a missing field, or a bank + number
    already recorded (`DuplicateChequeError`). Call it before the payment is inserted."""
    if header is None:
        return
    problem, existing = payment_cheque_problem(header)
    if existing:
        frappe.throw(_(problem), DuplicateChequeError, title=_("Cheque Already Exists"))
    if problem:
        frappe.throw(_(problem))


def put_on_new_cheque(payment_name: str, header: ChequeHeader | None) -> str | None:
    """Make the one-line Cheque for the just-inserted payment and return its name (None for Online).

    Commits nothing on success. On failure the request is rolled back and the payment, which its
    `after_insert` may already have committed, is deleted; then the error is raised again.
    """
    if header is None:
        return None
    try:
        cheque = create_payment_cheque(header, payment_name, user=frappe.session.user).name
    except Exception:
        frappe.db.rollback()
        _withdraw(payment_name)
        raise
    frappe.publish_realtime(CHEQUES_CHANGED_EVENT, {"cheque": cheque}, after_commit=True)
    return cheque


def _withdraw(payment_name: str) -> None:
    """Delete a payment whose Cheque could not be made. Its `on_trash` puts a PO term back and
    removes any TDS row, as for any deleted payment. Never raises over the original error."""
    try:
        if frappe.db.exists("Project Payments", payment_name):
            frappe.delete_doc("Project Payments", payment_name, ignore_permissions=True, force=True)
            frappe.db.commit()
    except Exception:
        frappe.db.rollback()
        frappe.log_error(
            title=f"Cheque payment left without its Cheque ({payment_name})",
            message=frappe.get_traceback(),
        )
