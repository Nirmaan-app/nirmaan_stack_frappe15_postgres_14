# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Approve a Payment cheque's payments together, from the approval dialog (#1480, spec #1477).

Thin endpoints (ADR-0010 B4): check who asks, call `services/cheques/decide.py`, commit, notify.

* `get_cheque_approval(payment_id, stage)` -- what the dialog shows for a payment on a cheque: every
  line, the cheque total, where L1 lands it, and why it cannot be approved yet. None for a payment on no
  Payment cheque (the dialog then approves the payment alone, as before).
* `approve_cheque_payments(payment_id)` -- the single L1 approve of a cheque payment: approves every
  payment on its cheque. The CEO's approve is `project_payments.ceo_approve_payment`, which sends cheque
  payments through the same operation.
* `reject_cheque_payments(payment_id, reason, stage)` -- the single reject, L1 or CEO (#1481): rejects
  every payment on the cheque and cancels it, with the reason on each payment and in its history.
* `get_cheque_groups(payment_ids, stage)` -- the bulk dialog's read: the Pending cheques a ticked set of
  payments is on, each with every line, so the dialog shows the siblings a bulk run decides with them.
"""

import json

import frappe
from frappe import _

from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER
from nirmaan_stack.services.approval_raiser import raiser_level
from nirmaan_stack.services.approval_tiers import RAISER_CEO, RAISER_L1
from nirmaan_stack.services.cheques import decide
from nirmaan_stack.services.settlement import STATUS_CEO_PENDING

_STAGES = {"lead": decide.STAGE_L1, "ceo": decide.STAGE_CEO}


@frappe.whitelist()
def get_cheque_approval(payment_id: str, stage: str = "lead") -> dict | None:
    """The approval dialog's view of the cheque `payment_id` is on, at `stage` ("lead" or "ceo").

    Returns `{cheque, cheque_no, bank, status, amount, vendor, vendor_name, status_after_l1, problem,
    lines: [{payment, record, project, project_name, amount, status}]}`, or None when the payment is on
    no Payment cheque. `payment` is None on a "No payment yet" line; `problem` is None when the cheque
    can be approved at `stage`.
    """
    frappe.has_permission("Project Payments", "read", doc=payment_id, throw=True)
    return decide.describe(payment_id, stage=_STAGES.get(stage, decide.STAGE_L1))


@frappe.whitelist(methods=["POST"])
def approve_cheque_payments(payment_id: str) -> dict:
    """L1-approve every payment on the Payment cheque `payment_id` is on (any one of them will do).

    Only an L1 approver (the Admin profile, Administrator, or the CEO) may. The cheque amount picks where
    they land: Approved and straight on to Reconciliation Pending, with the cheque Issued, or CEO Pending
    together (the CEO then gets one note for the cheque). Refused, with nothing changed, while a line has
    no payment, the lines and the cheque amount differ by more than ₹5, or a payment is at another step.

    Returns `{cheque, cheque_no, payments, status, issued, message}`.
    """
    if raiser_level(frappe.session.user) not in (RAISER_L1, RAISER_CEO):
        frappe.throw(_("Only an L1 approver can approve payments."), frappe.PermissionError)
    result = decide.approve(payment_id, stage=decide.STAGE_L1, user=frappe.session.user)
    frappe.db.commit()

    count = len(result["payments"])
    if result["status"] == STATUS_CEO_PENDING:
        _tell_the_ceo(result)
        message = _("All {0} payments on cheque {1} went to the CEO for approval.").format(count, result["cheque_no"])
    else:
        message = _("All {0} payments on cheque {1} approved; the cheque is Issued.").format(count, result["cheque_no"])
    return {**result, "message": message}


@frappe.whitelist(methods=["POST"])
def reject_cheque_payments(payment_id: str, reason: str, stage: str = "lead") -> dict:
    """Reject every payment on the Payment cheque `payment_id` is on, and cancel the cheque (#1481).

    `stage` is "lead" (the payments wait at Requested; an L1 approver may) or "ceo" (they wait at CEO
    Pending; only the CEO may). `reason` is required; it is written on each payment and in the cheque's
    history. Refused, with nothing changed, when the payment is on no Pending Payment cheque or no
    longer waits at `stage`.

    Returns `{cheque, cheque_no, payments, rejected, status, message}`.
    """
    if stage == "ceo":
        if frappe.session.user != CEO_AUTHORIZED_USER:
            frappe.throw(_("Only the authorised CEO user can perform this action."), frappe.PermissionError)
    elif raiser_level(frappe.session.user) not in (RAISER_L1, RAISER_CEO):
        frappe.throw(_("Only an L1 approver can reject payments."), frappe.PermissionError)
    result = decide.reject(
        payment_id, stage=_STAGES.get(stage, decide.STAGE_L1), reason=reason, user=frappe.session.user
    )
    frappe.db.commit()
    count = len(result["payments"])
    message = (
        _("All {0} payments on cheque {1} rejected; the cheque is Cancelled.").format(count, result["cheque_no"])
        if count > 1
        else _("Payment rejected; cheque {0} is Cancelled.").format(result["cheque_no"])
    )
    return {**result, "message": message}


@frappe.whitelist()
def get_cheque_groups(payment_ids, stage: str = "lead") -> list[dict]:
    """The Pending Payment cheques the payments `payment_ids` (a list, or its JSON) are on, once each, in
    the order first ticked: for each, what `get_cheque_approval` returns. A payment on no Pending Payment
    cheque adds nothing; a payment the user may not read is skipped."""
    if isinstance(payment_ids, str):
        payment_ids = json.loads(payment_ids)
    groups, seen = [], set()
    for payment in dict.fromkeys(payment_ids or []):
        if not frappe.has_permission("Project Payments", "read", doc=payment):
            continue
        cheque = decide.cheque_of(payment)
        if not cheque or cheque in seen:
            continue
        seen.add(cheque)
        groups.append(decide.describe(payment, stage=_STAGES.get(stage, decide.STAGE_L1)))
    return groups


def _tell_the_ceo(result: dict) -> None:
    """One note to the CEO for the whole cheque, after the commit. Best effort: the approval stands."""
    try:
        # Local: the controller module pulls in the notification stack.
        from nirmaan_stack.integrations.controllers.project_payments import notify_ceo_payment_awaiting

        first = frappe.get_doc("Project Payments", result["payments"][0])
        others = len(result["payments"]) - 1
        notify_ceo_payment_awaiting(
            first,
            f"is on cheque {result['cheque_no']}"
            + (f" with {others} other payment(s); all were" if others else " and was")
            + " approved by L1 and await your approval together.",
        )
    except Exception:
        frappe.log_error(title=f"Cheque approval notification ({result['cheque']})", message=frappe.get_traceback())
