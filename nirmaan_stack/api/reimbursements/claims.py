# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Raise, edit and delete a Reimbursement -- the claimant's own actions.

Thin orchestrators (ADR-0010 B4): every rule is in `services/reimbursements`, and the claimant's bank
account is the Payee module's (`services/payees/own_accounts`). Receipts are read and merged in memory
before anything is written (`receipts.plan_receipts`); the Files a save replaces are deleted LAST, after the
commit (`services/stored_files.delete_files`).
"""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import flt, now_datetime

from nirmaan_stack.services.outflow_import.expense_links import last_source_join
from nirmaan_stack.services.payees.own_accounts import assert_own_account
from nirmaan_stack.services.payees.pay_to import PAY_TO_FIELDS, copy_payee_account
from nirmaan_stack.services.reimbursements.access import is_capped, is_hr
from nirmaan_stack.services.reimbursements.convert import LINK_FIELD
from nirmaan_stack.services.reimbursements.expense_link import (
    delete_claim,
    delete_rejected_expense,
    lock_claim,
    lock_expense_of,
)
from nirmaan_stack.services.reimbursements.month_total import month_used
from nirmaan_stack.services.reimbursements.receipts import (
    apply_receipts,
    claim_files,
    loose_files,
    plan_receipts,
)
from nirmaan_stack.services.reimbursements.rules import (
    PENDING,
    PM_MONTHLY_CAP,
    cap_left,
    cap_problem,
    claim_problem,
    delete_problem,
    edit_problem,
    reviewer_for,
)
from nirmaan_stack.services.role_profiles import is_developer, is_nirmaan_admin
from nirmaan_stack.services.stored_files import delete_files

DOCTYPE = "Reimbursement"
NPE = "Non Project Expenses"


def as_list(value) -> list[str]:
    """A request argument sent as a JSON list (or already a list): its non-empty items. The package's one parser."""
    if not value:
        return []
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, (list, tuple)):
        frappe.throw(_("Pass a list."))
    return [v for v in value if v]


def _check(title, amount, receipt_count, description, reimbursement_type) -> None:
    problem = claim_problem(title, amount, receipt_count, description, reimbursement_type)
    if problem:
        frappe.throw(_(problem))


def _check_cap(user: str, amount, when, exclude: str | None = None) -> None:
    """Refuse a Project Manager's claim that takes their month above `PM_MONTHLY_CAP` (owner, 2026-11-18).

    The month is counted after taking this person's row, so two of their claims sent at once are counted one after
    the other. ⚠️ A no-op UPDATE, not just `FOR UPDATE`: a request's first transaction is REPEATABLE READ on
    Postgres, whose snapshot would not see the other claim once the lock is released. After an UPDATE the second
    request is refused with a serialization error instead (READ COMMITTED: it re-reads and counts the first)."""
    if not is_capped(user):
        return
    frappe.db.sql('UPDATE "tabNirmaan Users" SET name = name WHERE name = %s', user)
    problem = cap_problem(month_used(user, when, exclude), amount, capped=True)
    if problem:
        frappe.throw(_(problem))


def _refuse_delete(claim, user: str) -> None:
    is_claimant = claim.owner == user
    is_admin = is_nirmaan_admin(user) or is_developer(user)
    problem = delete_problem(claim.status, is_claimant=is_claimant, is_admin=is_admin)
    if problem:
        frappe.throw(_(problem), frappe.ValidationError if is_claimant or is_admin else frappe.PermissionError)


def _delete_last(names: list[str]) -> None:
    if names:
        delete_files({"name": ["in", names]})
        frappe.db.commit()


@frappe.whitelist(methods=["POST"])
def raise_reimbursement(title, amount, payee, file_urls=None, description=None, reimbursement_type=None) -> dict:
    """Raise a claim for the logged-in user.

    `reimbursement_type` is Travel, Food or Others. `payee` must be their own bank account; `file_urls` are receipts they uploaded loose (PDFs and
    pictures are merged into one PDF, other files attached as they are). Returns `{name, reviewer}`, where
    `reviewer` is who will decide it ("HR or Admin" / "Admin").
    """
    user = frappe.session.user
    new_files = loose_files(as_list(file_urls), user)
    _check(title, amount, len(new_files), description, reimbursement_type)
    assert_own_account(user, payee)
    _check_cap(user, amount, now_datetime())
    plan = plan_receipts(None, new_files)

    claim = frappe.get_doc({
        "doctype": DOCTYPE,
        "reimbursement_type": reimbursement_type,
        "title": title.strip(),
        "description": (description or "").strip() or None,
        "amount": flt(amount, 2),
        "status": PENDING,
    })
    copy_payee_account(claim, payee)
    claim.insert(ignore_permissions=True)
    to_delete = apply_receipts(claim, plan)
    frappe.db.commit()
    _delete_last(to_delete)
    return {"name": claim.name, "reviewer": reviewer_for(claimant_is_hr=is_hr(user))}


