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
also needs L1, on the Reimbursements page's Pending L1 Approval tab (`approval_needs_l1`; ADR-0040 Amendment C). An approval at or above it is confirmed with a tick
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

from nirmaan_stack.services.expense_statuses import (
    EXPENSE_APPROVED,
    EXPENSE_CEO_PENDING,
    EXPENSE_RECONCILIATION_PENDING,
    EXPENSE_REQUESTED,
)
from nirmaan_stack.services.outflow_import.amounts import rupees

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


def delete_problem(status: str, *, is_claimant: bool, is_admin: bool = False) -> str | None:
    """Why this person may not delete the claim, or None when they may: the claimant, while it is pending or
    once it is rejected (owner, 2026-10-27); an Admin, anyone's claim once it is rejected (owner, 2026-11-19). A claim
    rejected in Payments takes its Rejected expense with it (`expense_link`); an Approved or Paid claim goes only when
    its expense is deleted."""
    if is_claimant:
        if status not in (PENDING, REJECTED):
            return f"This claim is {status}, so it can't be deleted."
        return None
    if not is_admin:
        return "Only the person who raised a claim, or an Admin once it is rejected, can delete it."
    if status != REJECTED:
        return f"This claim is {status}: an Admin can delete someone else's claim only once it is rejected."
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


#: A Project Manager's MONTHLY CAP (₹; owner, 2026-11-18): the claims they raise in one calendar month may add up to
#: this and no more. Exactly ₹2,000 is allowed. Unlike `MONTHLY_LIMIT` (a warning to the approver) it is a block, at
#: raise and at edit. It counts the claims that may still be paid -- Pending Approval, Approved and Paid -- so several
#: claims raised at once can't each slip under it; a rejected (or deleted) claim frees its amount.
PM_MONTHLY_CAP = 2000
PM_CAP_COUNTED = (PENDING, APPROVED, PAID)


def cap_left(month_used: float) -> float:
    """What a Project Manager may still claim this month, never below ₹0."""
    return max(0.0, round(PM_MONTHLY_CAP - month_used, 2))


def cap_problem(month_used: float, amount, *, capped: bool) -> str | None:
    """Why this claim of `amount` would take a capped claimant (a Project Manager) above `PM_MONTHLY_CAP`, or None.

    `month_used`: their other counted claims raised in the claim's month (`PM_CAP_COUNTED`), the claim itself left
    out (an edit replaces its own old amount)."""
    if not capped:
        return None
    try:
        value = float(amount)
    except (TypeError, ValueError):
        return None  # `claim_problem` names a bad amount
    if round(month_used + value, 2) <= PM_MONTHLY_CAP:
        return None
    cap = rupees(PM_MONTHLY_CAP)
    left = cap_left(month_used)
    if left <= 0:
        return f"You have used this month's {cap}. Project Managers can claim up to {cap} a month."
    return f"You can claim up to {rupees(left)} more this month. Project Managers can claim up to {cap} a month."


def rejection_problem(reason: str | None) -> str | None:
    """Why a rejection can't be saved, or None: a reason is required."""
    if not (reason or "").strip():
        return "Write a reason. The person who raised the claim sees it."
    return None


# --- The Reimbursements page's tabs (owner, 2026-11-18, ADR-0040 Amendment C) ---------------------------------
#
# Every step of a claim has its own tab. The claim keeps its four statuses (owner: "use the old statuses only"),
# so an Approved claim's tab is read from its Non-Project Expense's status. No field or status was added for it.
# The ids are kept from the earlier tabs where the tab survives ("approved" = Payment need to be paid), so a
# bookmarked `?tab=` still opens it; "rejected" is gone (its claims are in All).

TAB_PENDING = "pending"                 # Pending Approval: the claim is Pending Approval
TAB_L1 = "l1"                           # Pending L1 Approval: the expense is Requested
TAB_CEO = "ceo"                         # Pending CEO Approval: the expense is CEO Pending; the CEO only
TAB_APPROVED = "approved"               # Payment need to be paid: the expense is Approved
TAB_RECONCILIATION = "reconciliation"   # Reconciliation Pending: the expense is Reconciliation Pending
TAB_PAID = "paid"                       # Paid: the claim is Paid
TAB_MINE = "mine"                       # Reimbursement Raised By Me: the person's own claims
TAB_ALL = "all"                         # All: every claim, Rejected included

#: The tabs a claim moves through, in order. Each claim is in at most one of them; a Rejected claim is in none.
STAGE_TABS = (TAB_PENDING, TAB_L1, TAB_CEO, TAB_APPROVED, TAB_RECONCILIATION, TAB_PAID)
#: Every tab the list call answers.
TABS = STAGE_TABS + (TAB_MINE, TAB_ALL)

#: An Approved claim's tab, by its expense's status.
TAB_OF_EXPENSE_STATUS = {
    EXPENSE_REQUESTED: TAB_L1,
    EXPENSE_CEO_PENDING: TAB_CEO,
    EXPENSE_APPROVED: TAB_APPROVED,
    EXPENSE_RECONCILIATION_PENDING: TAB_RECONCILIATION,
}
#: The other way round: which expense status an expense-led tab lists.
EXPENSE_STATUS_OF_TAB = {tab: status for status, tab in TAB_OF_EXPENSE_STATUS.items()}


def claim_tab(claim_status: str | None, expense_status: str | None) -> str | None:
    """The one step tab a claim is in, or None when it is in none (Rejected, or an Approved claim whose expense
    is missing or Rejected -- a state the hooks never leave, shown only in All rather than guessed at)."""
    if claim_status == PENDING:
        return TAB_PENDING
    if claim_status == PAID:
        return TAB_PAID
    if claim_status == APPROVED:
        return TAB_OF_EXPENSE_STATUS.get(expense_status or "")
    return None


def tab_problem(tab: str | None, *, viewer_is_ceo: bool) -> str | None:
    """Why this person may not list `tab`, or None. Pending CEO Approval is the CEO's alone (owner, 2026-11-18);
    every other tab is open to anyone, the claims in it being scoped by who may read them."""
    if tab not in TABS:
        return f"There is no Reimbursements tab called {tab!r}."
    if tab == TAB_CEO and not viewer_is_ceo:
        return "Only the CEO sees Pending CEO Approval."
    return None


def count_tabs(rows, *, viewer_is_ceo: bool) -> dict[str, int]:
    """Each tab's badge from grouped rows of `{claim_status, expense_status, mine, n}` (the claims the person may
    read). A badge is the number of rows the tab shows (owner, 2026-11-18). The CEO's tab is left out for anyone
    else, so its count is never sent to them."""
    counts = {tab: 0 for tab in TABS}
    for row in rows:
        n = int(row.get("n") or 0)
        counts[TAB_ALL] += n
        if row.get("mine"):
            counts[TAB_MINE] += n
        tab = claim_tab(row.get("claim_status"), row.get("expense_status"))
        if tab:
            counts[tab] += n
    if not viewer_is_ceo:
        counts.pop(TAB_CEO)
    return counts
