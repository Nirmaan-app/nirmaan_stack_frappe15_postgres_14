# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Project Payment's Mode of Payment changes only through a Cheque (spec #1407). Part of THE cheques
service; never commits.

`validate_mode_change` is the Project Payments `validate` rule, which is what lets `mode_of_payment` drop
`set_only_once`. The rule itself is pure: `rules.mode_change_problem`.
"""

import frappe
from frappe import _

from nirmaan_stack.services.cheque_payments import is_cheque
from nirmaan_stack.services.cheques.rules import PAYMENT_DOCTYPE, mode_change_problem
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
