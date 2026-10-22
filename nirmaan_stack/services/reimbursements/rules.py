# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Reimbursement rules that need no database (ADR-0010 B1).

Who decides a claim (owner, 2026-10-21/22):

* HR (HR Executive or HR Lead) decides a claim of ₹2,000 or less (`HR_APPROVAL_LIMIT`, inclusive) whose
  claimant is not in HR. An HR person's own claim is therefore never HR's to decide.
* Admin decides everything else -- above ₹2,000, and every claim raised by someone in HR -- and may
  decide their own claim.
* Approval is for the full amount; a rejection is final and needs a reason.

A claim above ₹2,000 (`DESCRIPTION_REQUIRED_ABOVE`) needs a description (owner, 2026-10-22). Every claim has a
type: Travel, Food or Others (`TYPES`, owner, 2026-10-22).

The claimant may edit a claim only while it is Pending Approval, and delete it while it is Pending
Approval or Rejected. An Approved claim is locked.

Mirrored on the screen by `frontend/src/utils/reimbursements/rules.ts`; both twins read
`reimbursement_rules_cases.json` (F1), so they cannot drift apart unnoticed.
"""

from __future__ import annotations

PENDING = "Pending Approval"
APPROVED = "Approved"
REJECTED = "Rejected"

#: The status options, in the doctype's order. Pinned to the doctype by test.
STATUSES = (PENDING, APPROVED, REJECTED)

#: What a claim was spent on, in the doctype's order. Pinned to the doctype's options by test.
TYPES = ("Travel", "Food", "Others")

#: HR may decide a claim of this amount or less (₹). Inclusive: exactly ₹2,000 is HR's.
HR_APPROVAL_LIMIT = 2000

#: A claim above this amount (₹) needs a description. Exactly ₹2,000 does not.
DESCRIPTION_REQUIRED_ABOVE = 2000

#: Who a pending claim waits for.
REVIEWER_ADMIN = "Admin"
REVIEWER_HR_OR_ADMIN = "HR or Admin"


def reviewer_for(amount: float, *, claimant_is_hr: bool) -> str:
    """Who decides a claim of `amount` raised by this claimant: `REVIEWER_ADMIN` or `REVIEWER_HR_OR_ADMIN`."""
    if claimant_is_hr or amount > HR_APPROVAL_LIMIT:
        return REVIEWER_ADMIN
    return REVIEWER_HR_OR_ADMIN


def decide_problem(
    status: str,
    amount: float,
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
    if amount > HR_APPROVAL_LIMIT:
        return f"A claim above ₹{HR_APPROVAL_LIMIT:,} is approved by Admin."
    return None


def edit_problem(status: str, *, is_claimant: bool) -> str | None:
    """Why this person may not edit the claim, or None when they may: the claimant, while it is pending."""
    if not is_claimant:
        return "Only the person who raised a claim can edit it."
    if status != PENDING:
        return f"This claim is {status}, so it can no longer be edited."
    return None


def delete_problem(status: str, *, is_claimant: bool) -> str | None:
    """Why this person may not delete the claim, or None when they may: the claimant, while it is pending
    or after it was rejected."""
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
