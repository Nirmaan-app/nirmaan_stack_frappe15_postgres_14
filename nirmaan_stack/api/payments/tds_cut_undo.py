# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""*Company Bears TDS* and *Mark as Deposit*: an Admin undoes a Work Order payment's TDS (owner
2026-10-27). Replace the #1537 action *TDS paid by company*.

URL: /api/method/nirmaan_stack.api.payments.tds_cut_undo.company_bears_tds
URL: /api/method/nirmaan_stack.api.payments.tds_cut_undo.mark_as_deposit

Raising a cut payment to its full request (both actions) needs it `Approved` and not on a cheque; removing a
company-borne TDS (*Mark as Deposit*) changes no payment figure, so up to `Reconciliation Pending`. Never on a
`Paid` payment, and never once the TDS is paid (in a challan). The rules and why are in `services/tds_cut_undo`.
"""

import frappe
from frappe import _
from frappe.utils import flt

from nirmaan_stack.services import tds_cut_undo
from nirmaan_stack.services.payment_tds import COMPANY_BEARS_TDS, MARK_AS_DEPOSIT, PAYMENT_DOCTYPE
from nirmaan_stack.services.role_profiles import is_nirmaan_admin


def _refuse_unless_admin(action: str) -> None:
    if not is_nirmaan_admin(frappe.session.user):
        raise frappe.PermissionError(_("Only an Admin may use {0}.").format(action))


def _answer(payment: str, deduction: str) -> dict:
    return {"deduction": deduction, "amount": flt(frappe.db.get_value(PAYMENT_DOCTYPE, payment, "amount"), 2)}


@frappe.whitelist(methods=["POST"])
def company_bears_tds(payment: str) -> dict:
    """Put `payment` back to its full request and keep its TDS, now paid by the company. Admin only
    (`frappe.PermissionError` otherwise); the refusals are `services/tds_cut_undo.lock_deduction`'s and
    `refuse_unless_cut_undoable`'s.

    Returns:
        deduction: the `Payment TDS Deduction` kept, now `borne_by` Company.
        amount: the payment's amount after the change, its full request.

    Example (Rs 10,000 requested, cut to Rs 9,800 + Rs 200 TDS):
        {"deduction": "PTD-26-00412", "amount": 10000.0}
    """
    _refuse_unless_admin(COMPANY_BEARS_TDS)
    deduction = tds_cut_undo.company_bears_tds(payment)
    frappe.db.commit()
    return _answer(payment, deduction)


@frappe.whitelist(methods=["POST"])
def mark_as_deposit(payment: str) -> dict:
    """Delete `payment`'s TDS, and put a cut payment back to its full request. Admin only
    (`frappe.PermissionError` otherwise); the refusals are `services/tds_cut_undo.lock_deduction`'s, and for
    a cut payment `refuse_unless_cut_undoable`'s.

    Returns:
        deduction: the `Payment TDS Deduction` deleted.
        amount: the payment's amount after the change, its full request.

    Example (Rs 10,000 requested, cut to Rs 9,800 + Rs 200 TDS, or already Rs 10,000 + Rs 200 company-borne):
        {"deduction": "PTD-26-00412", "amount": 10000.0}
    """
    _refuse_unless_admin(MARK_AS_DEPOSIT)
    deduction = tds_cut_undo.mark_as_deposit(payment)
    frappe.db.commit()
    return _answer(payment, deduction)