@frappe.whitelist(methods=["POST"])
def update_reimbursement(name, title, amount, payee, description=None, file_urls=None, remove_file_urls=None,
                         reimbursement_type=None) -> dict:
    """Edit the claimant's own claim while it is Pending Approval.

    `file_urls` are new receipts (merged after the current PDF, or attached); `remove_file_urls` are
    receipts already on the claim to remove. At least one receipt must remain. The bank account is copied
    again from `payee`, which must be one of the claimant's.
    """
    user = frappe.session.user
    claim = lock_claim(name)
    problem = edit_problem(claim.status, is_claimant=claim.owner == user)
    if problem:
        frappe.throw(_(problem), frappe.PermissionError if claim.owner != user else frappe.ValidationError)
    assert_own_account(user, payee)
    new_files = loose_files(as_list(file_urls), user)
    plan = plan_receipts(claim, new_files, as_list(remove_file_urls))
    _check(title, amount, plan.receipt_count, description, reimbursement_type)
    _check_cap(user, amount, claim.creation, exclude=claim.name)

    claim.update({
        "reimbursement_type": reimbursement_type,
        "title": title.strip(),
        "description": (description or "").strip() or None,
        "amount": flt(amount, 2),
    })
    copy_payee_account(claim, payee)
    claim.save(ignore_permissions=True)
    to_delete = apply_receipts(claim, plan)
    frappe.db.commit()
    _delete_last(to_delete)
    return {"name": claim.name, "reviewer": reviewer_for(claimant_is_hr=is_hr(user))}


@frappe.whitelist(methods=["POST"])
def delete_reimbursement(name) -> dict:
    """Delete a claim with its receipts -- and, for a claim rejected in Payments, its Rejected Non-Project Expense
    (owner, 2026-10-27; ADR-0040). The claimant deletes their own while it is Pending Approval or Rejected; an Admin
    deletes anyone's once it is Rejected (owner, 2026-11-19; `rules.delete_problem`).

    The expense is locked BEFORE the claim, the order a decision or a delete from Payments takes, so this can't
    deadlock with them (code review 2026-10-27, finding 2). The rule is asked again inside the locks."""
    user = frappe.session.user
    # Refused before any lock, so someone else's call never holds the claim's expense row.
    _refuse_delete(frappe.get_doc(DOCTYPE, name), user)
    expense = lock_expense_of(name)
    claim = lock_claim(name)
    _refuse_delete(claim, user)
    delete_rejected_expense(name, expense)
    files = delete_claim(name)
    frappe.db.commit()
    _delete_last(files)
    return {"name": name, "deleted": True}


@frappe.whitelist()
def get_my_month(exclude=None) -> dict:
    """The caller's own month against the Project Manager cap, for the Raise / Edit dialog:
    `{capped, cap, used, left}`. `exclude` is the claim being edited (its month, without its own amount); only a
    claim of the caller's is honoured. Anyone may ask: it reads only their own claims."""
    user = frappe.session.user
    if not is_capped(user):
        return {"capped": False, "cap": PM_MONTHLY_CAP, "used": 0, "left": None}
    when, own = now_datetime(), None
    if exclude:
        claim = frappe.db.get_value(DOCTYPE, exclude, ["owner", "creation"], as_dict=True)
        if claim and claim.owner == user:
            when, own = claim.creation, exclude
    used = month_used(user, when, own)
    return {"capped": True, "cap": PM_MONTHLY_CAP, "used": used, "left": cap_left(used)}


@frappe.whitelist()
def get_claim_files(name) -> list[dict]:
    """The receipts on a claim the caller may read: the merged PDF first, then any other files."""
    claim = frappe.get_doc(DOCTYPE, name)
    claim.check_permission("read")
    files = claim_files(name)
    files.sort(key=lambda f: f.file_url != claim.attachment)
    return [
        {"file_name": f.file_name, "file_url": f.file_url, "is_receipts_pdf": f.file_url == claim.attachment}
        for f in files
    ]


#: The expense fields the claim's view shows (ADR-0040 Amendment C point 7), read as they are.
CLAIM_EXPENSE_FIELDS = (
    "status", "payment_date", "payment_ref", "creation", "amount", "description", "invoice_ref", "invoice_date",
    "comment", "approval_date", "ceo_approval_date", "auto_approved", *PAY_TO_FIELDS,
)


@frappe.whitelist()
def get_claim_payments(names) -> dict:
    """The Non-Project Expense paying each claim the caller may read, by claim name (ADR-0040):
    `{claim: {expense, status, payment_date, payment_ref, ...}}`. Claims with no expense are left out.

    Besides those four, each carries what the claim's view shows (Amendment C point 7): `CLAIM_EXPENSE_FIELDS`
    and `payment_source`, the statement its bank line was matched from (None before a match), read by the same
    join Project Payments uses (`expense_links.last_source_join`).

    Read here rather than by the screen, because most claimants can't read Non-Project Expenses.
    """
    wanted = [n for n in as_list(names) if n]
    if not wanted:
        return {}
    readable = frappe.get_list(DOCTYPE, filters={"name": ["in", wanted]}, pluck="name")
    if not readable:
        return {}
    columns = ", ".join(f'e."{f}"' for f in CLAIM_EXPENSE_FIELDS)
    rows = frappe.db.sql(
        f"""
        SELECT e."name", e."{LINK_FIELD}" AS claim, {columns}, s."source" AS payment_source
        FROM "tab{NPE}" e
        {last_source_join(NPE, "e")}
        WHERE e."{LINK_FIELD}" IN %(readable)s
        """,
        {"readable": tuple(readable)},
        as_dict=True,
    )
    return {
        row.claim: {"expense": row.name, **{f: row.get(f) for f in CLAIM_EXPENSE_FIELDS},
                    "payment_source": row.payment_source}
        for row in rows
    }
