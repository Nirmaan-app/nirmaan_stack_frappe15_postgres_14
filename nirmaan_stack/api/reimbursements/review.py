# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Approve or reject a Reimbursement, and the Pending Approval queue.

HR decides a claim of any amount raised outside HR; Admin decides every claim and may decide their own
(`services/reimbursements/rules.py`). Each decision locks the claim and reads its status again inside the
lock, so two people can't decide one claim, and an edit can't slip in between (CODING_STANDARDS § Status
transitions). Approving also creates the claim's Non-Project Expense in the same transaction (ADR-0040,
`services/reimbursements/convert.py`), so a claim is never Approved without one. The claimant is notified
after the commit.

Approving reads the claimant's month total inside the lock (ADR-0040 Amendment B, `services/reimbursements/
month_total.py`): at or above the monthly limit it needs `acknowledged` (the screen's tick), and an HR approval there
leaves the expense waiting for L1.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint

from nirmaan_stack.integrations.controllers.reimbursement_notify import notify_decided
from nirmaan_stack.services.expense_decision import is_l1
from nirmaan_stack.services.reimbursements.access import claim_decide_problem, is_hr
from nirmaan_stack.services.reimbursements.convert import create_expense
from nirmaan_stack.services.reimbursements.month_total import month_totals
from nirmaan_stack.services.reimbursements.rules import (
    APPROVED,
    PENDING,
    REJECTED,
    acknowledgement_problem,
    approval_needs_l1,
    decide_problem,
    rejection_problem,
    reviewer_for,
)
from nirmaan_stack.services.role_profiles import REIMBURSEMENT_HR_PROFILES, is_nirmaan_admin

DOCTYPE = "Reimbursement"


def _locked_for_decision(name: str, user: str):
    claim = frappe.get_doc(DOCTYPE, name, for_update=True)
    problem = claim_decide_problem(claim, user)
    if problem:
        frappe.throw(_(problem), frappe.ValidationError if claim.status != PENDING else frappe.PermissionError)
    return claim


@frappe.whitelist(methods=["POST"])
def approve_reimbursement(name, acknowledged=None) -> dict:
    """Approve the full amount. Saves `approved_by` and creates the claim's Non-Project Expense, whose
    starting status follows the expense rule with this approver as the raiser; the claimant is notified.

    `acknowledged`: the approver ticked the monthly-limit warning. Refused without it when the claimant's month
    total has reached the limit, worked out again here inside the claim's lock. An HR approval at or above the limit
    leaves the expense waiting for L1 (`rules.approval_needs_l1`)."""
    user = frappe.session.user
    claim = _locked_for_decision(name, user)
    total = month_totals([claim.name])[claim.name]["month_total"]
    problem = acknowledgement_problem(total, cint(acknowledged) == 1)
    if problem:
        frappe.throw(_(problem))
    claim.status = APPROVED
    claim.approved_by = user
    claim.save(ignore_permissions=True)
    expense = create_expense(claim, user, needs_l1=approval_needs_l1(total, decider_is_l1=is_l1(user)))
    frappe.db.commit()
    notify_decided(claim, APPROVED)
    return {"name": claim.name, "status": claim.status, "expense": expense.name, "expense_status": expense.status}


@frappe.whitelist(methods=["POST"])
def reject_reimbursement(name, reason) -> dict:
    """Reject with a reason (required, shown to the claimant). Final."""
    problem = rejection_problem(reason)
    if problem:
        frappe.throw(_(problem))
    user = frappe.session.user
    claim = _locked_for_decision(name, user)
    claim.status = REJECTED
    claim.rejection_reason = reason.strip()
    claim.save(ignore_permissions=True)
    frappe.db.commit()
    notify_decided(claim, REJECTED)
    return {"name": claim.name, "status": claim.status}


@frappe.whitelist()
def get_pending_for_me() -> list[dict]:
    """Every pending claim, newest first, for the people who decide claims (HR and Admin); empty for anyone
    else. Each row says whether THIS person may decide it (`can_decide`) and, when not, why
    (`cannot_decide_reason`): HR sees every pending claim but decides only those raised outside HR (owner,
    2026-10-22; any amount since 2026-10-28); the screen disables Approve / Reject on the rest. One query, then
    the same `decide_problem` the endpoints enforce.
    """
    user = frappe.session.user
    decider_is_admin = is_nirmaan_admin(user)
    decider_is_hr = is_hr(user)
    if not (decider_is_admin or decider_is_hr):
        return []
    rows = frappe.db.sql(
        """
        SELECT r.name, r.title, r.description, r.amount, r.status, r.owner, r.creation,
               r.pay_to_account_name, r.pay_to_account_number, r.pay_to_ifsc, r.pay_to_bank_name,
               r.pay_to_bank_branch, r.attachment,
               COALESCE(r.claimant_name, nu.full_name) AS claimant_name,
               COALESCE(r.claimant_role, nu.role_profile) AS claimant_role
        FROM "tabReimbursement" r
        LEFT JOIN "tabNirmaan Users" nu ON nu.name = r.owner
        WHERE r.status = %(pending)s
        ORDER BY r.creation DESC
        """,
        {"pending": PENDING},
        as_dict=True,
    )
    for row in rows:
        # The role saved on the claim when it was raised (`access.claimant_is_hr`), or the person's role now
        # for a claim saved before that field existed.
        claimant_is_hr = row.claimant_role in REIMBURSEMENT_HR_PROFILES
        problem = decide_problem(row.status, claimant_is_hr=claimant_is_hr,
                                 decider_is_admin=decider_is_admin, decider_is_hr=decider_is_hr)
        row["can_decide"] = problem is None
        row["cannot_decide_reason"] = problem
        row["reviewer"] = reviewer_for(claimant_is_hr=claimant_is_hr)
        row["is_own"] = row.owner == user
    return rows
