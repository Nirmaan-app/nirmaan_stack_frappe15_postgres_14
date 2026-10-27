# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Which approval level the person RAISING a payment or expense holds (owner, 2026-09-21).

The pure rule -- what that level clears -- is `approval_tiers.initial_status_for_raiser` /
`steps_cleared_by_raiser`. This module only answers "who is this user", which needs the database.

    the CEO (`CEO_AUTHORIZED_USER`)             -> RAISER_CEO   (clears L1 and L2)
    `Administrator`, or the Admin role profile  -> RAISER_L1    (clears L1)
    anyone else                                 -> None         (the normal path)

L1 is exactly the set the "Payment Pending Approval" tab lets approve (`canApprovePayments`).
Accountants are not L1, for this rule or any other payment step (`services/payment_steps.py`, #1530).
"""

import frappe

from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER
from nirmaan_stack.services.approval_tiers import RAISER_CEO, RAISER_L1
from nirmaan_stack.services.role_profiles import ADMIN_PROFILE


def raiser_level(user: str | None) -> str | None:
    if not user:
        return None
    if user == CEO_AUTHORIZED_USER:
        return RAISER_CEO
    if user == "Administrator":
        return RAISER_L1
    if frappe.db.get_value("Nirmaan Users", user, "role_profile") == ADMIN_PROFILE:
        return RAISER_L1
    return None


def expense_raiser(doc) -> str | None:
    """Who raised an expense ledger row.

    The request's owner when there is one. A row born from an Expense Request is inserted by the
    REVIEWER who approved that request; `expense_requests.convert.create_ledger_row` hands its
    `owner` to the request's owner only after the insert, so while the row's own `validate` runs
    (where this decides the approval path), and on rows made before that, `owner` is the reviewer.
    """
    request_id = doc.get("request_id")
    if request_id:
        owner = frappe.db.get_value("Expense Request", request_id, "owner")
        if owner:
            return owner
    return doc.get("owner") or frappe.session.user


def expense_reviewer(doc) -> str | None:
    """Who reviewed the Expense Request an expense ledger row was born from, if anyone.

    Read from the request's `reviewed_by`, so `review.approve_expense_request` saves that BEFORE it
    inserts the row. None for a row with no request.
    """
    request_id = doc.get("request_id")
    if not request_id:
        return None
    return frappe.db.get_value("Expense Request", request_id, "reviewed_by") or None


#: Set by `reimbursements.convert.create_expense` on the one insert allowed to carry `reimbursement`. Read here (to
#: route by the claim's approver) and by `reimbursements.expense_link.guard_link`. A server-side doc flag: no client
#: can set it. One constant for both, so they can't drift apart (code review, 2026-10-23).
REIMBURSEMENT_APPROVAL_FLAG = "from_reimbursement_approval"


def routing_raiser(doc) -> str | None:
    """Whose level decides a NEW expense row's approval path (`expense_decision.apply_starting_status`).

    `expense_raiser` for every row, except one created from an approved Reimbursement (ADR-0040): there it is
    the person who APPROVED the claim, so a step they already hold is not asked again (HR's claims fall in the
    auto band; an Admin's approval clears L1; the CEO's clears both). `expense_raiser` itself still answers
    "who raised it" with the claimant, who is the row's owner.
    """
    claim = doc.get("reimbursement")
    # Only on the insert the approval step itself makes (`convert.APPROVAL_FLAG`, a server-side flag): a
    # `reimbursement` typed into any other insert must never lend it the claim approver's level (code review,
    # 2026-10-23). `expense_link.guard_link` refuses such an insert anyway; this keeps routing safe on its own.
    if claim and doc.flags.get(REIMBURSEMENT_APPROVAL_FLAG):
        approver = frappe.db.get_value("Reimbursement", claim, "approved_by")
        if approver:
            return approver
    return expense_raiser(doc)
