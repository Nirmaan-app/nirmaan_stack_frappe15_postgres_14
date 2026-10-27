# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Turn an approved Reimbursement into the Non-Project Expense that pays it (ADR-0040).

Called by `api/reimbursements/review.approve_reimbursement`, inside the approval's own transaction: a claim
is Approved and has its expense, or neither. From then on Accounts pays the EXPENSE like any other, and the
claim follows only its endings (`expense_link.py`).

What the expense holds (owner, 2026-10-23):

* NO `type` (owner, 2026-10-23): the expense depends on no Expense Type -- the "Reimbursements" type is to be
  deleted. `reimbursement` -- the claim's ID -- is what marks it (the expense's only
  link back; `request_id` can only name an Expense Request).
* `amount`, the five `pay_to_*` fields and `invoice_attachment` (a LINK to the claim's merged receipts PDF,
  which stays private to the claim; `receipts_link`) -- copied as they are. The account is the one the claim was approved
  with: a claimant correcting their account later changes only their next claims.
* `description` -- the claim in one line (`describe`); `comment` -- who approved it (`approver_note`).
* `invoice_ref` / `invoice_date` -- the claim's ID and the day it was raised (owner, 2026-10-23): the claim is
  the invoice. It has no bill number or date of its own, and one claim can merge several bills into its PDF.
* `status` -- not set here: the expense is born Requested and its own `validate` routes it by the shared rule,
  with the claim's APPROVER as the raiser (`approval_raiser.routing_raiser`; code review finding 6, one copy of
  the rule). HR's claims (₹2,000 or less) are auto-approved; an Admin's approval clears L1, so up to ₹50,000
  is Approved and above it waits for the CEO; the CEO's clears both.
* `owner` -- the claimant, so Payments shows the person the money is for.
"""

from __future__ import annotations

import frappe
from frappe.utils import flt, getdate

from nirmaan_stack.services.approval_raiser import REIMBURSEMENT_APPROVAL_FLAG
from nirmaan_stack.services.outflow_import.ledgers import NON_PROJECT_EXPENSE_DOCTYPE
from nirmaan_stack.services.outflow_import.settle import format_amount_for
from nirmaan_stack.services.payees.pay_to import copy_pay_to

#: The field on `Non Project Expenses` naming the claim it was created from.
LINK_FIELD = "reimbursement"

#: The flag `create_expense` puts on its insert: the ONLY insert allowed to carry `reimbursement`
#: (`expense_link.guard_link`), and the only one `approval_raiser.routing_raiser` routes by the claim's approver.
#: A server-side doc flag, so no client (REST, Desk, Duplicate, import) can set it. Defined in `approval_raiser`.
APPROVAL_FLAG = REIMBURSEMENT_APPROVAL_FLAG

#: `comment` is a Data column: 140 characters.
COMMENT_LIMIT = 140


def role_label(profile: str | None) -> str:
    """"Nirmaan Project Manager Profile" -> "Project Manager" (the screen's `roleLabel`)."""
    label = (profile or "").strip()
    if label.startswith("Nirmaan "):
        label = label[len("Nirmaan "):]
    if label.endswith(" Profile"):
        label = label[: -len(" Profile")]
    return label


def describe(claim) -> str:
    """The claim in one line for the expense's `description`:
    `Travel · Cab to site · <description> · Claimant: <name> (<role>) · [REIMB-26-00012]`."""
    claimant = claim.get("claimant_name") or claim.get("owner") or ""
    role = role_label(claim.get("claimant_role"))
    parts = [
        claim.get("reimbursement_type"),
        (claim.get("title") or "").strip(),
        " ".join((claim.get("description") or "").split()),
        f"Claimant: {claimant}" + (f" ({role})" if role else "") if claimant else "",
        f"[{claim.name}]",
    ]
    return " · ".join(p for p in parts if p)


def approver_note(approver_name: str) -> str:
    """`comment`: who approved the claim, cut to the column's 140 characters."""
    return f"Approved by {approver_name} (Reimbursement)"[:COMMENT_LIMIT]


#: A file stored on the site's own disk. Frappe's `attach_files_to_document` (every save, every doctype) gives
#: such a path in an Attach field a File attached to THAT record, so it would open for anyone who can read the
#: expense. A cloud URL (`/api/method/...`, the storage app's) is skipped by that hook.
LOCAL_FILE_PREFIXES = ("/files/", "/private/files/")


def receipts_link(attachment: str | None) -> str | None:
    """The `invoice_attachment` to copy from the claim's receipts PDF, or None. Pure.

    A cloud URL is copied: it stays a link, readable only by those who can read the claim. A local-disk path is
    NOT (code review finding 7): it would become a File on the expense, open to every expense reader. Accounts
    reach those receipts through the claim, named by `reimbursement` and `invoice_ref`.
    """
    if not attachment or attachment.startswith(LOCAL_FILE_PREFIXES):
        return None
    return attachment


def expense_of(claim_name: str) -> str | None:
    """The Non-Project Expense created from a claim, or None."""
    return frappe.db.get_value(NON_PROJECT_EXPENSE_DOCTYPE, {LINK_FIELD: claim_name}, "name")


def create_expense(claim, approver: str):
    """Create the claim's Non-Project Expense and return it. The caller holds the claim's lock and commits."""
    existing = expense_of(claim.name)
    if existing:
        return frappe.get_doc(NON_PROJECT_EXPENSE_DOCTYPE, existing)

    approver_name = frappe.db.get_value("Nirmaan Users", approver, "full_name") or approver
    expense = frappe.new_doc(NON_PROJECT_EXPENSE_DOCTYPE)
    expense.update({
        LINK_FIELD: claim.name,
        "amount": format_amount_for(NON_PROJECT_EXPENSE_DOCTYPE, flt(claim.amount)),
        "description": describe(claim),
        "comment": approver_note(approver_name),
        "invoice_attachment": receipts_link(claim.get("attachment")),
        "invoice_ref": claim.name,
        "invoice_date": getdate(claim.creation),
        # No status: born at the ledger's default, Requested, so `expense_decision.apply_starting_status` routes it by
        # the one shared rule, with the claim's approver as the raiser (`approval_raiser.routing_raiser`).
        # The claim is already saved Approved with `approved_by`, which that lookup reads.
    })
    copy_pay_to(claim, expense)
    expense.flags[APPROVAL_FLAG] = True
    expense.insert(ignore_permissions=True)
    # Frappe stamps the session user (the approver) as `owner` on every insert. An owner-only write, so no
    # hook is skipped that matters: nothing reads an expense's owner after creation (its `validate` routing
    # ran during the insert, and reads the claim's approver, not the owner).
    if claim.owner and claim.owner != expense.owner:
        frappe.db.set_value(NON_PROJECT_EXPENSE_DOCTYPE, expense.name, "owner", claim.owner, update_modified=False)
        expense.owner = claim.owner
    return expense
