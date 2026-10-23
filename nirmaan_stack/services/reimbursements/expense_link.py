# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A claim and the Non-Project Expense created from it (ADR-0040): the claim follows the expense's endings,
and the two are deleted together.

Owner rulings, 2026-10-23:

* The claim stays Approved while its expense is Requested, CEO Pending, Approved or Reconciliation Pending.
  Expense Paid -> claim Paid. Expense Rejected (in the Payments queue) -> claim Rejected, with the reason
  typed there. An undone bank match (Paid -> back) puts the claim back to Approved.
* Everything else on the expense may be edited and never touches the claim -- except that Rejected is FINAL
  (owner, 2026-10-23): a rejected expense can't be moved to any other status. To pay it after all, delete it
  (which deletes the claim) and the person raises a new reimbursement. So a claim never sits Rejected while
  its expense is paid (code review finding 3).
* Deleting the expense, in any status, deletes the claim and its receipts -- the way deleting a request's
  expense deletes the Expense Request (owner, 2026-10-23, replacing "only a Rejected one"). Frappe's own
  delete permission and the bank-link guard still decide whether the expense may be deleted at all.
* The claimant deletes their claim only while it is Pending Approval or Rejected (`rules.delete_problem`). A
  claim Rejected in Payments takes its expense with it, but only while that expense is still Rejected: one
  revived afterwards is live money, so the claim's delete is refused instead.
* No notification on any of these (owner, 2026-10-23).

