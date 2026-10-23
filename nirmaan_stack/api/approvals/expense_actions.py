"""
The one call that changes an Expense's status (spec #1494 seam 2, ticket #1497).

    decide_expenses(expense_ids, action, reason=None, payment=None, invoice=None)

`action` is one of `services/expense_decision.ACTIONS`: `l1_approve`, `ceo_approve`, `reject`,
`mark_done`, `mark_paid`. One row and a hundred go through the same code, so approving one expense
and approving it in bulk cannot land it at different statuses. Every screen that moves an expense
calls this: Approve Payments (row and bulk), the accountant tabs' Mark as Paid, and Approve / Mark
as Paid on the old Project Expenses and Non-Project Expenses pages. What each action does, from
which status, and who may do it is `services/expense_decision.decide`; this endpoint only parses,
loops, isolates each row in a savepoint, commits, and reports.

It replaces `bulk_lead_approve_expenses` / `bulk_ceo_approve_expenses`, which took the stage from
the endpoint name and admitted Accountants as L1.

⚠️ WHY THIS IS A SEPARATE ENGINE AND NOT A WIDENING OF THE PAYMENTS ONE. `bulk_actions._bulk_action`
is built around a PO/SR PARENT (row locks on the order, `payment_terms` mirroring, SR tax). An
expense has no parent, so none of that applies. The batch ceiling comes from that module, so the two
queues share it.

THE RESULT: `{"succeeded": [names], "failed": [{name, reason}], "statuses": {name: status}, "total"}`.
`statuses` is what each row now holds -- the server's verdict, which the screen shows rather than
guessing (an L1 approve lands at Approved or CEO Pending by amount).
"""

import json
from typing import Optional

import frappe
from frappe import _

from nirmaan_stack.api.payments.bulk_actions import MAX_BATCH_SIZE
from nirmaan_stack.services.expense_decision import ACTIONS, LOCKED_FIELDS, REJECT, decide, edit_access
from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES


