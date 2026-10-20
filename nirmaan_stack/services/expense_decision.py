# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Every status an Expense takes is decided here (spec #1494, seam 2; ADR-0016, 2026-10-19 amendment).

An Expense is a `Project Expenses` or a `Non Project Expenses` row. This module has two doors:

    starting_status(amount, raised_by, reviewed_by=None)
                                        the status a NEW row is born at: the amount rule plus the
                                        Raiser's own step, where an L1 reviewer's review of the
                                        Expense Request counts as the L1 step (#1499). Both ledgers'
                                        `validate` apply it through `apply_starting_status`;
                                        `convert.target_status` previews it.
    decide(doctype, name, action, user, reason=None, payment=None)
                                        one status change on an existing row. It locks the row,
                                        refuses a from-status the action does not expect and a user
                                        the action does not admit, saves, and returns the new status.
                                        Its one caller is `api/approvals/expense_actions.decide_expenses`.

THE ACTIONS

    action        from                              who               to
    l1_approve    Requested                         L1                Approved, or CEO Pending above Rs 50,000
    ceo_approve   CEO Pending                       the CEO           Approved
    reject        Requested / CEO Pending           L1 / the CEO      Rejected (a reason is required)
    mark_done     Approved                          Admin, Accounts   Reconciliation Pending ("Mark as Done")
    mark_paid     Approved / Reconciliation Pending Admin, Accounts   Paid (payment date, reference and receipt required)

WHO IS L1: `is_l1` -- `Administrator` or the Admin profile (the CEO is an Admin too). Accountants are
not L1, whatever the payments queue admits. The amount rule itself stays in `approval_tiers` (pure).

The bank-line rules in `integrations/controllers/expense_bank_links.validate` still run on the save
and have the last word: an expense its bank lines settle takes the status they derive.
"""

from __future__ import annotations

from dataclasses import dataclass

import frappe
from frappe import _
from frappe.utils import flt, nowdate

from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER
from nirmaan_stack.services.approval_raiser import expense_raiser, expense_reviewer, raiser_level
from nirmaan_stack.services.approval_tiers import (
    RAISER_L1,
    STATUS_APPROVED,
    STATUS_CEO_PENDING,
    STATUS_REQUESTED,
    TIER_L2_ABOVE_EXPENSES,
    initial_status_for_raiser,
    is_auto_approved,
    status_after_l1,
    steps_cleared_by_raiser,
)
from nirmaan_stack.services.caller_transaction import EXPENSE_DECIDING
from nirmaan_stack.services.ceo_hold.core import CEO_HOLD_STATUS
from nirmaan_stack.services.expense_statuses import EXPENSE_REJECTED
from nirmaan_stack.services.outflow_import.ledgers import (
    EXPENSE_DOCTYPES,
    PAID,
    PROJECT_EXPENSE_DOCTYPE,
    RECONCILIATION_PENDING,
)
from nirmaan_stack.services.role_profiles import (
    ACCOUNTANT_LEAD_PROFILE,
    ACCOUNTANT_PROFILE,
    PAYMENT_SETTLE_PROFILES,
    has_role_profile,
)

L1_APPROVE = "l1_approve"
CEO_APPROVE = "ceo_approve"
REJECT = "reject"
MARK_DONE = "mark_done"
MARK_PAID = "mark_paid"
ACTIONS = (L1_APPROVE, CEO_APPROVE, REJECT, MARK_DONE, MARK_PAID)

# The statuses each action may start from. Anything else is refused, naming what was found.
FROM_STATUSES = {
    L1_APPROVE: (STATUS_REQUESTED,),
    CEO_APPROVE: (STATUS_CEO_PENDING,),
    REJECT: (STATUS_REQUESTED, STATUS_CEO_PENDING),
    MARK_DONE: (STATUS_APPROVED,),
    MARK_PAID: (STATUS_APPROVED, RECONCILIATION_PENDING),
}

# What Mark as Paid must end up holding. A value passed in `payment` replaces the stored one.
PAYMENT_FIELDS = ("payment_date", "payment_ref", "payment_attachment")
# The invoice details Mark as Paid may save in the same write (the pay dialog's invoice). A field
# passed replaces the stored one, a blank one clears it; a field left out keeps it.
INVOICE_FIELDS = ("invoice_date", "invoice_ref", "invoice_attachment")

# ── Who may act ─────────────────────────────────────────────────────────────────────────────

def is_l1(user: str | None) -> bool:
    """The one answer to "who is L1": `Administrator` or the Admin profile (the CEO included)."""
    return raiser_level(user) is not None


def approval_level(raised_by: str | None, reviewed_by: str | None = None) -> str | None:
    """The level an Expense is born under: the raiser's own (`approval_raiser.raiser_level`), else L1
    when an L1 reviewed its request -- an Admin's review IS the L1 step (ADR-0016, 2026-10-19
    amendment 3). A review clears L1 only, even the CEO's. `starting_status` and the request page's
    "Where it stands" (`expense_standing.where_it_stands`) both read it."""
    return raiser_level(raised_by) or (RAISER_L1 if is_l1(reviewed_by) else None)


def is_ceo(user: str | None) -> bool:
    return bool(user) and user == CEO_AUTHORIZED_USER


def can_mark_paid(user: str | None) -> bool:
    """Mark as Done and Mark as Paid: `Administrator`, Admin, Accountant and Accountant Lead."""
    return bool(user) and has_role_profile(user, PAYMENT_SETTLE_PROFILES)


# ── A new row ───────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class StartingStatus:
    status: str
    auto_approved: bool
    l1_done: bool
    ceo_done: bool


def starting_status(amount, raised_by: str | None, reviewed_by: str | None = None) -> StartingStatus:
    """Where a new Expense of `amount`, raised by `raised_by`, is born.

    Under Rs 15,000 it is auto-approved (both steps stamped, `auto_approved`). Otherwise the
    level already held clears the steps it holds (Raiser's own step), and those steps are dated
    like a person's approval -- not `auto_approved`. Everyone else is born at Requested.

    `reviewed_by` is the Reviewer of the Expense Request the row is born from. An L1 reviewer's
    review IS the L1 step (ADR-0016, 2026-10-19 amendment 3), so the row lands as it would for an
    L1 raiser: Approved up to Rs 50,000, CEO Pending above it. An HR or Accounts review clears
    nothing. A review clears L1 only, even the CEO's: the CEO step is the CEO's own approval.
    """
    value = flt(amount)
    if is_auto_approved(value):
        return StartingStatus(STATUS_APPROVED, auto_approved=True, l1_done=True, ceo_done=True)
    level = approval_level(raised_by, reviewed_by)
    l1_done, ceo_done = steps_cleared_by_raiser(value, TIER_L2_ABOVE_EXPENSES, level)
    return StartingStatus(
        initial_status_for_raiser(value, TIER_L2_ABOVE_EXPENSES, level),
        auto_approved=False,
        l1_done=l1_done,
        ceo_done=ceo_done,
    )


def apply_starting_status(doc) -> None:
    """Both ledgers' `validate`: set a new row's status and its approval stamps.

    Create-time only, and only while the status is still the default `Requested`, so an explicit
    status (an import's Paid row) is kept and a later edit never re-routes a row. The raiser is
    `approval_raiser.expense_raiser`: the Expense Request's owner, never the reviewer who inserted it.
    The reviewer is the request's `reviewed_by` (`approval_raiser.expense_reviewer`).
    """
    if not doc.is_new():
        return
    if doc.status and doc.status != STATUS_REQUESTED:
        return
    start = starting_status(doc.amount, expense_raiser(doc), expense_reviewer(doc))
    doc.status = start.status
    if start.auto_approved:
        doc.auto_approved = 1
    if start.l1_done:
        doc.approval_date = nowdate()
    if start.ceo_done:
        doc.ceo_approval_date = nowdate()


# ── What a person may write ─────────────────────────────────────────────────────────────────

# Who edits an Expense by hand, and in which statuses (story 50, owner 2026-10-20): Accounts only,
# and only until it is paid. A Rejected one is closed too. `Administrator` is not let past.
EDIT_PROFILES = (ACCOUNTANT_PROFILE, ACCOUNTANT_LEAD_PROFILE)
EDITABLE_STATUSES = (STATUS_REQUESTED, STATUS_CEO_PENDING, STATUS_APPROVED, RECONCILIATION_PENDING)


def editable_statuses(user: str | None) -> list[str]:
    """The statuses in which `user` may edit an Expense by hand: none, or `EDITABLE_STATUSES` for
    Accounts. Served to the old ledger pages, so their Edit buttons show the server's answer."""
    if user and has_role_profile(user, EDIT_PROFILES, superuser_passes=False):
        return list(EDITABLE_STATUSES)
    return []


def guard_hand_save(doc) -> None:
    """Both ledgers' `validate`, FIRST: the rules for a save a person makes through a document door.

    Every human door -- Desk, the REST resource API, `frappe.client`, bulk edit, data import --
    saves with the caller's permissions checked. Every system writer saves with
    `ignore_permissions=True`: `decide`, the request intake and its Add invoice, the bank-statement
    settle and its unreconcile, the cashbook and Porter creates, the PO adjustment, Change account.
    So a permission-checked save is a person's, and these hold for it, `Administrator` included:

      * it may not change the status, nor insert a row at any status but `Requested` (story 42):
        statuses move only through `decide`;
      * it may not edit a Paid or Rejected Expense at all, and only Accounts may edit any other
        (`editable_statuses`, story 50).

    The bank-line re-derive runs after this, so an edit that moves a settled amount still moves the
    status it derives.
    """
    if doc.flags.ignore_permissions:
        return
    if doc.is_new():
        hand_set = (doc.status or STATUS_REQUESTED) != STATUS_REQUESTED
    else:
        hand_set = doc.has_value_changed("status")
    if hand_set:
        frappe.throw(
            _("An expense's status is set by the server. Use Approve, Reject, Mark as Done or Mark as Paid."),
            title=_("Status is not editable"),
        )
    if doc.is_new():
        return
    stored = (doc.get_doc_before_save() or doc).status
    if stored not in EDITABLE_STATUSES:
        frappe.throw(_("{0} is {1}; a {2} expense can no longer be edited.").format(
            doc.name, stored, (stored or "closed").lower()), title=_("Expense is closed"))
    if not editable_statuses(frappe.session.user):
        frappe.throw(_("Only Accounts edit an expense once it is raised."), frappe.PermissionError,
                     title=_("Not yours to edit"))


# ── A change to an existing row ─────────────────────────────────────────────────────────────

def decide(doctype: str, name: str, action: str, user: str, reason: str | None = None,
           payment: dict | None = None, invoice: dict | None = None) -> str:
    """Apply `action` to one Expense as `user`; return the status it now has.

    Raises `frappe.ValidationError` (wrong ledger, action or status, missing reason or payment
    detail, project on CEO Hold) or `frappe.PermissionError` (a user the action does not admit).
    Never commits: the caller owns the transaction.
    """
    if doctype not in EXPENSE_DOCTYPES:
        frappe.throw(_("{0} is not an expense ledger.").format(doctype))
    if action not in ACTIONS:
        frappe.throw(_("Unknown expense action '{0}'.").format(action))
    if action == REJECT and not (reason or "").strip():
        frappe.throw(_("A rejection needs a reason."))

    doc = frappe.get_doc(doctype, name, for_update=True)
    status = (doc.status or "").strip()
    if status not in FROM_STATUSES[action]:
        frappe.throw(_("{0} is {1}; it can be changed this way only from {2}.").format(
            name, status or "blank", " or ".join(FROM_STATUSES[action])))
    _check_user(action, status, user)
    if action in (L1_APPROVE, CEO_APPROVE, REJECT):
        _check_not_on_ceo_hold(doc)

    if action == L1_APPROVE:
        doc.status = status_after_l1(flt(doc.amount), TIER_L2_ABOVE_EXPENSES)
        doc.approval_date = nowdate()
    elif action == CEO_APPROVE:
        doc.status = STATUS_APPROVED
        doc.ceo_approval_date = nowdate()
    elif action == REJECT:
        doc.status = EXPENSE_REJECTED
    elif action == MARK_DONE:
        doc.status = RECONCILIATION_PENDING
    else:
        _record_payment(doc, payment or {}, user)
        _record_invoice(doc, invoice or {})
        doc.status = PAID

    # Inside the caller's per-row savepoint: hooks leave the commit to it (`caller_transaction`).
    frappe.flags[EXPENSE_DECIDING] = True
    try:
        doc.save(ignore_permissions=True)
    finally:
        frappe.flags[EXPENSE_DECIDING] = False
    return doc.status


def _check_user(action: str, status: str, user: str) -> None:
    if action in (MARK_DONE, MARK_PAID):
        allowed, who = can_mark_paid(user), _("Admin or Accounts")
    elif status == STATUS_CEO_PENDING:
        allowed, who = is_ceo(user), _("the CEO")
    else:
        allowed, who = is_l1(user), _("an Admin (Accountants are not first-level approvers)")
    if not allowed:
        frappe.throw(_("Only {0} can do this to an expense at {1}.").format(who, status), frappe.PermissionError)


def _check_not_on_ceo_hold(doc) -> None:
    project = doc.get("projects") if doc.doctype == PROJECT_EXPENSE_DOCTYPE else None
    if project and frappe.db.get_value("Projects", project, "status") == CEO_HOLD_STATUS:
        frappe.throw(_("Project {0} is on CEO Hold.").format(project))


def _record_payment(doc, payment: dict, user: str) -> None:
    for field in PAYMENT_FIELDS:
        value = payment.get(field)
        if isinstance(value, str):
            value = value.strip()
        if value:
            doc.set(field, value)
    missing = [doc.meta.get_label(f) for f in PAYMENT_FIELDS if not doc.get(f)]
    if missing:
        frappe.throw(_("Mark as Paid needs: {0}.").format(", ".join(missing)))
    if doc.meta.has_field("payment_by") and not doc.get("payment_by"):
        doc.payment_by = user


def _record_invoice(doc, invoice: dict) -> None:
    for field in INVOICE_FIELDS:
        if field in invoice:
            value = invoice[field]
            doc.set(field, (value.strip() if isinstance(value, str) else value) or None)