The claim is written with `doc.save` (a Version row, the claim's own `validate`), never `set_value`.
"""

from __future__ import annotations

import frappe
from frappe import _

from nirmaan_stack.api.approvals.expense_actions import FALLBACK_REJECTION_REASON as FALLBACK_REASON
from nirmaan_stack.api.approvals.expense_actions import REJECTION_REASON_FLAG
from nirmaan_stack.api.payments.bulk_actions import REJECTED_STATUS as EXPENSE_REJECTED
from nirmaan_stack.services.notification_links import delete_notifications_for
from nirmaan_stack.services.outflow_import.ledgers import NON_PROJECT_EXPENSE_DOCTYPE
from nirmaan_stack.services.outflow_import.ledgers import PAID as EXPENSE_PAID
from nirmaan_stack.services.reimbursements.convert import APPROVAL_FLAG, LINK_FIELD
from nirmaan_stack.services.reimbursements.receipts import detach_claim_files
from nirmaan_stack.services.reimbursements.rules import APPROVED, PAID, REJECTED

CLAIM_DOCTYPE = "Reimbursement"


#: Set while one side of a pair deletes the other, so the other side's hook doesn't delete it back.
_DELETING_FLAG = "reimbursement_pair_deleting"


def link_problem(is_new: bool, previous: str | None, current: str | None, from_approval: bool,
                 other_expense: str | None = None) -> str | None:
    """Why this save's `reimbursement` link is not allowed, or None. Pure.

    The link is what moves, pays and deletes a claim, so only the approval step may set it (`from_approval`,
    a server-side flag), it never changes afterwards, and a claim has one expense (code review, 2026-10-23:
    a link typed in through REST / Desk / Duplicate could skip approval, delete or pay someone else's claim,
    or pay a claim twice).
    """
    if is_new:
        if not current:
            return None
        if not from_approval:
            return "The reimbursement link is set only when a claim is approved. Remove it to save this expense."
        if other_expense:
            return f"Reimbursement {current} already has its expense {other_expense}."
        return None
    if (previous or None) != (current or None):
        return "The reimbursement this expense pays can't be changed or removed."
    return None


def guard_link(expense) -> None:
    """Expense `validate`: refuse a `reimbursement` link the approval step didn't set (see `link_problem`)."""
    current = expense.get(LINK_FIELD) or None
    is_new = expense.is_new()
    previous = None
    other = None
    if is_new:
        if current:
            other = frappe.db.get_value(
                NON_PROJECT_EXPENSE_DOCTYPE, {LINK_FIELD: current, "name": ["!=", expense.name or ""]}, "name"
            )
    else:
        before = expense.get_doc_before_save()
        previous = before.get(LINK_FIELD) if before else frappe.db.get_value(
            NON_PROJECT_EXPENSE_DOCTYPE, expense.name, LINK_FIELD
        )
    problem = link_problem(is_new, previous, current, bool(expense.flags.get(APPROVAL_FLAG)), other)
    if problem:
        frappe.throw(_(problem))


def revival_problem(previous_status: str | None, new_status: str | None) -> str | None:
    """Why a reimbursement's expense can't move from `previous_status` to `new_status`, or None. Pure.

    Rejected is final: the claim was rejected with it, and reviving only the expense would pay a rejected claim.
    """
    if previous_status == EXPENSE_REJECTED and new_status != EXPENSE_REJECTED:
        return ("This expense pays a reimbursement that was rejected, and a rejection is final. Delete it (that "
                "deletes the claim too) and ask the person to raise a new reimbursement.")
    return None


def refuse_revival(expense) -> None:
    """Expense `validate`: a reimbursement's Rejected expense keeps that status."""
    if expense.is_new() or not expense.get(LINK_FIELD):
        return
    before = expense.get_doc_before_save()
    problem = revival_problem(before.status if before else None, expense.status)
    if problem:
        frappe.throw(_(problem))


def claim_status_for(expense_status: str, previous_status: str | None, claim_status: str) -> str | None:
    """The status a claim moves to when its expense goes `previous_status` -> `expense_status`, or None.

    Pure. Only the endings move a claim, and only from the status it can be in at that point.
    """
    if expense_status == previous_status:
        return None
    if expense_status == EXPENSE_PAID:
        return PAID if claim_status == APPROVED else None
    if expense_status == EXPENSE_REJECTED:
        return REJECTED if claim_status == APPROVED else None
    if previous_status == EXPENSE_PAID:
        # An undone bank match: the money is no longer recorded as gone.
        return APPROVED if claim_status == PAID else None
    return None


def follow_expense(expense) -> None:
    """Expense `on_update`: carry Paid / Rejected / un-Paid onto the claim. Rides the expense's transaction."""
    claim_name = expense.get(LINK_FIELD)
    if not claim_name or not expense.has_value_changed("status"):
        return
    before = expense.get_doc_before_save()
    previous = before.status if before else None
    # Only an ending (Paid / Rejected) or leaving Paid can move a claim: skip the lock and the load otherwise
    # (every L1 approval and Reconciliation Pending move of these expenses lands here).
    if expense.status not in (EXPENSE_PAID, EXPENSE_REJECTED) and previous != EXPENSE_PAID:
        return
    claim = frappe.get_doc(CLAIM_DOCTYPE, claim_name, for_update=True)
    target = claim_status_for(expense.status, previous, claim.status)
    if not target:
        return
    claim.status = target
    if target == REJECTED:
        claim.rejection_reason = (expense.flags.get(REJECTION_REASON_FLAG) or "").strip() or FALLBACK_REASON
    claim.save(ignore_permissions=True, ignore_version=False)


def delete_claim(claim_name: str) -> list[str]:
    """Delete a claim mid-transaction and return its receipt Files, already detached, for the caller to delete
    LAST, after its commit (`services/stored_files.delete_files`)."""
    files = detach_claim_files(claim_name)
    delete_notifications_for(CLAIM_DOCTYPE, claim_name)  # else Frappe's link check refuses the delete
    frappe.delete_doc(CLAIM_DOCTYPE, claim_name, ignore_permissions=True)
    return files


def refuse_claimant_delete(expense) -> None:
    """Expense `on_trash`: the person who raised the claim deletes it only while it is Pending or Rejected (owner,
    2026-10-23), so they can't delete their own claim's expense unless it is Rejected -- that delete would take an
    Approved or Paid claim and its receipts with it, around the claim's own rule. Accounts and Admin, deleting
    someone else's, are not stopped (deleting the expense deletes the claim, as an Expense Request's does)."""
    claim_name = expense.get(LINK_FIELD)
    if not claim_name or expense.status == EXPENSE_REJECTED or frappe.flags.get(_DELETING_FLAG) == claim_name:
        return
    if frappe.session.user == frappe.db.get_value(CLAIM_DOCTYPE, claim_name, "owner"):
        frappe.throw(_("{0} pays your own reimbursement {1}, so you can't delete it while it is {2}.").format(
            expense.name, claim_name, expense.status))


def delete_with_expense(expense) -> None:
    """Expense `after_delete`: the expense is gone, so its claim goes too. The receipts are deleted after the
    commit."""
    claim_name = expense.get(LINK_FIELD)
    if not claim_name or frappe.flags.get(_DELETING_FLAG) == claim_name:
        return
    if not frappe.db.exists(CLAIM_DOCTYPE, claim_name):
        return
    files = delete_claim(claim_name)
    if files:
        frappe.db.after_commit.add(lambda: _delete_files_now(claim_name, files))


def _delete_files_now(claim_name: str, files: list[str]) -> None:
    """After the commit that deleted the claim: its receipts, through the shared-bytes-safe delete.

    ⚠️ Two guards (code review, 2026-10-23). A rollback to a savepoint does NOT clear `after_commit`, so a delete
    undone that way would still queue this: if the claim is back, its receipts are left alone. And the commit has
    already happened, so a storage error here is logged, never raised -- the person's delete did succeed. The
    callback is dequeued before it runs, so committing here can't re-run it.
    """
    from nirmaan_stack.services.stored_files import delete_files

    try:
        if frappe.db.exists(CLAIM_DOCTYPE, claim_name):
            return
        delete_files({"name": ["in", files]})
        frappe.db.commit()
    except Exception:
        frappe.db.rollback()
        frappe.log_error(frappe.get_traceback(), f"Reimbursement {claim_name}: receipt files not deleted")


def delete_expense_problem(claim_name: str, expense: dict | None) -> str | None:
    """Why a claimant may not delete this claim because of its `expense` (`{name, status}`, or None), or None.

    An expense that is not Rejected is live money, and deleting the claim would delete it. Since Rejected is final
    (`refuse_revival`) this guards only rows that got past that rule (older rows, a raw write).
    """
    if expense and expense.status != EXPENSE_REJECTED:
        return (f"{claim_name} can't be deleted: its expense {expense.name} is {expense.status} in Project "
                "Payments. Ask Accounts to delete or reject that expense.")
    return None


def delete_expense_of(claim_name: str) -> None:
    """Before a claimant deletes their claim: delete its expense first (it links to the claim), refusing one that
    is not Rejected (`delete_expense_problem`). Its own `after_delete` leaves the claim to the caller."""
    expense = frappe.db.get_value(
        NON_PROJECT_EXPENSE_DOCTYPE, {LINK_FIELD: claim_name}, ["name", "status"], as_dict=True
    )
    problem = delete_expense_problem(claim_name, expense)
    if problem:
        frappe.throw(_(problem))
    if not expense:
        return
    previous = frappe.flags.get(_DELETING_FLAG)
    frappe.flags[_DELETING_FLAG] = claim_name
    try:
        frappe.delete_doc(NON_PROJECT_EXPENSE_DOCTYPE, expense.name, ignore_permissions=True)
    finally:
        frappe.flags[_DELETING_FLAG] = previous