@frappe.whitelist(methods=["POST"])
def decide_expenses(expense_ids, action: str, reason: Optional[str] = None, payment=None, invoice=None):
    """Apply one `action` to each named Expense, as the caller. Partial failure is normal.

    `payment` and `invoice` are Mark as Paid's details (`expense_decision.PAYMENT_FIELDS`,
    `INVOICE_FIELDS`), dicts or their JSON. They are saved in the same write as the status, so a
    refused Mark as Paid saves neither.
#: Where a reject puts its reason for the ledger row's own hooks, which carry it to the Expense Request
#: (`expense_request_status.on_expense_rejected`) and the Reimbursement (`reimbursements.expense_link`).
REJECTION_REASON_FLAG = "rejection_reason"
#: What those hooks write when a row reaches Rejected with no reason on it (a Desk or REST edit).
FALLBACK_REJECTION_REASON = "Rejected in Payments."


@frappe.whitelist()
def bulk_lead_approve_expenses(expense_ids, action: str, rejection_reason: Optional[str] = None):
    """L1 bulk action on expenses currently in 'Requested'.

    Approve lands each row at `Approved` or `CEO Pending` depending on its own
    amount against this ledger's CEO line.
    """
    names = _parse_list(expense_ids)
    if action not in ACTIONS:
        frappe.throw(_("action must be one of {0}.").format(", ".join(ACTIONS)))
    if action == REJECT and not (reason or "").strip():
        frappe.throw(_("A rejection needs a reason."))
    payment, invoice = _parse_dict(payment), _parse_dict(invoice)

    user = frappe.session.user
    found = _resolve_ledgers(names)
    succeeded: list[str] = []
    failed: list[dict] = []
    statuses: dict[str, str] = {}

    for name in names:
        doctype = found.get(name)
        if not doctype:
            failed.append({"name": name, "reason": "Expense not found"})
            continue
        # ⚠️ THE SAVEPOINT IS NOT TIDINESS. On Postgres a caught exception around a DB write leaves
        # the whole transaction ABORTED: every later statement fails, and the commit below silently
        # ROLLS BACK while the endpoint returns 200. One bad row would take the batch with it.
        savepoint = f"exp_decide_{frappe.generate_hash(length=12)}"
        frappe.db.savepoint(savepoint)
        try:
            statuses[name] = decide(doctype, name, action, user, reason=reason, payment=payment, invoice=invoice)
        except Exception as exc:
            frappe.db.rollback(save_point=savepoint)
            frappe.clear_messages()
            failed.append({"name": name, "reason": str(exc) or "Unknown error"})
            if not isinstance(exc, (frappe.ValidationError, frappe.PermissionError)):
                frappe.log_error(title=f"Expense decision error ({name})", message=frappe.get_traceback())
            continue
        frappe.db.release_savepoint(savepoint)
        succeeded.append(name)

    frappe.db.commit()

    if action == REJECT:
        _add_rejection_comments([(found[n], n) for n in succeeded], reason)

    return {
        "status": 200,
        "message": _("Processed {0} expenses. {1} succeeded, {2} failed.").format(
            len(names), len(succeeded), len(failed)
        ),
        "data": {"succeeded": succeeded, "failed": failed, "statuses": statuses, "total": len(names)},
    }


@frappe.whitelist()
def get_expense_edit_access():
    """What the caller may edit on an Expense by hand (story 50), as `expense_decision.edit_access`
    answers it: `editable_statuses`, the statuses in which they may edit at all; `field_limits`,
    per status the only fields an edit may change (a listed status with no limit allows every field
    but the status); and `locked_fields`, per status the fields nobody's edit may change
    (`expense_decision.LOCKED_FIELDS`: the pay-to account from Reconciliation Pending). The ledger pages and the Payments queue show Edit, Upload Invoice and each
    dialog field from this, so they and both ledgers' `validate` (`guard_hand_save`) agree.

    Example (an Accountant Lead): `{"editable_statuses": ["Requested", "CEO Pending", "Approved",
    "Reconciliation Pending", "Paid"], "field_limits": {"Paid": ["description", "comment", ...]},
    "locked_fields": {"Reconciliation Pending": ["pay_to_account_name", ...]}}`.
    """
    access = edit_access(frappe.session.user)
    return {
        "editable_statuses": list(access),
        "field_limits": {status: list(fields) for status, fields in access.items() if fields is not None},
        "locked_fields": {status: list(fields) for status, fields in LOCKED_FIELDS.items() if status in access},
    }


def _parse_dict(value) -> dict | None:
    if isinstance(value, str):
        return json.loads(value) if value.strip() else None
    return value


def _parse_list(expense_ids) -> list[str]:
    if isinstance(expense_ids, str):
        try:
            expense_ids = json.loads(expense_ids)
        except json.JSONDecodeError:
            frappe.throw(_("expense_ids must be a JSON list of names."))
    if not isinstance(expense_ids, list) or not expense_ids:
        frappe.throw(_("expense_ids must be a non-empty list."))
    if len(expense_ids) > MAX_BATCH_SIZE:
        frappe.throw(_("Limited to {0} records per call.").format(MAX_BATCH_SIZE))
    return list(dict.fromkeys(expense_ids))


def _resolve_ledgers(names: list[str]) -> dict[str, str]:
    """name -> its expense doctype, resolved SERVER-SIDE.
        frappe.throw(_("Bulk action limited to {0} records per call.").format(MAX_BATCH_SIZE))

    if action not in ("approve", "reject"):
        frappe.throw(_("action must be 'approve' or 'reject'."))

    if action == "reject" and not (rejection_reason or "").strip():
        frappe.throw(_("Rejection reason is required."))

    deduped_ids = list(dict.fromkeys(expense_ids))
    found = _resolve_ledgers(deduped_ids)

    succeeded: list[str] = []
    failed: list[dict] = []
    # Deferred to AFTER the commit, exactly as the payments engine does it: a
    # comment failure must not be able to unwind an approval that already landed.
    pending_comments: list[tuple[str, str]] = []

    for eid in deduped_ids:
        row = found.get(eid)
        if not row:
            failed.append({"name": eid, "reason": "Expense not found"})
            continue
        _process_expense(
            expense_id=eid,
            row=row,
            action=action,
            source_status=source_status,
            approve_date_field=approve_date_field,
            ceo_mode=ceo_mode,
            succeeded=succeeded,
            failed=failed,
            pending_comments=pending_comments,
            rejection_reason=rejection_reason,
        )

    frappe.db.commit()

    if action == "reject" and rejection_reason and pending_comments:
        _add_rejection_comments(pending_comments, rejection_reason)

    return {
        "status": 200,
        "message": _("Processed {0} expenses. {1} succeeded, {2} failed.").format(
            len(deduped_ids), len(succeeded), len(failed)
        ),
        "data": {
            "succeeded": succeeded,
            "failed": failed,
            "total": len(deduped_ids),
        },
    }


