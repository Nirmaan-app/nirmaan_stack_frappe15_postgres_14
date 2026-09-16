"""
Bulk approve / reject the two EXPENSE ledgers, for the unified approval queue.

Two endpoints, same engine, mirroring `api/payments/bulk_actions.py`:
  * bulk_lead_approve_expenses   -- L1 acting on 'Requested'
  * bulk_ceo_approve_expenses    -- CEO acting on 'CEO Pending'

⚠️ WHY THIS IS A SEPARATE ENGINE AND NOT A WIDENING OF THE PAYMENTS ONE.

`bulk_actions._bulk_action` is built around a PO/SR PARENT: it groups payments by
`(document_type, document_name)`, takes a `FOR UPDATE` row lock on the Procurement
Order, mirrors each payment's status onto the matching `payment_terms` row, saves
the PO once per group, and rolls the whole group back if that save fails. Then it
withholds SR tax post-commit. An expense has NO parent -- no PO, no SR, no terms to
mirror, no vendor credit, no TDS -- so every one of those mechanisms would be dead
weight wrapped in `if doc_type == ...` branches through a 700-line file.

What IS shared is imported rather than copied: the two authorisation gates, the
batch ceiling and the `Rejected` literal all come from that module, so a role change
lands in one place and cannot drift between the two queues.

THE AMOUNT RULE. `status_after_l1` is called with `TIER_L2_ABOVE_EXPENSES` explicitly
rather than taking the module default. Since 16 Sep 2026 that constant equals the
payments line at 50,000 (it was 30,000 for one day), so an L1 tick FINISHES a Rs 40,000
expense and FORWARDS a Rs 60,000 one, in the same batch -- exactly what the payments
engine had to learn to do per-row. The explicit argument stays: it costs nothing while
the lines coincide, and it is the seam if they part again.

⚠️ `Project Expenses.amount` is a `Data` / varchar column. `flt()` before the tier
test or "9000" compares above "50000" and a Rs 9,000 expense is routed to the CEO.

DELIBERATELY NOT HERE (each exists because a payment has a parent and an expense
does not): PO term mirroring, SR tax withholding, vendor-credit recalculation,
partial / split approval, and the summary notification fan-out -- expenses have no
notification plumbing at all today, and inventing one inside a bulk endpoint would
put the first expense notification in the app on the path least able to explain it.
"""

import json
from typing import Optional

import frappe
from frappe import _
from frappe.utils import flt, nowdate

from nirmaan_stack.api.payments.bulk_actions import (
    MAX_BATCH_SIZE,
    REJECTED_STATUS,
    _authorize_ceo,
    _authorize_lead,
)
from nirmaan_stack.services.approval_tiers import (
    STATUS_APPROVED,
    STATUS_CEO_PENDING,
    STATUS_REQUESTED,
    TIER_L2_ABOVE_EXPENSES,
    status_after_l1,
)

# Ledger -> the field naming its project, or None where the ledger has none.
# A Non-Project Expense is company-wide by definition: it has no project, which is
# also why no CEO Hold can apply to it.
EXPENSE_LEDGERS = {
    "Project Expenses": "projects",
    "Non Project Expenses": None,
}

CEO_HOLD_STATUS = "CEO Hold"


# ---------------------------------------------------------------------------
# Public endpoints
# ---------------------------------------------------------------------------

@frappe.whitelist()
def bulk_lead_approve_expenses(expense_ids, action: str, rejection_reason: Optional[str] = None):
    """L1 bulk action on expenses currently in 'Requested'.

    Approve lands each row at `Approved` or `CEO Pending` depending on its own
    amount against this ledger's CEO line.
    """
    _authorize_lead()
    return _bulk_expense_action(
        expense_ids=expense_ids,
        action=action,
        rejection_reason=rejection_reason,
        source_status=STATUS_REQUESTED,
        approve_date_field="approval_date",
        ceo_mode=False,
    )


@frappe.whitelist()
def bulk_ceo_approve_expenses(expense_ids, action: str, rejection_reason: Optional[str] = None):
    """CEO bulk action on expenses currently in 'CEO Pending'.

    An L2 approval always finishes the approval, so the target is flat `Approved`.
    """
    _authorize_ceo()
    return _bulk_expense_action(
        expense_ids=expense_ids,
        action=action,
        rejection_reason=rejection_reason,
        source_status=STATUS_CEO_PENDING,
        approve_date_field="ceo_approval_date",
        ceo_mode=True,
    )


# ---------------------------------------------------------------------------
# Core engine
# ---------------------------------------------------------------------------

def _resolve_ledgers(names: list[str]) -> dict[str, dict]:
    """name -> {doctype, project, amount, status}, resolved SERVER-SIDE.

    The client knows each row's doctype (the queue normalises it), but trusting a
    client-declared doctype on an approval endpoint would let a caller name a
    Project Payment and have it approved through the engine that skips every PO
    lock and term sync. Both expense tables are read instead, so the only records
    this engine can ever touch are expenses.
    """
    found: dict[str, dict] = {}
    for doctype, project_field in EXPENSE_LEDGERS.items():
        if not frappe.has_permission(doctype, "read"):
            continue
        fields = ["name", "status", "amount"] + ([project_field] if project_field else [])
        for row in frappe.get_all(doctype, filters={"name": ["in", names]}, fields=fields):
            found[row["name"]] = {
                "doctype": doctype,
                "status": row["status"],
                "amount": row["amount"],
                "project": row.get(project_field) if project_field else None,
            }
    return found


def _bulk_expense_action(
    expense_ids,
    action: str,
    rejection_reason: str | None,
    source_status: str,
    approve_date_field: str,
    ceo_mode: bool,
):
    if isinstance(expense_ids, str):
        try:
            expense_ids = json.loads(expense_ids)
        except json.JSONDecodeError:
            frappe.throw(_("expense_ids must be a JSON list of names."))

    if not isinstance(expense_ids, list) or not expense_ids:
        frappe.throw(_("expense_ids must be a non-empty list."))

    if len(expense_ids) > MAX_BATCH_SIZE:
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
):
    """One expense, inside its own SAVEPOINT.

    ⚠️ THE SAVEPOINT IS NOT TIDINESS. On Postgres a caught exception around a DB
    write leaves the whole transaction ABORTED: every later statement fails, and a
    `frappe.db.commit()` at the end silently ROLLS BACK while the endpoint returns
    200. One bad row would take the entire batch with it and report success.
    """
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


def _add_rejection_comments(records: list[tuple[str, str]], rejection_reason: str):
    """Best-effort audit trail on each rejected expense.

    Rejection is NEW on this ledger. Until now an Admin DELETED a Requested expense
    to refuse it, destroying the record and any trace of why -- so the reason
    comment is the whole point of the status existing.
    """
    for doctype, name in records:
        try:
            doc = frappe.get_doc(doctype, name)
            doc.add_comment("Comment", text=_("Rejected: {0}").format(rejection_reason))
        except Exception:
            frappe.log_error(
                title=f"Bulk Expense Reject Comment Error ({name})",
                message=frappe.get_traceback(),
            )
