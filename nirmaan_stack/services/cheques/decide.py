# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""One cheque, one decision: a Payment cheque's payments are approved or rejected together (#1480,
#1481, spec #1477, ADR-0035). Part of THE cheques service; never commits.

`approve` takes any one payment on an Approval Pending Payment cheque and approves EVERY payment on it, in one
savepoint, so a failure on any of them leaves all of them, and the cheque, as they were:

* every line must name a payment and the lines must add up to the cheque amount within ₹5
  (`approval_rules.approval_problem`, C2), and every payment must wait at the step being approved
  (`approval_rules.decision_step_problem`);
* the tier comes from the CHEQUE amount (C3): L1 lands them all at Approved, or at CEO Pending when the
  cheque is over ₹50,000 (`approval_tiers.status_after_l1`); the CEO lands them at Approved;
* at Approved each payment moves straight on to Reconciliation Pending
  (`cheque_payments.move_to_reconciliation`), and the move of the last one issues the cheque, once
  (`status.issue`), all inside the same savepoint;
* each payment is saved with the flags bulk approval uses (`bulk_approval`): no notification commits
  and no PO is saved per payment mid-cheque. The PO terms are written here, one save per PO, and the
  caller sends the one notification after its commit.

The payment's own `validate` refuses an approval of a cheque payment made any other way
(`refuse_lone_approval`, `approval_rules.lone_approval_problem`): every save `approve` makes carries
`DECIDING_FLAG`, which a REST write cannot set.

