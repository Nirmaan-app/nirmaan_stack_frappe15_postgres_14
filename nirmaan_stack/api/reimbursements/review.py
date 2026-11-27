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

Bulk (ADR-0040 Amendment C, point 5): `bulk_approve_reimbursements` / `bulk_reject_reimbursements` run the SAME
per-claim steps (`_approve`, `_reject`) as the single calls, each claim in its own savepoint, so one claim and a
hundred can't land differently, and one refused claim never takes the batch with it. The ceiling is Payments'
(`bulk_actions.MAX_BATCH_SIZE`). The later steps (L1, CEO, Mark as Paid, reconcile) act on the claim's expense and
go through Payments' `api/approvals/expense_actions.decide_expenses`, which already takes a batch.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint

from nirmaan_stack.api.payments.bulk_actions import MAX_BATCH_SIZE
from nirmaan_stack.api.reimbursements.claims import as_list
from nirmaan_stack.integrations.controllers.reimbursement_notify import notify_decided
from nirmaan_stack.services.expense_decision import is_l1
from nirmaan_stack.services.reimbursements.access import claim_decide_problem, is_hr
from nirmaan_stack.services.reimbursements.convert import create_expense
from nirmaan_stack.services.reimbursements.expense_link import lock_claim
from nirmaan_stack.services.reimbursements.month_total import month_totals
from nirmaan_stack.services.reimbursements.rules import (
    APPROVED,
    PENDING,
    REJECTED,
    acknowledgement_problem,
    approval_needs_l1,
    claim_tab,
    decide_problem,
    rejection_problem,
    reviewer_for,
)
from nirmaan_stack.services.role_profiles import REIMBURSEMENT_HR_PROFILES, is_developer, is_nirmaan_admin

DOCTYPE = "Reimbursement"


def _locked_for_decision(name: str, user: str):
    claim = lock_claim(name)
    problem = claim_decide_problem(claim, user)
    if problem:
        frappe.throw(_(problem), frappe.ValidationError if claim.status != PENDING else frappe.PermissionError)
    return claim


def _approve(name: str, user: str, acknowledged: bool):
    """Approve one claim as `user`, without committing: lock it, check who may, read the month total inside the
    lock, and create its expense. Returns `(claim, expense)`. The single and the bulk call both run this."""
    claim = _locked_for_decision(name, user)
    total = month_totals([claim.name])[claim.name]["month_total"]
    problem = acknowledgement_problem(total, acknowledged)
    if problem:
        frappe.throw(_(problem))
    # Saved Approved first: the expense's routing reads the claim's approver. Creating the expense then copies its
    # starting status onto the claim (`expense_link.follow_expense`): Requested, CEO Pending, or Approved as it is.
    claim.status = APPROVED
    claim.approved_by = user
    claim.save(ignore_permissions=True)
    expense = create_expense(claim, user, needs_l1=approval_needs_l1(total, decider_is_l1=is_l1(user)))
    claim.reload()
    return claim, expense


def _reject(name: str, user: str, reason: str):
    """Reject one claim as `user`, without committing. `reason` was checked by the caller."""
    claim = _locked_for_decision(name, user)
    claim.status = REJECTED
    claim.rejection_reason = reason.strip()
    claim.save(ignore_permissions=True)
    return claim


def _approved_reply(claim, expense) -> dict:
    return {"name": claim.name, "status": claim.status, "expense": expense.name, "expense_status": expense.status,
            "tab": claim_tab(claim.status)}


def _check_reason(reason) -> None:
    problem = rejection_problem(reason)
    if problem:
        frappe.throw(_(problem))


@frappe.whitelist(methods=["POST"])
def approve_reimbursement(name, acknowledged=None) -> dict:
    """Approve the full amount. Saves `approved_by` and creates the claim's Non-Project Expense, whose
    starting status follows the expense rule with this approver as the raiser; the claimant is notified.

    `acknowledged`: the approver ticked the monthly-limit warning. Refused without it when the claimant's month
    total has reached the limit, worked out again here inside the claim's lock. An HR approval at or above the limit
    leaves the expense waiting for L1 (`rules.approval_needs_l1`). The reply's `tab` is the Reimbursements tab
    the claim now sits in (`rules.claim_tab`)."""
    claim, expense = _approve(name, frappe.session.user, cint(acknowledged) == 1)
    frappe.db.commit()
    notify_decided(claim, APPROVED)
    return _approved_reply(claim, expense)


