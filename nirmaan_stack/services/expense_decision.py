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
from frappe.model import no_value_fields
from frappe.utils import flt, getdate, nowdate

from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER
from nirmaan_stack.services.approval_raiser import expense_reviewer, raiser_level, routing_raiser, routing_skips_auto
from nirmaan_stack.services.approval_tiers import (
    RAISER_L1,
    TIER_L2_ABOVE_EXPENSES,
    initial_status_for_raiser,
    is_auto_approved,
    status_after_l1,
    steps_cleared_by_raiser,
)
from nirmaan_stack.services.caller_transaction import EXPENSE_DECIDING
from nirmaan_stack.services.ceo_hold.core import CEO_HOLD_STATUS
from nirmaan_stack.services.expense_statuses import (
    EXPENSE_APPROVED,
    EXPENSE_CEO_PENDING,
    EXPENSE_PAID,
    EXPENSE_RECONCILIATION_PENDING,
    EXPENSE_REJECTED,
    EXPENSE_REQUESTED,
)
from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES, PROJECT_EXPENSE_DOCTYPE
from nirmaan_stack.services.payees.pay_to import PAY_TO_FIELDS
from nirmaan_stack.services.role_profiles import (
    ACCOUNTANT_LEAD_PROFILE,
    ACCOUNTANT_PROFILE,
    ADMIN_PROFILE,
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
    L1_APPROVE: (EXPENSE_REQUESTED,),
    CEO_APPROVE: (EXPENSE_CEO_PENDING,),
    REJECT: (EXPENSE_REQUESTED, EXPENSE_CEO_PENDING),
    MARK_DONE: (EXPENSE_APPROVED,),
    MARK_PAID: (EXPENSE_APPROVED, EXPENSE_RECONCILIATION_PENDING),
}

#: Where a reject puts its reason for the ledger row's own hooks, which carry it to the Reimbursement
#: (`reimbursements.expense_link.follow_expense`, ADR-0040) in the same save.
REJECTION_REASON_FLAG = "rejection_reason"
#: What those hooks write when a row reaches Rejected with no reason on it (a Desk or REST edit).
FALLBACK_REJECTION_REASON = "Rejected in Payments."

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


