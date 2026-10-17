# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Editing a Cheque, and what the Cheque Tracker's Add and Edit take on a Payment cheque (#1418, #1482,
#1486, spec #1477). Pure: no `frappe.db`. `writer.edit_cheque` and `writer.add_payment_cheque` ask it.

Each `*_problem` function returns the refusal a user reads, or None.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from nirmaan_stack.services.cheques.approval_rules import ApprovalLine, approval_problem
from nirmaan_stack.services.cheques.rules import (
    CHEQUE_TYPE_PAYMENT,
    CHEQUE_TYPE_SECURITY_DEPOSIT,
    ISSUED,
    LINE_PO_WO_PAYMENT,
    MADE_FROM_PO_WO_PAGE,
    PAYMENT_DOCTYPE,
    PENDING,
    PO_DOCTYPE,
    ChequeHeader,
    ChequeLineInput,
    join_words,
)
from nirmaan_stack.services.settlement import (
    STATUS_APPROVED,
    STATUS_CEO_PENDING,
    STATUS_REQUESTED,
)


#: The header fields an edit compares. The photo (`attachment`) is apart: it may always be replaced.
EDITABLE_HEADER_FIELDS = (
    "bank", "bank_name", "cheque_no", "cheque_date", "amount", "vendor", "payee_name", "description",
)
#: What a Cheque made from the PO/WO page keeps, so it stays in step with the payment it came from,
#: while a Project Payment is still on it (`edit_problem`).
LOCKED_ON_PO_WO_PAGE = {"cheque_no": "number", "cheque_date": "date", "amount": "amount"}
#: The statuses at which a Cheque's fields and lines may still be edited; any other status is photo only.
#: A Payment cheque's lines change only while Pending (#1482, spec #1477): once its payments are approved
#: it is Issued, and its payments and the bank line follow it as it is.
EDITABLE_STATUSES = (PENDING,)
#: A Security Deposit cheque is Issued from the start and changes while it is (#1486, story 79); once
#: Cancelled only its photo can change.
DEPOSIT_EDITABLE_STATUSES = (ISSUED,)


def editable_statuses(cheque_type: str) -> tuple:
    """The statuses at which a Cheque of `cheque_type` may change more than its photo."""
    return DEPOSIT_EDITABLE_STATUSES if cheque_type == CHEQUE_TYPE_SECURITY_DEPOSIT else EDITABLE_STATUSES


def edit_access_problem(
    *, status: str, owner: str, user: str, any_cheque: bool, cheque_type: str = CHEQUE_TYPE_PAYMENT
) -> str | None:
    """Why `user` may not edit this Cheque, or None. `any_cheque` is True for Admin, Accountant and
    Accountant Lead; anyone else who may use cheques (Procurement) edits only the Cheques they created,
    a Payment cheque while Pending (C6), a Security Deposit cheque while Issued (`editable_statuses`)."""
    if any_cheque or (status in editable_statuses(cheque_type) and owner == user):
        return None
    if cheque_type == CHEQUE_TYPE_SECURITY_DEPOSIT:
        return "You can edit only the Issued Security Deposit cheques you created."
    return "You can edit only the Pending cheques you created."


def edit_problem(
    before: ChequeHeader,
    after: ChequeHeader,
    *,
    status: str,
    made_from: str,
    lines_before: list[ChequeLineInput],
    lines_after: list[ChequeLineInput],
    old_type: bool = False,
    cheque_type: str = CHEQUE_TYPE_PAYMENT,
) -> str | None:
    """Why this edit of a Cheque cannot be saved, or None. The rules are the ones the editor sees:

    * the photo can be replaced, never removed;
    * an Old-type cheque (spec #1477) can change only its photo, whatever its status;
    * an Issued, Cleared or Cancelled Payment cheque can change only its photo (`EDITABLE_STATUSES`); a
      Security Deposit cheque changes in full while Issued and only its photo once Cancelled (#1486);
    * a Pending Cheque made from the PO/WO page keeps its number, date and amount while it still has a
      Project Payment line (they stay in step with the payment), but its other fields and its lines can
      change. With no Project Payment line left (removed or swapped out) it edits like a Tracker-made
      Cheque;
    * a Pending Cheque made in the Tracker can change everything;
    * any line can come off a Pending Cheque. A Project Payment taken off switches back to Online
      (`payments_taken_off`), and its status stays as it is.

    What a Payment cheque's header and lines may hold is `tracker_payment_cheque_problem`.

    The header and line rules every save runs (one payee, a live Cheque per payment, ...) are the
    `validate` controller's, not repeated here.
    """
    if before.attachment and not after.attachment:
        return "The cheque's photo can be replaced, not removed."
    changed = [f for f in EDITABLE_HEADER_FIELDS if getattr(before, f) != getattr(after, f)]
    if old_type and (changed or lines_before != lines_after):
        return f"Cheque {before.cheque_no} is an Old-type cheque: only its photo can change."
    if status not in editable_statuses(cheque_type):
        if changed or lines_before != lines_after:
            return f"Cheque {before.cheque_no} is {status}: only its photo can change."
        return None
    if made_from == MADE_FROM_PO_WO_PAGE and any(line.payment_doctype == PAYMENT_DOCTYPE for line in lines_before):
        locked = [LOCKED_ON_PO_WO_PAGE[f] for f in changed if f in LOCKED_ON_PO_WO_PAGE]
        if locked:
            return (
                f"Cheque {before.cheque_no} was made from the PO/WO page, so its {join_words(locked)} cannot "
                f"change here: change {'it' if len(locked) == 1 else 'them'} on the payment."
            )
    return None


