# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Cheque's status, changed by hand (#1412, spec #1407). Part of THE cheques service; never commits.

A Cheque moves between Issued, Cleared and Cancelled in any direction. Each move writes one
`Cheque Status History` row (from, to, who, when, note). The rules:

* a Cheque already at the status asked for does not move;
* Cancel needs a note;
* Cancel is refused while any line's Project Payment is Paid (the bank has settled that cheque);
* leaving Cancelled is refused while a line's payment is Rejected (a backfilled Cheque whose payments
  were all Rejected keeps them as lines, #1419), sits on another live Cheque, or has left this one
  (switched back to Online, or put on another Cheque).

Cancel touches no payment: a payment at Reconciliation Pending stays there, and the user reverts it
or puts it on a new Cheque by hand. A Cheque moves no money figure, so nothing is recomputed.

The bank import never calls this: only people decide a cheque is Cleared.

`move_problem` is pure. `change_status` and `change_statuses` row-lock and write; the endpoints in
`api/cheques/cheque_status.py` check who is asking, then commit and publish.
"""

from dataclasses import dataclass, field

import frappe
from frappe import _

from nirmaan_stack.services.cheque_payments import is_cheque
from nirmaan_stack.services.cheques.lines import live_cheques_of
from nirmaan_stack.services.cheques.rules import CANCELLED, CHEQUE_STATUSES, PAYMENT_DOCTYPE, PAYMENT_REJECTED
from nirmaan_stack.services.cheques.writer import CHEQUES, history_row
from nirmaan_stack.services.settlement import STATUS_PAID, STATUS_RECONCILIATION_PENDING


@dataclass(frozen=True)
class LinePayment:
    """What the status rules need to know about one line's payment."""

    doctype: str
    name: str
    status: str | None = None
    #: The Cheque this payment now names (Project Payments only; None for an Online payment).
    on_cheque: str | None = None
    #: `{cheque, cheque_no, status}` of another Cheque, not Cancelled, it also sits on.
    elsewhere: dict | None = None


@dataclass(frozen=True)
class MoveFacts:
    name: str
    status: str
    payments: list[LinePayment] = field(default_factory=list)


def target_problem(to_status: str) -> str | None:
    if to_status not in CHEQUE_STATUSES:
        return "Choose Issued, Cleared or Cancelled."
    return None


def note_problem(to_status: str, note: str | None) -> str | None:
    if to_status == CANCELLED and not (note or "").strip():
        return "Write a note saying why the cheque is cancelled."
    return None


def move_problem(facts: MoveFacts, to_status: str) -> str | None:
    """Why this Cheque cannot move to `to_status`, as a short reason ("already Cleared"), or None.

    The note is checked apart (`note_problem`), since one note covers a whole bulk change.
    """
    if facts.status == to_status:
        return f"already {to_status}"
    if to_status == CANCELLED:
        paid = [p.name for p in facts.payments if p.doctype == PAYMENT_DOCTYPE and p.status == STATUS_PAID]
        if paid:
            return f"payment {', '.join(paid)} is Paid"
    if facts.status == CANCELLED:
        for p in facts.payments:
            if p.doctype == PAYMENT_DOCTYPE and p.status == PAYMENT_REJECTED:
                return f"payment {p.name} is Rejected"
        for p in facts.payments:
            if p.elsewhere:
                return f"payment {p.name} is already on cheque {p.elsewhere['cheque_no']} ({p.elsewhere['status']})"
        for p in facts.payments:
            if p.doctype == PAYMENT_DOCTYPE and p.on_cheque != facts.name:
                return f"payment {p.name} has left this cheque" + (
                    f" (it is on {p.on_cheque} now)" if p.on_cheque else " (it is Online now)"
                )
    return None


def reconciliation_pending(facts: MoveFacts) -> list[str]:
    """The line payments at Reconciliation Pending: Cancel leaves them there, so the user is warned."""
    return [
        p.name for p in facts.payments
        if p.doctype == PAYMENT_DOCTYPE and p.status == STATUS_RECONCILIATION_PENDING
    ]


