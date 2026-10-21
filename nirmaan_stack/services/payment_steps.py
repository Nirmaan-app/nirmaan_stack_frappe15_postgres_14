# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Who may move a PO or Work Order payment a step (#1530, spec #1528 stories 5-7).

The Project Payments `validate` hook calls `refuse_step_out_of_tier` on every save, so Desk, the REST
API and the screens meet the same rule. The tiers are the ones the Payments screens use
(`frontend/src/pages/ProjectPayments/config/paymentsTabSet.ts`):

    L1      `canApprove`  the Admin profile (`role_profiles.PAYMENT_L1_PROFILES`) and the CEO
    CEO     `isCEO`       `CEO_AUTHORIZED_USER` alone
    settle  `canSettle`   Admin, Accountant, Accountant Lead (`role_profiles.PAYMENT_SETTLE_PROFILES`)

`Administrator`, the site superuser, holds every tier, as it passes every gate in `role_profiles`.

THE MOVES (`step_needed`)
    Requested / Rejected -> CEO Pending                     L1
    Requested / Rejected -> Approved                        L1, or the CEO above the L1 limit
    Requested -> Rejected                                   L1
    CEO Pending -> Approved / Rejected                      CEO
    Approved -> Reconciliation Pending (Mark as Paid)       settle
    Approved / Reconciliation Pending -> Paid (fulfil)      settle
    Reconciliation Pending -> Approved (revert)             settle
    any other move                                          L1: an Admin's correction
A new payment (`born_step_needed`) may be born at Approved or CEO Pending only past the steps its raiser
holds or its amount skips: the auto band and the raiser's own step (`approval_tiers`). A payment born at
any other status is left as it was: Requested needs no one, and the direct Paid entry stays as it is
(spec #1528, Out of Scope).

THE SYSTEM'S OWN MOVES (`SYSTEM_STEP_FLAGS`) are not a person choosing a step, and carry a flag only
server code can set. Each caller checks its own user first.
"""

import frappe
from frappe import _
from frappe.utils import flt

from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER
from nirmaan_stack.services.approval_tiers import TIER_L2_ABOVE, is_auto_approved, needs_ceo
from nirmaan_stack.services.cheque_payments import CHEQUE_MOVES_ON
from nirmaan_stack.services.cheques.decide import DECIDING_FLAG
from nirmaan_stack.services.role_profiles import (
    PAYMENT_L1_PROFILES,
    PAYMENT_SETTLE_PROFILES,
    has_role_profile,
)

REQUESTED = "Requested"
CEO_PENDING = "CEO Pending"
APPROVED = "Approved"
REJECTED = "Rejected"
RECONCILIATION_PENDING = "Reconciliation Pending"
PAID = "Paid"

STEP_L1 = "l1"
STEP_CEO = "ceo"
STEP_SETTLE = "settle"

#: Who holds each step, as a refusal names them.
HOLDERS = {
    STEP_L1: "an Admin",
    STEP_CEO: "the CEO",
    STEP_SETTLE: "an Admin, Accountant or Accountant Lead",
}

#: Set by the creation endpoints (`api/payments/project_payments`), which route a new payment's status
#: by the raiser's level themselves, on the CHEQUE amount for a cheque payment (spec #1477, C3).
ROUTED_AT_REQUEST = "payment_status_routed"

#: The system's own moves. Each flag is set only by server code, never by a REST write.
SYSTEM_STEP_FLAGS = (
    ROUTED_AT_REQUEST,
    CHEQUE_MOVES_ON,  # an approved cheque payment moves on to Reconciliation Pending by itself
    "from_adjustment",  # PO adjustments and PO Revision write payments at their status
    "from_outflow_import",  # Bulk Import settle and unreconcile, and a cheque cleared by the bank
    "split_approval",  # the CEO's partial approval and Bulk Import's part settle trim the original
    "split_child",  # ...and insert its balance
    DECIDING_FLAG,  # a cheque's decision moves every payment on it (`services/cheques/decide`)
)

_SETTLE_MOVES = {
    (APPROVED, RECONCILIATION_PENDING),
    (APPROVED, PAID),
    (RECONCILIATION_PENDING, PAID),
    (RECONCILIATION_PENDING, APPROVED),
}


class PaymentStepRefused(frappe.ValidationError):
    """This user does not hold the step this payment save makes."""

    http_status_code = 403


def step_needed(was: str, now: str, amount) -> str | None:
    """The step a save moving a payment from `was` to `now` makes, or None when the status is unchanged."""
    was, now = (was or "").strip(), (now or "").strip()
    if was == now:
        return None
    if was in (REQUESTED, REJECTED) and now == APPROVED:
        return STEP_CEO if needs_ceo(flt(amount)) else STEP_L1
    if was in (REQUESTED, REJECTED) and now == CEO_PENDING:
        return STEP_L1
    if was == REQUESTED and now == REJECTED:
        return STEP_L1
    if was == CEO_PENDING and now in (APPROVED, REJECTED):
        return STEP_CEO
    if (was, now) in _SETTLE_MOVES:
        return STEP_SETTLE
    return STEP_L1


def born_step_needed(status: str, amount) -> str | None:
    """The step a new payment born at `status` has already passed, or None when it passed none."""
    status = (status or "").strip()
    if status == APPROVED:
        if is_auto_approved(flt(amount)):
            return None
        return STEP_CEO if needs_ceo(flt(amount)) else STEP_L1
    if status == CEO_PENDING:
        return STEP_L1
    return None


def holds(user: str, step: str) -> bool:
    if user == "Administrator":
        return True
    if step == STEP_CEO:
        return user == CEO_AUTHORIZED_USER
    if step == STEP_SETTLE:
        return has_role_profile(user, PAYMENT_SETTLE_PROFILES)
    return user == CEO_AUTHORIZED_USER or has_role_profile(user, PAYMENT_L1_PROFILES)


def refuse_step_out_of_tier(doc, user: str) -> None:
    """Refuse a save of payment `doc` that makes a step `user` does not hold."""
    if any(doc.flags.get(flag) for flag in SYSTEM_STEP_FLAGS):
        return
    if doc.is_new():
        was, step = None, born_step_needed(doc.status, doc.amount)
    else:
        before = doc.get_doc_before_save()
        if before is None:
            return
        was, step = before.status, step_needed(before.status, doc.status, doc.amount)
    if step and not holds(user, step):
        frappe.throw(_refusal(was, doc.status, step), PaymentStepRefused, title=_("Not allowed"))


def _refusal(was: str | None, now: str, step: str) -> str:
    move = _("create a payment at {0}").format(now) if was is None else _("move a payment from {0} to {1}").format(was, now)
    message = _("Only {0} can {1}.").format(_(HOLDERS[step]), move)
    if step == STEP_CEO and now == APPROVED and was != CEO_PENDING:
        message += " " + _("A payment above ₹{0} goes to CEO Pending first; the CEO then approves it.").format(
            f"{int(TIER_L2_ABOVE):,}"
        )
    return message