def payments_taken_off(lines_before: list[ChequeLineInput], lines_after: list[ChequeLineInput]) -> list[str]:
    """The Project Payments `lines_before` hold and `lines_after` do not, in line order. A payment taken
    off a Pending Cheque switches back to Online at its own step (owner ruling, spec #1407 story 82)."""
    kept = {line.payment_name for line in lines_after if line.payment_doctype == PAYMENT_DOCTYPE}
    return [
        line.payment_name
        for line in lines_before
        if line.payment_doctype == PAYMENT_DOCTYPE and line.payment_name and line.payment_name not in kept
    ]


def taken_off_note(payment: str) -> str:
    """The Cheque's history note for a payment an edit took off it."""
    return f"Payment {payment} was taken off the cheque, so it switched back to Online."


#: The steps a payment may be at to be put on a Payment cheque: waiting for approval, or approved and
#: not yet moved on (the cheque is then Issued at once). A cheque's payments are approved together, so
#: they are all at one step.
PICKABLE_STEPS = (STATUS_REQUESTED, STATUS_CEO_PENDING, STATUS_APPROVED)


@dataclass(frozen=True)
class TrackerLine:
    """One line of a Payment cheque the Tracker saves, with what its rules need to know."""

    line: ChequeLineInput
    #: New on this save: every line of a new cheque; on an edit, a line the cheque did not hold.
    added: bool
    #: The status of the payment the line names; None while it names none.
    payment_status: str | None = None
    on_hold: bool = False


def line_identity(line: ChequeLineInput) -> tuple:
    """What a line pays, to tell an edit's added lines from the ones it kept: its kind, record and
    payment. The same line with another amount typed is not added."""
    return (line.line_type, line.record_doctype, line.record_name, line.payment_name)


def tracker_payment_cheque_problem(header: ChequeHeader, lines: Sequence[TrackerLine]) -> str | None:
    """Why the Cheque Tracker cannot save this Payment cheque, new or edited, or None. Pure.

    * It is made out to a Vendor: no typed payee (spec #1477 Q17).
    * It has at least one line: no Ad-hoc Payment cheque.
    * Each added line is a PO payment: no Work Order line (Work Order payments are paid Online) and no
      expense line (Q11). A Work Order line already on a cheque from before stays.
    * Each added payment is at Requested, CEO Pending or Approved (`PICKABLE_STEPS`) and not on hold.
    * When a payment is added, every payment on the cheque is at the same step, since they are
      approved together (C1). Otherwise the payments already on it are not judged again.

    The rules every save runs (the Vendor's PO in the line's project, one live cheque per payment, ...)
    are the `validate` controller's (`lines.lines_problem`).
    """
    if not header.vendor:
        return "A Payment cheque is made out to a Vendor: pick the Vendor, not a typed payee."
    if not lines:
        return "Add at least one PO payment: a Payment cheque pays the PO payments on its lines."
    for n, tracker in enumerate(lines, 1):
        line = tracker.line
        if tracker.added and (line.line_type != LINE_PO_WO_PAYMENT or line.record_doctype != PO_DOCTYPE):
            return (
                f"Line {n}: a Payment cheque pays PO payments only. Work Order payments are paid Online, "
                "and expenses are not paid by cheque."
            )
    picked = [(n, t) for n, t in enumerate(lines, 1) if t.added and t.line.payment_name]
    for n, tracker in picked:
        status = (tracker.payment_status or "").strip()
        if status not in PICKABLE_STEPS:
            return (
                f"Line {n}: payment {tracker.line.payment_name} is {status or 'not found'}: only a Requested, "
                "CEO Pending or Approved payment can be put on a cheque."
            )
        if tracker.on_hold:
            return f"Line {n}: payment {tracker.line.payment_name} is on hold: release the hold first."
    if picked:
        named = [t for t in lines if t.line.payment_name]
        if len({(t.payment_status or "").strip() for t in named}) > 1:
            steps = ", ".join(f"{t.line.payment_name} is {t.payment_status}" for t in named)
            return f"A cheque's payments are approved together, so they must be at the same step: {steps}."
    if any((t.payment_status or "").strip() == STATUS_APPROVED for t in lines if t.line.payment_name):
        return _approved_cheque_problem(header, lines)
    return None


def _approved_cheque_problem(header: ChequeHeader, lines: Sequence[TrackerLine]) -> str | None:
    """Approved payments issue their cheque at once, so it must already meet the approval conditions
    (`approval_problem`): every line names a payment and the lines add up to the cheque amount."""
    for n, tracker in enumerate(lines, 1):
        if not tracker.line.payment_name:
            return (
                f"Line {n} has no payment yet, but the cheque's payments are Approved, so it is Issued at once. "
                "Pick that line's payment, or take the line off."
            )
    return approval_problem(
        cheque_no=header.cheque_no or "",
        amount=header.amount,
        lines=[ApprovalLine(payment=t.line.payment_name, record=t.line.record_name, amount=t.line.amount)
               for t in lines],
    )