`reject` (#1481) takes any one payment on an Approval Pending Payment cheque and, in one savepoint, runs THE reject
cascade `reject_cheque`: every payment Rejected with the reason as a comment, the PO terms written once
per PO, the cheque Cancelled with the reason in its history (it keeps its lines). Same locks, same flags.
A payment saved to Rejected any other way needs no refusal in `validate`: its own hook runs the same
cascade (`integrations/controllers/cheques.on_payment_rejected`), so no path rejects one alone.
Cancelling the cheque by hand (`status.cancel`, #1484) is `reject_cheque` too.

Endpoints: `api/payments/cheque_approval.py` (single L1 approve, single reject, the dialogs' reads),
`api/payments/project_payments.ceo_approve_payment` and `api/payments/bulk_actions` (bulk groups by
cheque). They check who asks, call this, commit, notify.
"""

import frappe
from frappe import _
from frappe.utils import flt, nowdate

from nirmaan_stack.services.approval_tiers import status_after_l1
from nirmaan_stack.services.ceo_hold.core import CEO_HOLD_STATUS
from nirmaan_stack.services.cheque_payments import is_cheque, move_to_reconciliation
from nirmaan_stack.services.cheques.approval_rules import (
    ApprovalLine,
    approval_problem,
    decision_step_problem,
    is_approval,
    lone_approval_problem,
)
from nirmaan_stack.services.cheques.lines import cheques_naming
from nirmaan_stack.services.cheques.payment_rules import CHEQUE_REFUSES_PAY, cheque_payment_problem, no_cheque_problem
from nirmaan_stack.services.cheques.rules import (
    CANCELLED,
    CHEQUE_TYPE_PAYMENT,
    ISSUED,
    PAYMENT_DOCTYPE,
    PAYMENT_REJECTED,
    PENDING,
    PO_DOCTYPE,
)
from nirmaan_stack.services.cheques.writer import CHEQUES, CHEQUES_CHANGED_EVENT, history_row
from nirmaan_stack.services.po_terms import TERM_UPDATED, sync_term_in_memory
from nirmaan_stack.services.settlement import (
    STATUS_APPROVED,
    STATUS_CEO_PENDING,
    STATUS_PAID,
    STATUS_RECONCILIATION_PENDING,
    STATUS_REQUESTED,
)

#: Who approves: the L1 approver (Admin) or the CEO.
STAGE_L1 = "l1"
STAGE_CEO = "ceo"
#: Per stage: the step the payments wait at, and the date the approval stamps.
_STAGES = {
    STAGE_L1: (STATUS_REQUESTED, "approval_date"),
    STAGE_CEO: (STATUS_CEO_PENDING, "ceo_approval_date"),
}
#: Set on every payment save a cheque's decision makes, naming the cheque. Only server code sets it.
DECIDING_FLAG = "cheque_decision"
#: A Payment cheque whose payments are still live: rejecting one of them rejects them all and cancels it.
LIVE_STATUSES = (PENDING, ISSUED)


def cheque_of(payment_name: str) -> str | None:
    """The Payment cheque a decision on `payment_name` covers: the Approval Pending, not Old-type Payment cheque
    whose lines name it. Keyed on the lines, not on the payment's `cheque` link. None for an Online
    payment, an Old-type cheque's payment, a payment whose line has come off, and a cheque past Approval Pending.

    ⚠️ PENDING ONLY. A Payment cheque's payments wait for approval only while it is Approval Pending (every new
    cheque starts Approval Pending since #1482)."""
    return _payment_cheque_of(payment_name, (PENDING,))


def live_cheque_of(payment_name: str) -> str | None:
    """The Payment cheque a rejection of `payment_name` cascades over: the Approval Pending or Issued, not
    Old-type Payment cheque whose lines name it, else None. Its payments are still live, so rejecting
    one rejects them all (`reject_cheque`)."""
    return _payment_cheque_of(payment_name, LIVE_STATUSES)


def held_by_a_live_cheque(payment_name: str) -> bool:
    """Is `payment_name` a line of an Approval Pending or Issued Cheque, of any type? Such a payment's money has not
    left the bank: its cheque waits to clear (`payment_steps`, the reject of one at Reconciliation Pending)."""
    return bool(frappe.db.sql(
        f"""SELECT 1 FROM "tabCheque Line" l JOIN "tab{CHEQUES}" c ON c.name = l.parent
            WHERE l.parenttype = %(cheques)s AND l.payment_doctype = %(doctype)s AND l.payment_name = %(payment)s
              AND c.status IN %(statuses)s LIMIT 1""",
        {"cheques": CHEQUES, "doctype": PAYMENT_DOCTYPE, "payment": payment_name, "statuses": LIVE_STATUSES},
    ))


def pay_alone_problem(payment_name: str) -> str | None:
    """Why `payment_name` may not be paid on its own, or None (story 45, #1552): it is a cheque payment, paid
    only when its cheque's bank line clears every payment on it (`status.clear`). Old-type cheques too
    (ADR-0035 Amendment B). The refusal names the cheque it is on (one not Cancelled first); one on no cheque
    gets the no-cheque refusal (`payment_rules.no_cheque_problem`). Asked by the user-facing ways to pay one
    payment, the import's hand settle and the payments screen's fulfil, so they refuse by name before the
    payment's own save would (`payment_mode.validate_paid_by_clear`)."""
    row = frappe.db.get_value(PAYMENT_DOCTYPE, payment_name, ["mode_of_payment", "status"], as_dict=True)
    if not row or not is_cheque(row):
        return None
    cheques = sorted(cheques_naming(PAYMENT_DOCTYPE, [payment_name]), key=lambda r: r.status == CANCELLED)
    if not cheques:
        return no_cheque_problem(payment_name, status=(row.status or "").strip(), on_a_cheque=False)
    return cheque_payment_problem(payment_name, CHEQUE_REFUSES_PAY, is_cheque=True, cheque_no=cheques[0].cheque_no)


def _payment_cheque_of(payment_name: str, statuses: tuple) -> str | None:
    """The oldest not Old-type Payment cheque at one of `statuses` whose lines name `payment_name`, else None."""
    return next(
        (r.cheque for r in cheques_naming(PAYMENT_DOCTYPE, [payment_name])
         if r.status in statuses and r.cheque_type == CHEQUE_TYPE_PAYMENT and not r.old_type),
        None,
    )


def _payment_of(row) -> str | None:
    return row.payment_name if row.payment_doctype == PAYMENT_DOCTYPE and row.payment_name else None


def approval_lines(doc) -> list[ApprovalLine]:
    return [
        ApprovalLine(payment=_payment_of(row), record=row.record_name, amount=flt(row.amount))
        for row in doc.get("lines") or []
    ]


def approve(payment_name: str, *, stage: str, user: str) -> dict:
    """Approve every payment on the Payment cheque `payment_name` is on, at `stage` (STAGE_L1 or
    STAGE_CEO). Returns `{cheque, cheque_no, payments, status, issued}`: the payments, where they
    landed (CEO Pending, or Reconciliation Pending once approved), and whether the cheque was Issued.

    Refuses with a validation error naming the reason (and changes nothing) when the payment is on no
    Approval Pending Payment cheque, a line has no payment, the lines do not add up, a payment is at another step
    or on a CEO Hold project. Any failure rolls back every payment and the cheque. Never commits.
    """
    if stage not in _STAGES:
        raise ValueError(f"unknown stage {stage!r}")
    cheque = cheque_of(payment_name)
    if not cheque:
        frappe.throw(_("Payment {0} is on no Payment cheque.").format(payment_name))
    savepoint = f"cheque_decide_{frappe.generate_hash(length=10)}"
    frappe.db.savepoint(savepoint)
    try:
        result = _approve(cheque, stage=stage, user=user)
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    frappe.db.release_savepoint(savepoint)
    return result


def _approve(cheque: str, *, stage: str, user: str) -> dict:
    doc = frappe.get_doc(CHEQUES, cheque, for_update=True)
    if doc.status != PENDING:
        frappe.throw(_("Cheque {0} is {1}: its payments have already been decided.").format(doc.cheque_no, doc.status))
    problem = approval_problem(cheque_no=doc.cheque_no, amount=doc.amount, lines=approval_lines(doc))
    if problem:
        frappe.throw(_(problem))

    payments = sorted({_payment_of(row) for row in doc.lines})
    rows = lock_payments(payments)
    source, date_field = _STAGES[stage]
    problem = decision_step_problem([(p, rows[p].status) for p in payments], expected=source) or _hold_problem(rows)
    if problem:
        frappe.throw(_(problem))

    # C3: the cheque amount, not each payment's, picks L1 or the CEO.
    target = status_after_l1(doc.amount) if stage == STAGE_L1 else STATUS_APPROVED
    today = nowdate()
    for name in payments:
        pay = frappe.get_doc(PAYMENT_DOCTYPE, name)
        pay.status = target
        pay.set(date_field, today)
        # No commit mid-cheque: the notification and PO-term branches of the payment's hooks stay out
        # (as for bulk approve), and the TDS a Work Order cheque owes is recorded by the move below.
        pay.flags.bulk_approval = True
        pay.flags[DECIDING_FLAG] = cheque
        pay.save(ignore_permissions=True)

    if target == STATUS_APPROVED:
        for name in payments:
            # Raises on failure, rolling the whole cheque back. The last move issues the cheque.
            if not move_to_reconciliation(name, sync_po_term=False):
                frappe.throw(_("Payment {0} could not be moved on to Reconciliation Pending.").format(name))
    landed = STATUS_RECONCILIATION_PENDING if target == STATUS_APPROVED else target
    write_po_terms(rows, landed)
    issued = frappe.db.get_value(CHEQUES, cheque, "status") != PENDING
    return {
        "cheque": cheque, "cheque_no": doc.cheque_no, "payments": payments, "status": landed, "issued": issued,
    }


def reject(payment_name: str, *, stage: str, reason: str, user: str) -> dict:
    """Reject every payment on the Approval Pending Payment cheque `payment_name` is on, at `stage` (STAGE_L1 or
    STAGE_CEO), and cancel the cheque, with `reason` on each payment and in the cheque's history.
    Returns what `reject_cheque` returns.

    Refuses (and changes nothing) without a reason, when the payment is on no Approval Pending Payment cheque, or
    when it no longer waits at `stage` (the screen was stale). The other payments may wait at either
    step: rejecting is never unsafe. One savepoint; never commits.
    """
    if stage not in _STAGES:
        raise ValueError(f"unknown stage {stage!r}")
    reason = (reason or "").strip()
    if not reason:
        frappe.throw(_("A reason is required to reject a cheque's payments."))
    cheque = cheque_of(payment_name)
    if not cheque:
        frappe.throw(_("Payment {0} is on no Payment cheque.").format(payment_name))
    savepoint = f"cheque_decide_{frappe.generate_hash(length=10)}"
    frappe.db.savepoint(savepoint)
    try:
        status = frappe.db.get_value(PAYMENT_DOCTYPE, payment_name, "status", for_update=True)
        expected = _STAGES[stage][0]
        if status != expected:
            frappe.throw(_("Payment {0} is {1}, not {2}.").format(payment_name, status, expected))
        result = reject_cheque(cheque, reason=reason, user=user)
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    frappe.db.release_savepoint(savepoint)
    return result


def rejected_alone_note(payment_name: str) -> str:
    """The reason the cascade writes when one payment was saved to Rejected outside the approval screens
    (no reason was asked for)."""
    return f"Payment {payment_name} was rejected, so every payment on the cheque is rejected and the cheque is cancelled."


def reject_cheque(cheque: str, *, reason: str, user: str) -> dict:
    """THE reject cascade: every payment on the Approval Pending or Issued Payment cheque `cheque` becomes
    Rejected, with `reason` on each (a "Rejected: ..." comment), and the cheque becomes Cancelled, with
    `reason` on its history row. The cheque keeps its lines: it stays the record of what it would have
    paid. Payments already Rejected are left as they are. Returns `{cheque, cheque_no, payments,
    rejected, status}`.

    Called by `reject` (the approval screens), by the payment's own hook when one payment on the cheque is
    saved to Rejected any other way (`integrations/controllers/cheques.on_payment_rejected`), and by
    cancelling the cheque by hand (`status.cancel`, #1484). It runs inside the caller's savepoint and
    NEVER COMMITS: each payment is saved with `bulk_approval` (no notification or PO save mid-cheque) and
    `DECIDING_FLAG` (so its own hook does not cascade again); the PO terms are written once per PO here.
    """
    doc = frappe.get_doc(CHEQUES, cheque, for_update=True)
    if doc.status not in LIVE_STATUSES:
        frappe.throw(_("Cheque {0} is {1}: its payments can no longer be rejected.").format(doc.cheque_no, doc.status))
    payments = sorted({p for p in (_payment_of(row) for row in doc.lines) if p})
    rows = lock_payments(payments) if payments else {}
    paid = [name for name in payments if rows[name].status == STATUS_PAID]
    if paid:
        frappe.throw(_("Payment {0} on cheque {1} is Paid, so it cannot be rejected.").format(paid[0], doc.cheque_no))

    rejected = [name for name in payments if rows[name].status != PAYMENT_REJECTED]
    for name in rejected:
        pay = frappe.get_doc(PAYMENT_DOCTYPE, name)
        pay.status = PAYMENT_REJECTED
        pay.flags.bulk_approval = True
        pay.flags[DECIDING_FLAG] = cheque
        pay.save(ignore_permissions=True)
        pay.add_comment("Comment", text=_("Rejected: {0}").format(reason))
    write_po_terms({name: rows[name] for name in rejected}, PAYMENT_REJECTED)

    doc.append("status_history", history_row(doc.status, CANCELLED, user, reason))
    doc.status = CANCELLED
    doc.save(ignore_permissions=True)
    frappe.publish_realtime(CHEQUES_CHANGED_EVENT, {"cheques": [cheque]}, after_commit=True)
    return {
        "cheque": cheque, "cheque_no": doc.cheque_no, "payments": payments, "rejected": rejected, "status": CANCELLED,
    }


def lock_payments(payments: list[str]) -> dict:
    """Row-lock the cheque's POs, then its payments (each in name order, as bulk approve locks a PO
    before its payments, so the two never deadlock). Returns `{payment: row}` read under the lock."""
    parents = frappe.get_all(
        PAYMENT_DOCTYPE, filters={"name": ["in", payments]}, fields=["document_type", "document_name"]
    )
    pos = sorted({p.document_name for p in parents if p.document_type == PO_DOCTYPE and p.document_name})
    if pos:
        frappe.db.sql(f'SELECT name FROM "tab{PO_DOCTYPE}" WHERE name IN %(pos)s ORDER BY name FOR UPDATE', {"pos": tuple(pos)})
    return {
        r.name: r
        for r in frappe.db.sql(
            f"""SELECT name, status, project, document_type, document_name, on_hold FROM "tab{PAYMENT_DOCTYPE}"
                WHERE name IN %(names)s ORDER BY name FOR UPDATE""",
            {"names": tuple(payments)},
            as_dict=True,
        )
    }


def _hold_problem(rows: dict) -> str | None:
    """A payment on a CEO Hold project holds the whole cheque (bulk approve skips such rows)."""
    projects = sorted({r.project for r in rows.values() if r.project})
    held = set(frappe.get_all("Projects", filters={"name": ["in", projects], "status": CEO_HOLD_STATUS}, pluck="name"))
    for name in sorted(rows):
        if rows[name].project in held:
            return f"Payment {name}'s project is on CEO Hold, so the cheque cannot be approved."
    return None


def write_po_terms(rows: dict, status: str) -> None:
    """Mirror `status` onto each payment's PO term, one save per PO (the payment hooks skipped it)."""
    by_po: dict[str, set[str]] = {}
    for name, row in rows.items():
        if row.document_type == PO_DOCTYPE and row.document_name:
            by_po.setdefault(row.document_name, set()).add(name)
    for po, names in sorted(by_po.items()):
        po_doc = frappe.get_doc(PO_DOCTYPE, po)
        if TERM_UPDATED in [sync_term_in_memory(po_doc, name, status) for name in sorted(names)]:
            po_doc.save(ignore_permissions=True)


def describe(payment_name: str, *, stage: str) -> dict | None:
    """What the approval dialog shows for a payment on a Payment cheque, or None when it is on none:
    the cheque, its lines (payment or None, PO, project, amount, payment status), where an L1 approval
    lands its payments (`status_after_l1`, from the cheque amount), and why it cannot be approved at
    `stage` yet (`problem`, None when it can). Reads only."""
    cheque = cheque_of(payment_name)
    if not cheque:
        return None
    doc = frappe.get_doc(CHEQUES, cheque)
    payments = [p for p in (_payment_of(row) for row in doc.lines) if p]
    pay_rows = {
        r.name: r
        for r in frappe.get_all(PAYMENT_DOCTYPE, filters={"name": ["in", payments]}, fields=["name", "status", "project"])
    } if payments else {}
    projects = {row.project for row in doc.lines if row.project}
    project_names = dict(frappe.get_all(
        "Projects", filters={"name": ["in", sorted(projects)]}, fields=["name", "project_name"], as_list=True
    )) if projects else {}

    problem = approval_problem(cheque_no=doc.cheque_no, amount=doc.amount, lines=approval_lines(doc))
    if not problem and stage in _STAGES:
        problem = decision_step_problem(
            [(p, pay_rows[p].status if p in pay_rows else None) for p in payments], expected=_STAGES[stage][0]
        )
    return {
        "cheque": cheque,
        "cheque_no": doc.cheque_no,
        "bank": doc.bank_name if doc.bank_name else doc.bank,
        "status": doc.status,
        "amount": flt(doc.amount),
        "vendor": doc.vendor,
        "vendor_name": frappe.db.get_value("Vendors", doc.vendor, "vendor_name") if doc.vendor else doc.payee_name,
        "status_after_l1": status_after_l1(doc.amount),
        "problem": problem,
        "lines": [
            {
                "payment": _payment_of(row),
                "record": row.record_name,
                "project": row.project,
                "project_name": project_names.get(row.project),
                "amount": flt(row.amount),
                "status": pay_rows[_payment_of(row)].status if _payment_of(row) in pay_rows else None,
            }
            for row in doc.lines
        ],
    }


def refuse_lone_approval(pay) -> None:
    """The payment's own `validate` (story 32): refuse an approval of a cheque payment that is not its
    cheque's decision, so no path (the browser's old status write, REST, Desk) approves one alone, skips
    the CEO the cheque amount needs, or approves a cheque whose lines are short or unpaid."""
    before = pay.get_doc_before_save()
    if not before or not is_approval(before.status, pay.status):
        return
    cheque = cheque_of(pay.name)
    if not cheque:
        return
    doc = frappe.get_doc(CHEQUES, cheque)
    deciding = pay.flags.get(DECIDING_FLAG) == cheque
    problem = lone_approval_problem(
        cheque_no=doc.cheque_no,
        payment_lines=len(doc.lines),
        deciding=deciding,
        from_status=before.status,
        to_status=pay.status,
        cheque_amount=doc.amount,
    )
    if not problem and not deciding:
        problem = approval_problem(cheque_no=doc.cheque_no, amount=doc.amount, lines=approval_lines(doc))
    if problem:
        frappe.throw(_(problem), title=_("Approve the Whole Cheque"))
