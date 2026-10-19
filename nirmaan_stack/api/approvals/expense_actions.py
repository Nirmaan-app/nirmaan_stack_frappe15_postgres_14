"""
The one call that changes an Expense's status (spec #1494 seam 2, ticket #1497).

    decide_expenses(expense_ids, action, reason=None, payment=None)

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
from nirmaan_stack.services.expense_decision import ACTIONS, REJECT, decide
from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES


@frappe.whitelist(methods=["POST"])
def decide_expenses(expense_ids, action: str, reason: Optional[str] = None, payment=None):
    """Apply one `action` to each named Expense, as the caller. Partial failure is normal."""
    names = _parse_list(expense_ids)
    if action not in ACTIONS:
        frappe.throw(_("action must be one of {0}.").format(", ".join(ACTIONS)))
    if action == REJECT and not (reason or "").strip():
        frappe.throw(_("A rejection needs a reason."))
    if isinstance(payment, str):
        payment = json.loads(payment) if payment.strip() else None

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
            statuses[name] = decide(doctype, name, action, user, reason=reason, payment=payment)
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

    Trusting a client-declared doctype would let a caller name a Project Payment and have it moved
    by the engine that skips every PO lock and term sync. Both expense tables are read instead, so
    the only records this call can ever touch are expenses.
    """
    found: dict[str, str] = {}
    for doctype in EXPENSE_DOCTYPES:
        for name in frappe.get_all(doctype, filters={"name": ["in", names]}, pluck="name"):
            found[name] = doctype
    return found


def _add_rejection_comments(records: list[tuple[str, str]], reason: str):
    """Best-effort audit trail on each rejected expense, after the commit, so a comment failure
    cannot unwind a rejection that already landed."""
    for doctype, name in records:
        try:
            frappe.get_doc(doctype, name).add_comment("Comment", text=_("Rejected: {0}").format(reason))
        except Exception:
            frappe.log_error(title=f"Expense reject comment error ({name})", message=frappe.get_traceback())
    frappe.db.commit()