@frappe.whitelist(methods=["POST"])
def reject_reimbursement(name, reason) -> dict:
    """Reject with a reason (required, shown to the claimant). Final."""
    _check_reason(reason)
    claim = _reject(name, frappe.session.user, reason)
    frappe.db.commit()
    notify_decided(claim, REJECTED)
    return {"name": claim.name, "status": claim.status}


@frappe.whitelist(methods=["POST"])
def bulk_approve_reimbursements(names, acknowledged=None) -> dict:
    """Approve each named Pending claim as the caller (at most `MAX_BATCH_SIZE`). Partial failure is normal.

    `acknowledged`: the approver confirmed the bulk dialog, which shows each person's month total (as Payments'
    bulk box does, with no tick of its own). Without it, a claim whose claimant has reached the monthly limit is
    refused, exactly as the single call refuses it. Claims are decided in name order, so the same person's second
    claim counts the first one approved just before it, as approving them one by one would.

    Returns `{message, data: {succeeded, failed: [{name, reason}], results: {name: {status, expense,
    expense_status, tab}}, total}}`; `tab` is where each claim landed, which the screen shows rather than guesses.
    """
    user = frappe.session.user
    ack = cint(acknowledged) == 1
    return _bulk(names, lambda name: _approved_reply(*_approve(name, user, ack)), APPROVED, "approved")


@frappe.whitelist(methods=["POST"])
def bulk_reject_reimbursements(names, reason) -> dict:
    """Reject each named Pending claim as the caller with ONE reason for all (at most `MAX_BATCH_SIZE`). The
    reason is checked once, before any claim is touched. Same reply as `bulk_approve_reimbursements`."""
    _check_reason(reason)
    user = frappe.session.user

    def reject(name):
        claim = _reject(name, user, reason)
        return {"name": claim.name, "status": claim.status, "tab": claim_tab(claim.status)}

    return _bulk(names, reject, REJECTED, "rejected")


def _batch(names) -> list[str]:
    """The claim names of one bulk call: unique, sorted, and no more than `MAX_BATCH_SIZE`.

    Sorted so two bulk calls lock their claims in the same order and can't deadlock."""
    wanted = sorted(set(as_list(names)))
    if not wanted:
        frappe.throw(_("Pick at least one claim."))
    if len(wanted) > MAX_BATCH_SIZE:
        frappe.throw(_("Limited to {0} claims at a time.").format(MAX_BATCH_SIZE))
    return wanted


def _bulk(names, decide, decision: str, verb: str) -> dict:
    """Run `decide(name)` for each claim of the batch in its own savepoint, commit once, then notify the claimants
    whose claims went through. `decide` returns the claim's reply row."""
    wanted = _batch(names)
    succeeded: list[str] = []
    failed: list[dict] = []
    results: dict[str, dict] = {}
    for name in wanted:
        # ⚠️ NOT TIDINESS: on Postgres a caught exception around a write leaves the whole transaction aborted, and
        # the commit below would silently roll back every claim while the call returns 200 (as `decide_expenses`).
        savepoint = f"reimb_decide_{frappe.generate_hash(length=12)}"
        frappe.db.savepoint(savepoint)
        try:
            results[name] = decide(name)
        except Exception as exc:
            frappe.db.rollback(save_point=savepoint)
            frappe.clear_messages()
            failed.append({"name": name, "reason": str(exc) or "Unknown error"})
            if not isinstance(exc, (frappe.ValidationError, frappe.PermissionError, frappe.DoesNotExistError)):
                frappe.log_error(title=f"Reimbursement bulk {verb} error ({name})", message=frappe.get_traceback())
            continue
        frappe.db.release_savepoint(savepoint)
        succeeded.append(name)
    frappe.db.commit()

    # After the commit, one by one: `notify_decided` logs its own failures, so one can't undo a decision.
    for name in succeeded:
        notify_decided(frappe.get_doc(DOCTYPE, name), decision)

    return {
        "message": _("{0} of {1} claims {2}.").format(len(succeeded), len(wanted), verb),
        "data": {"succeeded": succeeded, "failed": failed, "results": results, "total": len(wanted)},
    }


@frappe.whitelist()
def get_pending_for_me() -> list[dict]:
    """Every pending claim, newest first, for the people who decide claims (HR and Admin); empty for anyone
    else. Each row says whether THIS person may decide it (`can_decide`) and, when not, why
    (`cannot_decide_reason`): HR sees every pending claim but decides only those raised outside HR (owner,
    2026-10-22; any amount since 2026-10-28); the screen disables Approve / Reject on the rest. One query, then
    the same `decide_problem` the endpoints enforce.
    """
    user = frappe.session.user
    decider_is_admin = is_nirmaan_admin(user) or is_developer(user)
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
