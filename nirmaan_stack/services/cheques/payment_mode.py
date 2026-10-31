# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Project Payment's Mode of Payment: the Project Payments `validate` rules the cheques service owns
(spec #1407, spec #1477). Part of THE cheques service; never commits.

* `validate_mode_change` -- the mode changes only through a Cheque, which is what lets `mode_of_payment`
  drop `set_only_once`. The rule itself is pure: `payment_rules.mode_change_problem`.
* `validate_cheque_mode` -- a payment requested in, or changing to, Cheque mode must be a PO payment: Work
  Order payments are paid Online (#1487). The rule itself is pure: `payment_rules.cheque_mode_problem`.
* `validate_paid_by_clear` -- a cheque payment moves into Paid only in the clear of its cheque, and never out
  of it (#1552, ADR-0035 Amendment B). The rule itself is pure: `payment_rules.paid_move_problem`.
* `validate_on_a_cheque` -- a payment in Cheque mode always has its cheque (#1552). The rule itself is pure:
  `payment_rules.no_cheque_problem`.
* `validate_credit_cheque_date` -- until a Credit PO term's due date, its cheque is dated on or after it, checked
  again at every approval and cheque date change (owner, 2026-10-31). The rule itself is pure:
  `payment_rules.credit_cheque_date_problem`.
"""

import frappe
from frappe import _
from frappe.utils import today

from nirmaan_stack.services.cheque_payments import is_cheque
from nirmaan_stack.services.cheques.lines import cheques_naming
from nirmaan_stack.services.cheques.approval_rules import is_approval
from nirmaan_stack.services.cheques.payment_rules import (
    CHEQUE_FOLLOWS_FLAG,
    CLEARING_FLAG,
    CREDIT_TERM,
    cheque_mode_problem,
    credit_cheque_date_problem,
    mode_change_problem,
    no_cheque_problem,
    paid_move_problem,
)
from nirmaan_stack.services.cheques.rules import PAYMENT_DOCTYPE
from nirmaan_stack.services.cheques.writer import CHEQUES, PUTTING_ON_CHEQUE

PO_PAYMENT_TERMS = "PO Payment Terms"


def validate_mode_change(pay) -> None:
    """Refuse a save of the Project Payment `pay` that changes its Mode of Payment other than through
    a Cheque (`payment_rules.mode_change_problem`). Called from its `validate`. A payment whose line an edit
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
        on_old_cheque_lines=bool(old_cheque) and old_cheque in _cheques_listing(pay.name),
        by_the_cheques_service=bool(pay.flags.get(PUTTING_ON_CHEQUE)),
    )
    if problem:
        frappe.throw(_(problem))


def validate_cheque_mode(pay) -> None:
    """Refuse a Project Payment becoming a Cheque payment on anything but a PO (`payment_rules.cheque_mode_problem`):
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


def validate_paid_by_clear(pay) -> None:
    """Refuse a save of the Project Payment `pay` that moves a cheque payment into or out of Paid other than
    in the clear of its cheque (`payment_rules.paid_move_problem`). Called from its `validate`, so it holds
    for every path: Desk, REST, a hand settle, an Unreconcile, and any added later. The clear's own saves
    carry `CLEARING_FLAG` naming a cheque whose lines list the payment (`status._pay`)."""
    before = None if pay.is_new() else pay.get_doc_before_save()
    from_status = (before.status or "").strip() if before else None
    to_status = (pay.status or "").strip()
    clearing = pay.flags.get(CLEARING_FLAG)
    problem = paid_move_problem(
        pay.name,
        from_status=from_status,
        to_status=to_status,
        is_cheque=is_cheque(pay) or bool(before and is_cheque(before)),
        clearing=bool(clearing) and clearing in _cheques_listing(pay.name),
    )
    if problem:
        frappe.throw(_(problem), title=_("Paid by cheque"))


def validate_on_a_cheque(pay) -> None:
    """Refuse a save of the Project Payment `pay`, in Cheque mode, that no cheque lists
    (`payment_rules.no_cheque_problem`). Called from its `validate`. A new one counts as on a cheque only when
    Request Payment set `CHEQUE_FOLLOWS_FLAG`: it inserts the payment, then makes its cheque
    (`api/payments/payment_cheque.put_on_new_cheque`), and the save that puts it on that cheque finds the line.
    Any other insert in Cheque mode (Desk, REST) is refused."""
    if not is_cheque(pay):
        return
    if pay.is_new():
        on_a_cheque = bool(pay.flags.get(CHEQUE_FOLLOWS_FLAG))
    else:
        on_a_cheque = bool(_cheques_listing(pay.name))
    problem = no_cheque_problem(pay.name, status=(pay.status or "").strip(), on_a_cheque=on_a_cheque)
    if problem:
        frappe.throw(_(problem), title=_("Cheque payment on no cheque"))


def validate_credit_cheque_date(pay) -> None:
    """Refuse an approval of a cheque payment on a Credit PO term, or a change of its cheque date, while the cheque
    is dated before the term's due date and that date has not come (`payment_rules.credit_cheque_date_problem`).
    Called from its `validate`, so single, CEO and bulk approval, and the Cheque Tracker's date edit (copied onto
    the payment by `writer.link_payments`), all meet it. The request checks the same before the insert
    (`project_payments.create_project_payment`), when the term is not linked yet.

    The bank import's saves are let through (`from_outflow_import`): a bank line clearing the cheque means the
    bank has already paid it (`status._bring_forward`)."""
    if pay.is_new() or not is_cheque(pay) or pay.flags.get("from_outflow_import"):
        return
    before = pay.get_doc_before_save()
    if not before:
        return
    date_changed = str(before.get("cheque_date") or "")[:10] != str(pay.get("cheque_date") or "")[:10]
    if not date_changed and not is_approval(before.status, pay.status):
        return
    due_date = frappe.db.get_value(
        PO_PAYMENT_TERMS, {"project_payment": pay.name, "payment_type": CREDIT_TERM}, "due_date"
    )
    problem = credit_cheque_date_problem(cheque_date=pay.get("cheque_date"), due_date=due_date, today=today())
    if problem:
        frappe.throw(_(problem), title=_("Cheque dated before the due date"))


def _cheques_listing(payment: str) -> set[str]:
    """The Cheques whose lines name Project Payment `payment`, any status (`lines.cheques_naming`)."""
    return {r.cheque for r in cheques_naming(PAYMENT_DOCTYPE, [payment])}
