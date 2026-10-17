# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Project Payment's Mode of Payment: the Project Payments `validate` rules the cheques service owns
(spec #1407, spec #1477). Part of THE cheques service; never commits.

* `validate_mode_change` -- the mode changes only through a Cheque, which is what lets `mode_of_payment`
  drop `set_only_once`. The rule itself is pure: `rules.mode_change_problem`.
* `validate_cheque_mode` -- a payment requested in, or changing to, Cheque mode must be a PO payment: Work
  Order payments are paid Online (#1487). The rule itself is pure: `rules.cheque_mode_problem`.
"""

import frappe
from frappe import _

from nirmaan_stack.services.cheque_payments import is_cheque
from nirmaan_stack.services.cheques.rules import PAYMENT_DOCTYPE, cheque_mode_problem, mode_change_problem
from nirmaan_stack.services.cheques.writer import CHEQUES


def validate_mode_change(pay) -> None:
    """Refuse a save of the Project Payment `pay` that changes its Mode of Payment other than through
    a Cheque (`rules.mode_change_problem`). Called from its `validate`. A payment whose line an edit
    took off its Cheque is no longer held by it, whatever that Cheque's status."""
    before = pay.get_doc_before_save()
    if not before or is_cheque(before) == is_cheque(pay):
        return
    old_cheque = before.get("cheque")
    problem = mode_change_problem(
        was_cheque=is_cheque(before),
        now_cheque=is_cheque(pay),
        cheque=pay.get("cheque"),
        old_cheque_status=frappe.db.get_value(CHEQUES, old_cheque, "status") if old_cheque else None,
        on_old_cheque_lines=bool(old_cheque) and bool(frappe.db.exists("Cheque Line", {
            "parenttype": CHEQUES,
            "parent": old_cheque,
            "payment_doctype": PAYMENT_DOCTYPE,
            "payment_name": pay.name,
        })),
    )
    if problem:
        frappe.throw(_(problem))


def validate_cheque_mode(pay) -> None:
    """Refuse a Project Payment becoming a Cheque payment on anything but a PO (`rules.cheque_mode_problem`):
    a new one requested in Cheque mode, or a saved one changing to it (put on a cheque). Called from its
    `validate`, so it holds for every path, before the insert's `after_insert` commits. A Work Order payment
    already in Cheque mode finishes as it is (spec #1477 story 88)."""
    if not is_cheque(pay):
        return
    before = None if pay.is_new() else pay.get_doc_before_save()
    if before and is_cheque(before):
        return
    problem = cheque_mode_problem(pay.get("document_type"))
    if problem:
        frappe.throw(_(problem))
