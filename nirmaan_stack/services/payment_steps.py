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
    Requested / Rejected -> Reconciliation Pending / Paid   the approval it skips: L1, or the CEO above
                                                            the L1 limit
    CEO Pending -> Reconciliation Pending / Paid            CEO (it skips the CEO's step)
    any other move                                          L1: an Admin's correction
A raise (`raise_step_needed`) of a payment past its approval (Approved, Reconciliation Pending, Paid) to
above the L1 limit needs the CEO, whatever its `ceo_approval_date` says: the CEO approved the amount it had
then, not the new one, and an auto-approval stamps that date too. PO and Work Order payments alike.
`ceo_approval_date` is set only by the CEO's own approval (the save that makes the CEO step) or by the
system's moves; a user save that sets or changes it otherwise is refused (`ceo_date_refusal`).
A new payment (`born_step_needed`) may be born at Approved or CEO Pending only past the steps its raiser
holds or its amount skips: the auto band and the raiser's own step (`approval_tiers`). One born at
Reconciliation Pending needs the tier its amount needs: the CEO above the L1 limit, L1 from the auto line,
the settle roles below it. A payment born at any other status is left as it was:
Requested needs no one, and the direct Paid entry stays as it is (spec #1528, Out of Scope).

THE SYSTEM'S OWN MOVES (`SYSTEM_STEP_FLAGS`) are not a person choosing a step, and carry a flag only
server code can set. Each caller checks its own user first.
"""

import frappe
from frappe import _
from frappe.utils import flt, getdate

from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER
from nirmaan_stack.services import settlement
from nirmaan_stack.services.approval_tiers import TIER_L2_ABOVE, is_auto_approved, needs_ceo
from nirmaan_stack.services.cheque_payments import CHEQUE_MOVES_ON, is_cheque
from nirmaan_stack.services.cheques.decide import DECIDING_FLAG
from nirmaan_stack.services.role_profiles import (
    PAYMENT_L1_PROFILES,
    PAYMENT_SETTLE_PROFILES,
    has_role_profile,
)

# The payment statuses are `services/settlement`'s (ADR-0010: one owner), under short local names.
REQUESTED = settlement.STATUS_REQUESTED
CEO_PENDING = settlement.STATUS_CEO_PENDING
APPROVED = settlement.STATUS_APPROVED
REJECTED = settlement.STATUS_REJECTED
RECONCILIATION_PENDING = settlement.STATUS_RECONCILIATION_PENDING
PAID = settlement.STATUS_PAID

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

#: Every status a payment can hold (`services/settlement`). Status is a Data field, so the save refuses any other.
KNOWN_STATUSES = tuple(settlement.STATUS_LABELS)

#: Statuses before approval, and past it.
_WAITING = (REQUESTED, REJECTED, CEO_PENDING)
PAST_APPROVAL = (APPROVED, RECONCILIATION_PENDING, PAID)

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
    # Not stripped: a padded "Paid " is no status of the six (`refuse_unknown_status`), so it is unknown here too.
    was, now = was or "", now or ""
    if was == now:
        return None
    if was not in KNOWN_STATUSES and now in PAST_APPROVAL:
        # A status saved before the rule (or typed in, or padded): it is past no step, so the move needs
        # the approval its amount needs (review round 4, X5).
        return STEP_CEO if needs_ceo(flt(amount)) else STEP_L1
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
    if was in _WAITING and now in PAST_APPROVAL:
        # Skips the approval: the step it skips is the one it needs.
        return STEP_CEO if was == CEO_PENDING or needs_ceo(flt(amount)) else STEP_L1
    return STEP_L1


def raise_step_needed(status: str, old_amount, new_amount) -> str | None:
    """The step a save that raises a payment past its approval needs: the tier its NEW amount needs (the
    CEO above the L1 limit, L1 from the auto-approve line), or None within the auto band or for a cut."""
    if (status or "").strip() not in PAST_APPROVAL or flt(new_amount) <= flt(old_amount):
        return None
    if needs_ceo(flt(new_amount)):
        return STEP_CEO
    return None if is_auto_approved(flt(new_amount)) else STEP_L1


def born_step_needed(status: str, amount) -> str | None:
    """The step a new payment born at `status` has already passed, or None when it passed none."""
    status = (status or "").strip()
    if status == APPROVED:
        if is_auto_approved(flt(amount)):
            return None
        return STEP_CEO if needs_ceo(flt(amount)) else STEP_L1
    if status == CEO_PENDING:
        return STEP_L1
    if status == RECONCILIATION_PENDING:
        # Born past approval AND Mark as Paid: the approval its amount needs, or the settle roles below
        # the auto line (which needs no approval).
        if needs_ceo(flt(amount)):
            return STEP_CEO
        return STEP_SETTLE if is_auto_approved(flt(amount)) else STEP_L1
    return None


def holds(user: str, step: str) -> bool:
    if user == "Administrator":
        return True
    if step == STEP_CEO:
        return user == CEO_AUTHORIZED_USER
    if step == STEP_SETTLE:
        return has_role_profile(user, PAYMENT_SETTLE_PROFILES)
    return user == CEO_AUTHORIZED_USER or has_role_profile(user, PAYMENT_L1_PROFILES)


def is_system_move(doc) -> bool:
    """The save is one of the system's own moves (`SYSTEM_STEP_FLAGS`), each flag set only by server code."""
    return any(doc.flags.get(flag) for flag in SYSTEM_STEP_FLAGS)


def refuse_step_out_of_tier(doc, user: str) -> None:
    """Refuse a save of payment `doc` that makes a step `user` does not hold."""
    refuse_unknown_status(doc)
    if is_system_move(doc):
        return
    if doc.is_new():
        was, step = None, born_step_needed(doc.status, doc.amount)
        ceo_date_moved = bool(doc.get("ceo_approval_date"))
    else:
        before = doc.get_doc_before_save()
        if before is None:
            return
        was, step = before.status, step_needed(before.status, doc.status, doc.amount)
        ceo_date_moved = _date(before.get("ceo_approval_date")) != _date(doc.get("ceo_approval_date"))
        if _rejects_settled_money(before, doc) and user != "Administrator":
            # Money that has left the bank: a reject would free the order for a fresh payment and let
            # the amendment rules pass (stories 18-19). Unreconcile or revert is the way back.
            frappe.throw(SETTLED_REJECT_REFUSAL, PaymentStepRefused, title=_("Not allowed"))
        if _goes_back_from_settled_money(before, doc) and user != "Administrator":
            # Paid -> Approved, then Approved -> Rejected (or Requested, then another order) would reach
            # what one save may not (review round 4, X2(b), X6).
            frappe.throw(SETTLED_BACK_REFUSAL, PaymentStepRefused, title=_("Not allowed"))
        raise_step = raise_step_needed(doc.status, before.amount, doc.amount)
        if raise_step and not holds(user, raise_step):
            frappe.throw(_raise_refusal(doc.status, raise_step, doc.amount), PaymentStepRefused,
                         title=_("Not allowed"))
    if ceo_date_moved and step != STEP_CEO:
        frappe.throw(CEO_DATE_REFUSAL, PaymentStepRefused, title=_("Not allowed"))
    if step and not holds(user, step):
        frappe.throw(_refusal(was, doc.status, step), PaymentStepRefused, title=_("Not allowed"))


CEO_DATE_REFUSAL = "The CEO approval date is set only by the CEO's approval, never by hand."


def _date(value):
    return getdate(value) if value else None


SETTLED_REJECT_REFUSAL = (
    "A payment whose money has left the bank (Reconciliation Pending or Paid) can't be rejected. Unreconcile it, "
    "or revert it to Approved, first."
)


#: Set by `api/payments/revert_to_approved`, the one sanctioned user move from Reconciliation Pending back
#: to Approved (it checks the settle roles, the cheque and the bank match itself).
REVERT_TO_APPROVED = "revert_to_approved"

SETTLED_BACK_REFUSAL = (
    "A payment whose money has left the bank goes back only by Unreconcile in Bulk Import Outflow (Paid), "
    "or Revert to Approved (Reconciliation Pending)."
)


def _rejects_settled_money(before, doc) -> bool:
    """A move from Reconciliation Pending or Paid to Rejected. A cheque payment at Reconciliation Pending
    is not money gone yet: its cheque waits to clear, and rejecting it cancels the cheque (#1481). The mode
    is read BEFORE the save (review round 4, X6): a save that also turns it into a cheque payment is no
    cheque payment yet."""
    was, now = before.status, doc.status
    if now != REJECTED or was not in settlement.SETTLED_STATUSES:
        return False
    return not (was == RECONCILIATION_PENDING and is_cheque(before))


def _goes_back_from_settled_money(before, doc) -> bool:
    """A user move out of Paid, or out of Reconciliation Pending other than to Paid, Rejected (ruled by
    `_rejects_settled_money`) or, through Revert to Approved, Approved."""
    was, now = before.status, doc.status
    if was == now or was not in settlement.SETTLED_STATUSES:
        return False
    if was == PAID:
        return True
    if now in (PAID, REJECTED):
        return False
    return not (now == APPROVED and doc.flags.get(REVERT_TO_APPROVED))


def refuse_unknown_status(doc) -> None:
    """A payment holds one of `KNOWN_STATUSES`: any other (a typed "Hold") would sit outside every step and
    let the payment come back to Approved or Paid unchecked. A legacy row saved without a status change passes."""
    status = doc.status or ""
    # Exactly one of the six: a padded "Paid " would pass a stripped check yet drop out of every filter
    # on `status = "Paid"` (Amount Paid, the limits; review round 4, X5).
    if status in KNOWN_STATUSES:
        return
    before = None if doc.is_new() else doc.get_doc_before_save()
    if before is not None and (before.status or "") == status:
        return
    frappe.throw(_("{0} is not a payment status. A payment is one of: {1}.").format(
        status or _("A blank status"), ", ".join(KNOWN_STATUSES)), PaymentStepRefused, title=_("Not allowed"))


def _raise_refusal(status: str, step: str, amount) -> str:
    return _("Only {0} can raise a {1} payment to ₹{2}: that amount needs their approval.").format(
        _(HOLDERS[step]), status, f"{flt(amount):,.0f}"
    )


def _refusal(was: str | None, now: str, step: str) -> str:
    move = _("create a payment at {0}").format(now) if was is None else _("move a payment from {0} to {1}").format(was, now)
    message = _("Only {0} can {1}.").format(_(HOLDERS[step]), move)
    if step == STEP_CEO and now == APPROVED and was != CEO_PENDING:
        message += " " + _("A payment above ₹{0} goes to CEO Pending first; the CEO then approves it.").format(
            f"{int(TIER_L2_ABOVE):,}"
        )
    return message