def starting_status(amount, raised_by: str | None, reviewed_by: str | None = None, *,
                    skip_auto: bool = False) -> StartingStatus:
    """Where a new Expense of `amount`, raised by `raised_by`, is born.

    Under Rs 15,000 it is auto-approved (both steps stamped, `auto_approved`). Otherwise the
    level already held clears the steps it holds (Raiser's own step), and those steps are dated
    like a person's approval -- not `auto_approved`. Everyone else is born at Requested.

    `reviewed_by` is the Reviewer of the Expense Request the row is born from. An L1 reviewer's
    review IS the L1 step (ADR-0016, 2026-10-19 amendment 3), so the row lands as it would for an
    L1 raiser: Approved up to Rs 50,000, CEO Pending above it. An HR or Accounts review clears
    nothing. A review clears L1 only, even the CEO's: the CEO step is the CEO's own approval.

    `skip_auto` takes the auto band away: an amount under Rs 15,000 is born at Requested and waits for L1. Only a
    reimbursement HR approved above the monthly limit asks for it (`approval_raiser.routing_skips_auto`, ADR-0040
    Amendment B). Above the auto band it changes nothing.
    """
    value = flt(amount)
    if is_auto_approved(value):
        if skip_auto:
            return StartingStatus(EXPENSE_REQUESTED, auto_approved=False, l1_done=False, ceo_done=False)
        return StartingStatus(EXPENSE_APPROVED, auto_approved=True, l1_done=True, ceo_done=True)
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
    `approval_raiser.routing_raiser`: the Expense Request's owner, never the reviewer who inserted it,
    or for a row created from an approved Reimbursement the person who approved the claim (ADR-0040).
    The reviewer is the request's `reviewed_by` (`approval_raiser.expense_reviewer`). A reimbursement HR approved
    above the monthly limit skips the auto band (`approval_raiser.routing_skips_auto`, ADR-0040 Amendment B).
    """
    if not doc.is_new():
        return
    if doc.status and doc.status != EXPENSE_REQUESTED:
        return
    start = starting_status(doc.amount, routing_raiser(doc), expense_reviewer(doc), skip_auto=routing_skips_auto(doc))
    doc.status = start.status
    if start.auto_approved:
        doc.auto_approved = 1
    if start.l1_done:
        doc.approval_date = nowdate()
    if start.ceo_done:
        doc.ceo_approval_date = nowdate()


# ── What a person may write ─────────────────────────────────────────────────────────────────

# Who edits an Expense by hand, in which statuses, and which fields (story 50, owner 2026-10-20):
#   * until it is paid, Accounts edit every field but the status; `Administrator` is not let past;
#   * from Reconciliation Pending, the pay-to account is locked for everyone (`LOCKED_FIELDS`):
#     it says where the money went (ADR-0033, Amendment A);
#   * once Paid, Admin (`Administrator` included) and the Accountant Lead correct its details
#     (`PAID_EDITABLE_FIELDS`) and nothing else: the payment information stays as it was paid;
#   * a Rejected one is closed to everyone.
EDIT_PROFILES = (ACCOUNTANT_PROFILE, ACCOUNTANT_LEAD_PROFILE)
EDITABLE_STATUSES = (EXPENSE_REQUESTED, EXPENSE_CEO_PENDING, EXPENSE_APPROVED, EXPENSE_RECONCILIATION_PENDING)
PAID_EDIT_PROFILES = (ADMIN_PROFILE, ACCOUNTANT_LEAD_PROFILE)
# `projects` and `vendor` exist on Project Expenses only. A changed `type` still meets the ledger
# check (`expense_type_ledger.check_expense_type`).
PAID_EDITABLE_FIELDS = ("description", "comment", "invoice_attachment", "invoice_ref", "invoice_date",
                        "projects", "vendor", "type")
# Per status, the fields no hand edit changes, whoever makes it. Paid's limit already leaves them out.
LOCKED_FIELDS: dict[str, tuple[str, ...]] = {EXPENSE_RECONCILIATION_PENDING: PAY_TO_FIELDS}


def edit_access(user: str | None) -> dict[str, tuple[str, ...] | None]:
    """What `user` may edit by hand: `{status: fields}`, where `fields` is None for every field but
    the status, else the only fields an edit may change. A status left out is not editable.
    `LOCKED_FIELDS` narrows any status further, for every user."""
    access: dict[str, tuple[str, ...] | None] = {}
    if not user:
        return access
    if has_role_profile(user, EDIT_PROFILES, superuser_passes=False):
        access.update(dict.fromkeys(EDITABLE_STATUSES))
    if has_role_profile(user, PAID_EDIT_PROFILES):
        access[EXPENSE_PAID] = PAID_EDITABLE_FIELDS
    return access


def _changed_fields(doc) -> list[str]:
    """The fields of `doc` this save changes (a blank and an empty value are the same)."""
    before = doc.get_doc_before_save()
    if before is None:
        return []
    return [df.fieldname for df in doc.meta.fields
            if df.fieldtype not in no_value_fields
            and (before.get(df.fieldname) or doc.get(df.fieldname))
            and doc.has_value_changed(df.fieldname)]


def guard_hand_save(doc) -> None:
    """Both ledgers' `validate`, FIRST: the rules for a save a person makes through a document door.

    Every human door -- Desk, the REST resource API, `frappe.client`, bulk edit, data import --
    saves with the caller's permissions checked, and these hold for it, `Administrator` included:

      * it may not change the status, nor insert a row at any status but `Requested` (story 42):
        statuses move only through `decide`;
      * it may edit only what `edit_access` grants the person (story 50): Accounts an Expense not
        yet paid, but not its pay-to account from Reconciliation Pending (`LOCKED_FIELDS`); Admin
        and the Accountant Lead a Paid one's details, never its payment; nobody a Rejected one
        (`assert_may_edit`).

    A save with `ignore_permissions=True` is trusted, and only these make one:
      * system writers, which move no field a person chose: `decide`, the request intake, the
        bank-statement settle and its unreconcile, the cashbook and Porter creates, the PO adjustment;
      * two person-facing endpoints, each asking its own rule before it saves: Change account
        (`services/payees/expense_payee.change_expense_account` asks `assert_may_edit` for the
        `pay_to_*` fields) and the raiser's Add invoice (`save_raiser_invoice`, story 15's carve-out:
        the invoice fields only, until Paid); and the Payment Done tab's Upload / Edit Inv
        (`save_paid_invoice`, owner 2026-10-31: the invoice fields only, once Paid).
    A new person-facing endpoint that saves an Expense elevated must ask `assert_may_edit` too.

    The bank-line re-derive runs after this, so an edit that moves a settled amount still moves the
    status it derives.
    """
    if doc.flags.ignore_permissions:
        return
    if doc.is_new():
        hand_set = (doc.status or EXPENSE_REQUESTED) != EXPENSE_REQUESTED
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
    assert_may_edit(doc, stored, frappe.session.user, _changed_fields(doc))


def assert_may_edit(doc, stored: str | None, user: str | None, fields) -> None:
    """Refuse `user` changing `fields` of Expense `doc`, stored at status `stored`, unless
    `edit_access` grants it: `frappe.PermissionError` when the row is not theirs to edit at that
    status, `frappe.ValidationError` when it is closed or a field is locked (a Paid row's payment, a
    Reconciliation Pending row's pay-to account: `LOCKED_FIELDS`)."""
    if stored not in (*EDITABLE_STATUSES, EXPENSE_PAID):
        frappe.throw(_("{0} is {1}; a {2} expense can no longer be edited.").format(
            doc.name, stored, (stored or "closed").lower()), title=_("Expense is closed"))
    access = edit_access(user)
    if stored not in access:
        frappe.throw(_("Only an Admin or the Accountant Lead edits a paid expense.") if stored == EXPENSE_PAID
                     else _("Only Accounts edit an expense once it is raised."),
                     frappe.PermissionError, title=_("Not yours to edit"))
    allowed = access[stored]
    always_locked = LOCKED_FIELDS.get(stored, ())
    locked = [f for f in fields if (allowed is not None and f not in allowed) or f in always_locked]
    if locked:
        frappe.throw(_("{0} is {1}; its {2} can no longer be changed.").format(
            doc.name, stored, ", ".join(_(doc.meta.get_label(f)) for f in locked)), title=_("Payment is locked"))


def save_raiser_invoice(doctype: str, name: str, invoice: dict) -> None:
    """Story 15's carve-out from `edit_access`: the raiser of an Expense Request (or an Admin) adds
    its invoice later, until the Expense is Paid (`api/expense_requests/invoice.add_request_invoice`
    checks who). Writes `INVOICE_FIELDS` and nothing else, so it saves elevated. Never commits."""
    doc = frappe.get_doc(doctype, name, for_update=True)
    if doc.status in (EXPENSE_PAID, EXPENSE_REJECTED):
        frappe.throw(_("{0} is {1}; its invoice can no longer be added here.").format(name, doc.status))
    doc.update({field: invoice.get(field) for field in INVOICE_FIELDS})
    doc.save(ignore_permissions=True)


def save_paid_invoice(doctype: str, name: str, invoice: dict, user: str) -> None:
    """The Payment Done tab's Upload / Edit Inv (owner, 2026-10-31): a carve-out from `edit_access` like
    `save_raiser_invoice`, for `role_profiles.PAID_INVOICE_PROFILES` (`api/expenses/paid_invoice` checks who).
    On a Paid Expense it writes `INVOICE_FIELDS` and nothing else, so it saves elevated; all three are
    required and the date is not after today.

    The file is the one already on the expense, or one `user` just uploaded unattached (an HR user may not
    write the expense, so cannot upload against it), which is then filed under the expense. Any other File
    URL is refused, so this cannot put another record's file on an expense. Never commits."""
    if doctype not in EXPENSE_DOCTYPES:
        frappe.throw(_("{0} is not an expense ledger.").format(doctype))
    values = {f: (invoice.get(f) or "").strip() for f in INVOICE_FIELDS}
    if not values["invoice_attachment"]:
        frappe.throw(_("Attach the invoice file."), title=_("Invoice file required"))
    if not values["invoice_ref"]:
        frappe.throw(_("Enter the invoice number."), title=_("Invoice number required"))
    if not values["invoice_date"]:
        frappe.throw(_("Enter the invoice date."), title=_("Invoice date required"))
    if getdate(values["invoice_date"]) > getdate(nowdate()):
        frappe.throw(_("The invoice date cannot be after today."))

    doc = frappe.get_doc(doctype, name, for_update=True)
    if (doc.status or "").strip() != EXPENSE_PAID:
        frappe.throw(_("{0} is {1}; its invoice is added here only once it is Paid.").format(
            name, doc.status or "blank"))
    new_file = None
    if values["invoice_attachment"] != (doc.invoice_attachment or ""):
        new_file = _uploaded_invoice_file(doc, values["invoice_attachment"], user)
    doc.update(values)
    doc.save(ignore_permissions=True)
    if new_file:
        # Files the upload under the expense, as an upload made against it would have been. A plain write:
        # it moves no bytes, and a File's own hooks have nothing to do for a link.
        frappe.db.set_value("File", new_file, {
            "attached_to_doctype": doctype,
            "attached_to_name": name,
            "attached_to_field": "invoice_attachment",
        }, update_modified=False)


def _uploaded_invoice_file(doc, file_url: str, user: str) -> str | None:
    """The File to file under `doc` for `file_url`: None when it already is, else `user`'s own unattached
    upload of it. Refuses any other URL."""
    if frappe.db.exists("File", {"file_url": file_url, "attached_to_doctype": doc.doctype,
                                 "attached_to_name": doc.name}):
        return None
    mine = frappe.get_all("File", filters={"file_url": file_url, "owner": user,
                                           "attached_to_name": ["is", "not set"]},
                          pluck="name", limit=1)
    if not mine:
        frappe.throw(_("That invoice file was not uploaded here. Upload it again."), title=_("Invoice file"))
    return mine[0]


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
        doc.status = EXPENSE_APPROVED
        doc.ceo_approval_date = nowdate()
    elif action == REJECT:
        doc.status = EXPENSE_REJECTED
        doc.flags[REJECTION_REASON_FLAG] = reason.strip()
    elif action == MARK_DONE:
        doc.status = EXPENSE_RECONCILIATION_PENDING
    else:
        _record_payment(doc, payment or {}, user)
        _record_invoice(doc, invoice or {})
        doc.status = EXPENSE_PAID

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
    elif status == EXPENSE_CEO_PENDING:
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