def _process_expense(
    expense_id: str,
    row: dict,
    action: str,
    source_status: str,
    approve_date_field: str,
    ceo_mode: bool,
    succeeded: list[str],
    failed: list[dict],
    pending_comments: list[tuple[str, str]],
    rejection_reason: str | None = None,
):
    """One expense, inside its own SAVEPOINT.

    Trusting a client-declared doctype would let a caller name a Project Payment and have it moved
    by the engine that skips every PO lock and term sync. Both expense tables are read instead, so
    the only records this call can ever touch are expenses.
    """
    found: dict[str, str] = {}
    for doctype in EXPENSE_DOCTYPES:
        for name in frappe.get_all(doctype, filters={"name": ["in", names]}, pluck="name"):
            found[name] = doctype
    return found
    doctype = row["doctype"]

    if row["status"] != source_status:
        failed.append({
            "name": expense_id,
            "reason": f"Status is '{row['status']}', expected '{source_status}'",
        })
        return

    project = row.get("project")
    if project:
        if frappe.db.get_value("Projects", project, "status") == CEO_HOLD_STATUS:
            failed.append({"name": expense_id, "reason": "Project is on CEO Hold"})
            return

    if action == "reject":
        target_status = REJECTED_STATUS
    elif ceo_mode:
        # An L2 approval always finishes it -- there is no third gate to forward to.
        target_status = STATUS_APPROVED
    else:
        # ⚠️ flt() FIRST: `Project Expenses.amount` is a varchar column, so an
        # unconverted value would be banded by its characters. The explicit
        # `TIER_L2_ABOVE_EXPENSES` equals the module default today (both 50,000);
        # it is passed anyway so a future split lands here without a code change.
        target_status = status_after_l1(flt(row["amount"]), TIER_L2_ABOVE_EXPENSES)

    savepoint = f"bulk_exp_{frappe.generate_hash(length=12)}"
    frappe.db.savepoint(savepoint)
    try:
        # Lock the row so a single-row approver racing on the same expense
        # serialises behind us rather than producing a last-write-wins flip.
        frappe.db.sql(f'SELECT name FROM "tab{doctype}" WHERE name = %s FOR UPDATE', expense_id)
        doc = frappe.get_doc(doctype, expense_id)

        # Re-read under the lock. The status came from a list query taken before it.
        if doc.status != source_status:
            frappe.db.rollback(save_point=savepoint)
            failed.append({
                "name": expense_id,
                "reason": f"Status is '{doc.status}', expected '{source_status}'",
            })
            return

        doc.status = target_status
        if action == "approve":
            # ⚠️ ONLY THIS MODE'S OWN DATE FIELD, even when an L1 tick FINISHES the
            # approval. Stamping `ceo_approval_date` there would make the dashboard's
            # CEO Approval counter -- which keys on `ceo_approval_date and not
            # auto_approved` -- count an approval the CEO never made.
            doc.set(approve_date_field, nowdate())

        doc.flags.bulk_approval = True
        if action == "reject":
            # A reimbursement's expense hands the reason to its claim in the same save (ADR-0040,
            # `services/reimbursements/expense_link.follow_expense`); the comment below comes after the commit.
            doc.flags[REJECTION_REASON_FLAG] = (rejection_reason or "").strip()
        doc.save(ignore_permissions=True)
    except Exception as exc:
        frappe.db.rollback(save_point=savepoint)
        failed.append({"name": expense_id, "reason": str(exc) or "Unknown error"})
        frappe.log_error(
            title=f"Bulk Expense Save Error ({expense_id})",
            message=frappe.get_traceback(),
        )
        return

    frappe.db.release_savepoint(savepoint)
    succeeded.append(expense_id)
    if action == "reject":
        pending_comments.append((doctype, expense_id))


def _add_rejection_comments(records: list[tuple[str, str]], reason: str):
    """Best-effort audit trail on each rejected expense, after the commit, so a comment failure
    cannot unwind a rejection that already landed."""
    for doctype, name in records:
        try:
            frappe.get_doc(doctype, name).add_comment("Comment", text=_("Rejected: {0}").format(reason))
        except Exception:
            frappe.log_error(title=f"Expense reject comment error ({name})", message=frappe.get_traceback())
    frappe.db.commit()
