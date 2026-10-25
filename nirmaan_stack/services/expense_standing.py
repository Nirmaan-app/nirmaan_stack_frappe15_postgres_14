# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""What a raiser sees of where their expense stands (spec #1494, ticket #1500). Pure: no database.

    live_status(request_status, expense_status)   the one status label the Expenses list and the
                                                  request page show for a request.
    where_it_stands(request, expense, raiser)     the request page's steps, in order: Raised ->
                                                  Review (or Approved on submit) -> Admin approval
                                                  if needed -> CEO approval if needed -> Payment
                                                  (labelled Paid once done).

Each step is `{key, label, state, by, on, note}`; `state` is done / current / upcoming / rejected.
A rejected step is the last one shown. A step not needed is left out, so a small expense reads
Raised -> Reviewed -> Paid.

WHICH STEPS ARE NEEDED. Once the Expense exists its own record answers: `auto_approved` means no
approval step at all (the auto band stamps both dates, so the stamps alone cannot say it), the
approval stamps say what was cleared, and its status says what waits. Before it exists the steps
ahead are a PROJECTION from the request's amount and the raiser's own level (`approval_tiers`, the
same rule the Expense will be born under); the Admin step then carries the spec's rule that an
Admin's review is the L1 step.
"""

from __future__ import annotations

from collections.abc import Mapping

from nirmaan_stack.services.approval_tiers import (
    TIER_AUTO,
    TIER_L2_ABOVE_EXPENSES,
    needs_ceo,
    required_tier,
    steps_cleared_by_raiser,
)
from nirmaan_stack.services.expense_statuses import (
    EXPENSE_APPROVED,
    EXPENSE_CEO_PENDING,
    EXPENSE_PAID,
    EXPENSE_RECONCILIATION_PENDING,
    EXPENSE_REJECTED,
    EXPENSE_REQUESTED,
    REQUEST_PENDING,
    REQUEST_REJECTED,
)

DONE, CURRENT, UPCOMING, STEP_REJECTED = "done", "current", "upcoming", "rejected"

# The Expense's statuses, as the raiser reads them. "Requested" on an Expense means it waits for
# an Admin; the other names read plainly as they are.
LIVE_LABELS = {
    EXPENSE_REQUESTED: "Waiting for Admin",
    EXPENSE_CEO_PENDING: "CEO Pending",
    EXPENSE_APPROVED: "Approved",
    EXPENSE_RECONCILIATION_PENDING: "Reconciliation Pending",
    EXPENSE_PAID: "Paid",
    EXPENSE_REJECTED: "Rejected",
}


def live_status(request_status: str | None, expense_status: str | None) -> str:
    """The Expense's status once there is one; until then the request's own (Pending Approval,
    or Rejected at review)."""
    if expense_status:
        return LIVE_LABELS.get(expense_status, expense_status)
    return request_status or ""


def _step(key, label, state, by=None, on=None, note=None) -> dict:
    return {"key": key, "label": label, "state": state, "by": by, "on": on, "note": note}


def where_it_stands(request: Mapping, expense: Mapping | None, level: str | None) -> list[dict]:
    """The steps of one request, from raising it to its Expense being paid.

    `level` is the approval level the Expense is born under (`expense_decision.approval_level`: the
    raiser's own, or L1 when an L1 reviewed it). The steps it clears are `approval_tiers`'
    `steps_cleared_by_raiser` -- the rule `expense_decision.starting_status` applies -- and a step
    cleared that way is not shown as a separate approval: it was never asked of anyone.
    """
    steps = [_step("raised", "Raised", DONE, by=request.get("owner"), on=request.get("creation"))]
    steps.append(_review_step(request, expense))
    if steps[-1]["state"] == STEP_REJECTED:
        return steps
    l1_held, ceo_held = steps_cleared_by_raiser(request.get("amount"), TIER_L2_ABOVE_EXPENSES, level)
    if expense:
        approvals = _approval_steps(expense, l1_held=l1_held, ceo_held=ceo_held)
    else:
        approvals = _approvals_ahead(request.get("amount"), l1_held=l1_held, ceo_held=ceo_held)
    for step in approvals:
        steps.append(step)
        if step["state"] == STEP_REJECTED:
            return steps
    steps.append(_paid_step(expense))
    return steps


def _review_step(request: Mapping, expense: Mapping | None) -> dict:
    status = request.get("status")
    by, on = request.get("reviewed_by"), request.get("reviewed_on")
    if request.get("approved_on_submit"):
        # The raiser records without review (#1498): no Reviewer, approved the moment it was raised.
        return _step("review", "Approved on submit (no review)", DONE, on=request.get("creation"))
    if status == REQUEST_PENDING:
        return _step("review", "Review", CURRENT, note="Waiting for a Reviewer")
    if status == REQUEST_REJECTED and not expense:
        return _step("review", "Review", STEP_REJECTED, by=by, on=on, note=request.get("review_comment"))
    return _step("review", "Reviewed", DONE, by=by, on=on)


def _approvals_ahead(amount, l1_held: bool, ceo_held: bool) -> list[dict]:
    """Before the Expense exists: the approvals its amount will need, less the steps already held."""
    ahead = []
    if required_tier(amount, TIER_L2_ABOVE_EXPENSES) != TIER_AUTO and not l1_held:
        ahead.append(_step("admin", "Admin approval", UPCOMING, note="Not needed when an Admin reviews it"))
    if needs_ceo(amount, TIER_L2_ABOVE_EXPENSES) and not ceo_held:
        ahead.append(_step("ceo", "CEO approval", UPCOMING))
    return ahead


def _approval_steps(expense: Mapping, l1_held: bool = False, ceo_held: bool = False) -> list[dict]:
    """Once the Expense exists: the approvals it needed, as its stamps and status record them.

    A cleared step the raiser or reviewer already held (`l1_held`, `ceo_held`) is left out.

    A reject names its step by the L1 stamp: with no L1 date it was the Admin's, with one it was
    the CEO's (L1 approves only up to the CEO line, so a rejected row past L1 waited for the CEO).
    """
    if expense.get("auto_approved"):
        return []
    status = expense.get("status")
    amount = expense.get("amount")
    l1_on, ceo_on = expense.get("approval_date"), expense.get("ceo_approval_date")
    needs_l1 = (status == EXPENSE_REQUESTED or bool(l1_on)
                or required_tier(amount, TIER_L2_ABOVE_EXPENSES) != TIER_AUTO)
    needs_l2 = status == EXPENSE_CEO_PENDING or bool(ceo_on) or needs_ceo(amount, TIER_L2_ABOVE_EXPENSES)

    steps = []
    if needs_l1:
        if status == EXPENSE_REQUESTED:
            steps.append(_step("admin", "Admin approval", CURRENT, note="Waiting for an Admin"))
        elif status == EXPENSE_REJECTED and not l1_on:
            return [_step("admin", "Admin approval", STEP_REJECTED, note="Rejected by an Admin")]
        elif not l1_held:
            steps.append(_step("admin", "Admin approval", DONE, on=l1_on))
    if needs_l2:
        if status == EXPENSE_CEO_PENDING:
            steps.append(_step("ceo", "CEO approval", CURRENT, note="Waiting for the CEO"))
        elif status == EXPENSE_REJECTED:
            steps.append(_step("ceo", "CEO approval", STEP_REJECTED, note="Rejected by the CEO"))
        elif status == EXPENSE_REQUESTED:
            steps.append(_step("ceo", "CEO approval", UPCOMING))
        elif not ceo_held:
            steps.append(_step("ceo", "CEO approval", DONE, on=ceo_on))
    return steps


def _paid_step(expense: Mapping | None) -> dict:
    status = expense.get("status") if expense else None
    if status == EXPENSE_PAID:
        return _step("paid", "Paid", DONE, on=expense.get("payment_date"))
    if status == EXPENSE_APPROVED:
        return _step("paid", "Payment", CURRENT, note="Waiting for Accounts to pay")
    if status == EXPENSE_RECONCILIATION_PENDING:
        return _step("paid", "Payment", CURRENT, note="Paid out; waiting for the bank statement to confirm it")
    return _step("paid", "Payment", UPCOMING)
