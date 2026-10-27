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
from frappe.utils import flt

from nirmaan_stack.services.payees.own_accounts import assert_own_account
from nirmaan_stack.services.payees.pay_to import copy_payee_account
from nirmaan_stack.services.reimbursements.access import is_hr
from nirmaan_stack.services.reimbursements.convert import LINK_FIELD
from nirmaan_stack.services.reimbursements.expense_link import (
    delete_claim,
    delete_rejected_expense,
    lock_expense_of,
)
from nirmaan_stack.services.reimbursements.receipts import (
    apply_receipts,
    claim_files,
    loose_files,
    plan_receipts,
)
from nirmaan_stack.services.reimbursements.rules import (
    PENDING,
    claim_problem,
    delete_problem,
    edit_problem,
    reviewer_for,
)
from nirmaan_stack.services.stored_files import delete_files

DOCTYPE = "Reimbursement"


def _as_list(value) -> list[str]:
    if not value:
        return []
    if isinstance(value, str):
        value = json.loads(value)
    return [v for v in value if v]


def _check(title, amount, receipt_count, description, reimbursement_type) -> None:
    problem = claim_problem(title, amount, receipt_count, description, reimbursement_type)
    if problem:
        frappe.throw(_(problem))


def _refuse_delete(claim, user: str) -> None:
    problem = delete_problem(claim.status, is_claimant=claim.owner == user)
    if problem:
        frappe.throw(_(problem), frappe.PermissionError if claim.owner != user else frappe.ValidationError)


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
    new_files = loose_files(_as_list(file_urls), user)
    _check(title, amount, len(new_files), description, reimbursement_type)
    assert_own_account(user, payee)
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
    return {"name": claim.name, "reviewer": reviewer_for(claim.amount, claimant_is_hr=is_hr(user))}


@frappe.whitelist(methods=["POST"])
def update_reimbursement(name, title, amount, payee, description=None, file_urls=None, remove_file_urls=None,
                         reimbursement_type=None) -> dict:
    """Edit the claimant's own claim while it is Pending Approval.

    `file_urls` are new receipts (merged after the current PDF, or attached); `remove_file_urls` are
    receipts already on the claim to remove. At least one receipt must remain. The bank account is copied
    again from `payee`, which must be one of the claimant's.
    """
    user = frappe.session.user
    claim = frappe.get_doc(DOCTYPE, name, for_update=True)
    problem = edit_problem(claim.status, is_claimant=claim.owner == user)
    if problem:
        frappe.throw(_(problem), frappe.PermissionError if claim.owner != user else frappe.ValidationError)
    assert_own_account(user, payee)
    new_files = loose_files(_as_list(file_urls), user)
    plan = plan_receipts(claim, new_files, _as_list(remove_file_urls))
    _check(title, amount, plan.receipt_count, description, reimbursement_type)

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
    return {"name": claim.name, "reviewer": reviewer_for(claim.amount, claimant_is_hr=is_hr(user))}


@frappe.whitelist(methods=["POST"])
def delete_reimbursement(name) -> dict:
    """Delete the claimant's own claim while it is Pending Approval or Rejected, with its receipts -- and, for a
    claim rejected in Payments, its Rejected Non-Project Expense (owner, 2026-10-27; ADR-0040).

    The expense is locked BEFORE the claim, the order a decision or a delete from Payments takes, so this can't
    deadlock with them (code review 2026-10-27, finding 2). The rule is asked again inside the locks."""
    user = frappe.session.user
    # Refused before any lock, so someone else's call never holds the claim's expense row.
    _refuse_delete(frappe.get_doc(DOCTYPE, name), user)
    expense = lock_expense_of(name)
    claim = frappe.get_doc(DOCTYPE, name, for_update=True)
    _refuse_delete(claim, user)
    delete_rejected_expense(name, expense)
    files = delete_claim(name)
    frappe.db.commit()
    _delete_last(files)
    return {"name": name, "deleted": True}


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


@frappe.whitelist()
def get_claim_payments(names) -> dict:
    """The Non-Project Expense paying each claim the caller may read, by claim name (ADR-0040):
    `{claim: {expense, status, payment_date, payment_ref}}`. Claims with no expense are left out.

    Read here rather than by the screen, because most claimants can't read Non-Project Expenses.
    """
    wanted = [n for n in _as_list(names) if n]
    if not wanted:
        return {}
    readable = frappe.get_list(DOCTYPE, filters={"name": ["in", wanted]}, pluck="name")
    if not readable:
        return {}
    rows = frappe.get_all(
        "Non Project Expenses",
        filters={LINK_FIELD: ["in", readable]},
        fields=["name", LINK_FIELD, "status", "payment_date", "payment_ref"],
    )
    return {
        row[LINK_FIELD]: {
            "expense": row.name, "status": row.status,
            "payment_date": row.payment_date, "payment_ref": row.payment_ref,
        }
        for row in rows
    }
