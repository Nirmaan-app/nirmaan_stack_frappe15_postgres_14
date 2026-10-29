# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Reimbursement rules that need no database (ADR-0010 B1).

Who decides a claim (owner, 2026-10-21/22; amended 2026-10-28, ADR-0040 Amendment B):

* HR (HR Executive or HR Lead) decides a claim of any amount whose claimant is not in HR. An HR person's own
  claim is therefore never HR's to decide.
* Admin decides every claim, every claim raised by someone in HR included, and may decide their own.
* Approval is for the full amount; a rejection is final and needs a reason.

How far an approval goes is the MONTHLY REIMBURSEMENT LIMIT (owner, 2026-10-28): ₹2,000 (`MONTHLY_LIMIT`) of month
total; only a total UNDER it is within the limit, so exactly ₹2,000 already needs L1 (owner, 2026-10-28) -- the claim plus the claimant's other Approved and Paid claims raised in the same
calendar month (`month_total.py`). Under it, HR's approval finishes the claim; at or above it, a claim HR approves
also needs L1 in Payments (`approval_needs_l1`). An approval at or above it is confirmed with a tick
(`acknowledgement_problem`); it is a warning, never a block.

A claim above ₹2,000 (`DESCRIPTION_REQUIRED_ABOVE`) needs a description (owner, 2026-10-22). Every claim has a
type: Travel, Food or Others (`TYPES`, owner, 2026-10-22).

The claimant may edit a claim only while it is Pending Approval, and delete it while it is Pending Approval or
Rejected (owner, 2026-10-27): a claim rejected in Payments takes its Rejected expense with it. An Approved or Paid
claim is locked; it goes only when its Non-Project Expense is deleted.

Approval creates the claim's Non-Project Expense (`convert.py`, ADR-0040). The claim then follows only that
expense's endings: Paid, or Rejected in the Payments queue (`expense_link.py`); nothing else sets Paid.

Mirrored on the screen by `frontend/src/utils/reimbursements/rules.ts`; both twins read
`reimbursement_rules_cases.json` (F1), so they cannot drift apart unnoticed.
"""

from __future__ import annotations

PENDING = "Pending Approval"
APPROVED = "Approved"
REJECTED = "Rejected"
#: Set only when the claim's Non-Project Expense turns Paid (`expense_link.follow_expense`).
PAID = "Paid"

#: The status options, in the doctype's order. Pinned to the doctype by test.
STATUSES = (PENDING, APPROVED, REJECTED, PAID)

#: What a claim was spent on, in the doctype's order. Pinned to the doctype's options by test.
TYPES = ("Travel", "Food", "Others")

#: The monthly reimbursement limit (₹) on a claimant's month total. A total of exactly ₹2,000 has reached it (owner,
#: 2026-10-28): only a total below it is within the limit.
MONTHLY_LIMIT = 2000

#: A claim above this amount (₹) needs a description. Exactly ₹2,000 does not.
DESCRIPTION_REQUIRED_ABOVE = 2000

#: Who a pending claim waits for.
REVIEWER_ADMIN = "Admin"
REVIEWER_HR_OR_ADMIN = "HR or Admin"


def reviewer_for(*, claimant_is_hr: bool) -> str:
    """Who decides a claim raised by this claimant: `REVIEWER_ADMIN` or `REVIEWER_HR_OR_ADMIN`."""
    return REVIEWER_ADMIN if claimant_is_hr else REVIEWER_HR_OR_ADMIN


def decide_problem(
    status: str,
    *,
    claimant_is_hr: bool,
    decider_is_admin: bool,
    decider_is_hr: bool,
) -> str | None:
    """Why this person may not approve or reject the claim, or None when they may.

    `decider_is_admin` wins over `decider_is_hr`. Nobody in HR decides an HR claim, which covers an HR
    person's own claim; an Admin may decide their own.
    """
    if status != PENDING:
        return f"This claim is {status}, so it can no longer be approved or rejected."
    if decider_is_admin:
        return None
    if not decider_is_hr:
        return "Only HR or Admin can approve or reject reimbursements."
    if claimant_is_hr:
        return "A claim raised by someone in HR is approved by Admin."
    return None


def over_monthly_limit(month_total: float) -> bool:
    """True when a claimant's month total has reached `MONTHLY_LIMIT`: ₹2,000 or more. Exactly ₹2,000 counts."""
    return month_total >= MONTHLY_LIMIT


def approval_needs_l1(month_total: float, *, decider_is_l1: bool) -> bool:
    """Whether approving now leaves the claim's expense waiting for L1 in Payments: an approval by someone who
    is not L1 (HR) when the month total has reached the limit. An L1's approval (Admin, the CEO) is the L1 step."""
    return not decider_is_l1 and over_monthly_limit(month_total)


def acknowledgement_problem(month_total: float, acknowledged: bool) -> str | None:
    """Why an approval can't go ahead, or None: at or above the limit the approver must have confirmed the warning."""
    if over_monthly_limit(month_total) and not acknowledged:
        return (f"This person's reimbursements this month come to ₹{month_total:,.0f}, at or above the "
                f"₹{MONTHLY_LIMIT:,} monthly limit. Tick the box to confirm, then approve.")
    return None


def edit_problem(status: str, *, is_claimant: bool) -> str | None:
    """Why this person may not edit the claim, or None when they may: the claimant, while it is pending."""
    if not is_claimant:
        return "Only the person who raised a claim can edit it."
    if status != PENDING:
        return f"This claim is {status}, so it can no longer be edited."
    return None


def delete_problem(status: str, *, is_claimant: bool) -> str | None:
    """Why this person may not delete the claim, or None when they may: the claimant, while it is pending or
    once it is rejected (owner, 2026-10-27). A claim rejected in Payments takes its Rejected expense with it
    (`expense_link`); an Approved or Paid claim goes only when its expense is deleted."""
    if not is_claimant:
        return "Only the person who raised a claim can delete it."
    if status not in (PENDING, REJECTED):
        return f"This claim is {status}, so it can't be deleted."
    return None


def description_required(amount: float) -> bool:
    """True when a claim of `amount` needs a description: above `DESCRIPTION_REQUIRED_ABOVE`."""
    return amount > DESCRIPTION_REQUIRED_ABOVE


def claim_problem(title: str | None, amount, receipt_count: int, description: str | None = None,
                  reimbursement_type: str | None = None) -> str | None:
    """Why a claim as entered can't be saved, or None. The receipts are counted after any removed on edit."""
    if reimbursement_type not in TYPES:
        return "Pick the type of claim: Travel, Food or Others."
    if not (title or "").strip():
        return "Enter a title."
    try:
        value = float(amount)
    except (TypeError, ValueError):
        return "Enter the amount in rupees."
    if value <= 0:
        return "Enter an amount above ₹0."
    if description_required(value) and not (description or "").strip():
        return f"Add a description. It's needed for a claim above ₹{DESCRIPTION_REQUIRED_ABOVE:,}."
    if receipt_count < 1:
        return "Attach at least one receipt."
    return None


def rejection_problem(reason: str | None) -> str | None:
    """Why a rejection can't be saved, or None: a reason is required."""
    if not (reason or "").strip():
        return "Write a reason. The person who raised the claim sees it."
    return None