def move_facts(doc, *, lock: bool) -> MoveFacts:
    """Read what the rules need about `doc`'s line payments. `lock` row-locks the Project Payments,
    so a payment cannot turn Paid (or move to another Cheque) while this Cheque is being cancelled."""
    by_doctype: dict[str, list[str]] = {}
    for row in doc.get("lines") or []:
        if row.payment_doctype and row.payment_name:
            by_doctype.setdefault(row.payment_doctype, []).append(row.payment_name)

    payments = []
    for doctype, names in sorted(by_doctype.items()):
        elsewhere = live_cheques_of(doctype, names, exclude=doc.name)
        rows = {}
        if doctype == PAYMENT_DOCTYPE:
            rows = {
                r.name: r
                for r in frappe.db.sql(
                    f"""SELECT name, status, mode_of_payment, cheque FROM "tab{PAYMENT_DOCTYPE}"
                        WHERE name IN %(names)s ORDER BY name {"FOR UPDATE" if lock else ""}""",
                    {"names": tuple(sorted(set(names)))},
                    as_dict=True,
                )
            }
        for name in names:
            row = rows.get(name)
            payments.append(LinePayment(
                doctype=doctype,
                name=name,
                status=(row.status or "").strip() if row else None,
                on_cheque=row.cheque if row and is_cheque(row) else None,
                elsewhere=elsewhere.get(name),
            ))
    return MoveFacts(name=doc.name, status=doc.status, payments=payments)


def change_status(name: str, to_status: str, *, user: str, note: str | None = None):
    """Move one Cheque to `to_status` and write its history row. Returns the saved Cheque.

    Re-reads the Cheque under a row lock and refuses, naming the cheque, a move the rules forbid.
    """
    for problem in (target_problem(to_status), note_problem(to_status, note)):
        if problem:
            frappe.throw(_(problem))
    doc = frappe.get_doc(CHEQUES, name, for_update=True)
    problem = move_problem(move_facts(doc, lock=True), to_status)
    if problem:
        frappe.throw(_("Cheque {0} cannot be moved to {1}: {2}.").format(doc.cheque_no, to_status, problem))
    doc.append("status_history", history_row(doc.status, to_status, user, note))
    doc.status = to_status
    doc.save(ignore_permissions=True)
    return doc


def change_statuses(names, to_status: str, *, user: str, note: str | None = None, dry_run: bool = False) -> dict:
    """Move each of `names` to `to_status`, skipping the ones that cannot move.

    Returns `{changed: [{cheque, cheque_no, from_status, reconciliation_pending}], skipped: [{cheque,
    cheque_no, reason}]}`; `reconciliation_pending` lists the payments a Cancel leaves there. Each
    Cheque moves in its own savepoint, so one refusal does not undo the others. `dry_run` checks and
    writes nothing (the bulk dialog's preview); it does not ask for the Cancel note.
    """
    problem = target_problem(to_status) or (None if dry_run else note_problem(to_status, note))
    if problem:
        frappe.throw(_(problem))

    changed, skipped = [], []
    for name in dict.fromkeys(n for n in names or [] if n):
        if not frappe.db.exists(CHEQUES, name):
            skipped.append({"cheque": name, "cheque_no": None, "reason": "not found"})
            continue
        doc = frappe.get_doc(CHEQUES, name, for_update=not dry_run)
        facts = move_facts(doc, lock=not dry_run)
        reason = move_problem(facts, to_status)
        if not reason and not dry_run:
            savepoint = f"cheque_status_{frappe.generate_hash(length=8)}"
            frappe.db.savepoint(savepoint)
            try:
                doc.append("status_history", history_row(doc.status, to_status, user, note))
                doc.status = to_status
                doc.save(ignore_permissions=True)
            except frappe.ValidationError as e:
                frappe.db.rollback(save_point=savepoint)
                reason = str(e) or "refused"
        if reason:
            skipped.append({"cheque": name, "cheque_no": doc.cheque_no, "reason": reason})
        else:
            changed.append({
                "cheque": name,
                "cheque_no": doc.cheque_no,
                "from_status": facts.status,
                "reconciliation_pending": reconciliation_pending(facts) if to_status == CANCELLED else [],
            })
    return {"changed": changed, "skipped": skipped}
