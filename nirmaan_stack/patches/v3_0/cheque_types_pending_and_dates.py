# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Bring every existing Cheque into the spec #1477 shape (#1478, ADR-0035).

WHY THIS PATCH EXISTS
    Spec #1477 gives every Cheque a type and makes a Payment cheque's status its payments' status
    (Pending while they wait for approval, Issued once approved, Cleared once Paid, Cancelled when
    Rejected), with an issue date and a clearance date. Cheques recorded under spec #1407 moved freely
    between Issued, Cleared and Cancelled whatever their payments did, so their statuses are worked out
    again here and their dates filled in.

WHAT IT DOES, PER CHEQUE
    * Every Cheque becomes a Payment cheque (a Security Deposit cheque, which only the new rules make, is
      left alone).
    * A Cheque that pays Expenses, has no lines or is made out to a typed payee is flagged Old-type
      (`rules.old_type_reason`) and keeps its status and dates.
    * Every other status is worked out from its lines' payments (`rules.status_from_payments`). A line's
      payment counts only while it still names this Cheque: one that has left it (switched to Online, put
      on another Cheque) says nothing about it.
    * The issue date is the payments' last approval date (Acc or CEO), for an Issued or Cleared cheque;
      the clearance date is their last payment date, for a Cleared one.
    * A Cleared cheque whose payments are not all Paid goes back to Issued (or Pending), with a history
      note naming the unpaid payments: Cleared now means the bank paid it.
    * A Cancelled cheque stays Cancelled. Under spec #1407 Cancel touched no payment, so a payment may
      still be live on it; reviving the cheque would bring back paper someone tore up. Such a cheque is
      listed for a person to look at.
    * A cheque whose status cannot be worked out (no payment on its lines still names it, or a payment
      status the rule does not know) keeps its status and is listed.
    Each Cheque is written in its own savepoint; one the `validate` controller refuses is listed with
    the reason, and the rest are still written.

IDEMPOTENT
    The values are worked out from the payments every time, and a Cheque already holding them is not
    saved, so a second run writes nothing.

HOOKS
    Written through the cheques service (`writer.reshape_old_cheque`): the Cheque is saved through the
    document, so its `validate` runs and its history and Version rows are written. No payment is
    written, so nothing is recomputed.

Counts: check them on a fresh production copy before release (the local copy holds one Cheque).

The `patches.txt` line sits under [post_model_sync], after the sync that adds the new Cheques fields.
"""

from dataclasses import dataclass

import frappe

from nirmaan_stack.services.cheques.rules import (
    CANCELLED,
    CHEQUE_TYPE_PAYMENT,
    CHEQUE_TYPE_SECURITY_DEPOSIT,
    CLEARED,
    ISSUED,
    PAYMENT_DOCTYPE,
    PAYMENT_REJECTED,
    old_type_reason,
    status_from_payments,
)
from nirmaan_stack.services.cheques.writer import CHEQUES, reshape_old_cheque
from nirmaan_stack.services.settlement import STATUS_PAID

PATCH = "cheque_types_pending_and_dates"
STATUS_NOTE = "Status worked out from its payments when cheque types came in."


def execute():
    if not frappe.db.has_column(CHEQUES, "cheque_type"):
        print(f"{PATCH}: Cheques.cheque_type absent, skipping")
        return
    result = migrate_cheques()
    frappe.db.commit()
    for line in summary(result):
        print(f"{PATCH}: {line}")
        frappe.logger("cheques").info(f"{PATCH}: {line}")


@dataclass(frozen=True)
class LinePayment:
    """What one line tells about its Cheque: its payment's status, or None for no payment yet."""

    payment: str | None
    status: str | None
    approval_date: str | None = None
    payment_date: str | None = None


def migrate_cheques(cheques: list[str] | None = None) -> dict:
    """Bring every Cheque -- or only `cheques`, which is what the tests pass so they never touch a Cheque
    they did not plant -- into the spec #1477 shape. Commits nothing.

    Returns `{changed: [{cheque, cheque_no, from_status, status, issue_date, clearance_date, note}],
    old_type: [{cheque, cheque_no, reason}], not_worked_out: [{cheque, cheque_no, status, reason}],
    failed: [{cheque, cheque_no, reason}]}`. A Cheque already in shape is in none of `changed`,
    `old_type` and `failed`.
    """
    result = {"changed": [], "old_type": [], "not_worked_out": [], "failed": []}
    filters = {"name": ["in", cheques]} if cheques is not None else {}
    if cheques is not None and not cheques:
        return result
    rows = frappe.get_all(
        CHEQUES,
        filters=filters,
        fields=["name", "cheque_no", "status", "cheque_type", "old_type", "vendor", "payee_name",
                "issue_date", "clearance_date"],
        order_by="name",
    )
    for row in rows:
        savepoint = f"cheque_types_{frappe.generate_hash(length=8)}"
        frappe.db.savepoint(savepoint)
        try:
            _migrate_one(row, result)
        except frappe.ValidationError as e:
            frappe.db.rollback(save_point=savepoint)
            result["failed"].append({"cheque": row.name, "cheque_no": row.cheque_no, "reason": str(e) or "refused"})
    return result


def _migrate_one(row, result: dict) -> None:
    if row.cheque_type == CHEQUE_TYPE_SECURITY_DEPOSIT:
        return  # made under the new rules: nothing old to bring into shape
    lines = frappe.get_all(
        "Cheque Line",
        filters={"parenttype": CHEQUES, "parent": row.name},
        fields=["line_type", "payment_doctype", "payment_name"],
        order_by="idx",
    )
    current = (row.cheque_type, row.old_type, row.status, _text(row.issue_date), _text(row.clearance_date))
    reason = old_type_reason(vendor=row.vendor, payee_name=row.payee_name, line_types=[l.line_type for l in lines])
    if reason:
        wanted = (CHEQUE_TYPE_PAYMENT, 1, row.status, current[3], current[4])
        if wanted != current:
            _write(row.name, wanted)
            if not row.old_type:
                result["old_type"].append({"cheque": row.name, "cheque_no": row.cheque_no, "reason": reason})
        return

    payments = _line_payments(row.name, lines)
    derived = status_from_payments([p.status for p in payments])
    problem = None
    if row.status == CANCELLED:
        live = [p for p in payments if p.payment and p.status != PAYMENT_REJECTED]
        if live:
            problem = "is Cancelled, but " + ", ".join(f"payment {p.payment} is {p.status}" for p in live)
        wanted = (CHEQUE_TYPE_PAYMENT, 0, CANCELLED, current[3], current[4])
    elif derived is None:
        problem = _why_not(payments)
        wanted = (CHEQUE_TYPE_PAYMENT, 0, row.status, current[3], current[4])
    else:
        wanted = (CHEQUE_TYPE_PAYMENT, 0, derived, _issue_date(derived, payments), _clearance_date(derived, payments))

    if problem:
        result["not_worked_out"].append({"cheque": row.name, "cheque_no": row.cheque_no, "status": row.status,
                                         "reason": problem})
    if wanted == current:
        return
    note = _note(row.status, wanted[2], payments)
    _write(row.name, wanted, note=note)
    result["changed"].append({
        "cheque": row.name, "cheque_no": row.cheque_no, "from_status": row.status, "status": wanted[2],
        "issue_date": wanted[3], "clearance_date": wanted[4], "note": note if row.status != wanted[2] else None,
    })


def _line_payments(cheque: str, lines) -> list[LinePayment]:
    """One entry per line that still says something about `cheque`: a line with no payment yet, or a line
    whose Project Payment still names this Cheque. A line whose payment has left the Cheque, or no longer
    exists, is left out."""
    names = [l.payment_name for l in lines if l.payment_doctype == PAYMENT_DOCTYPE and l.payment_name]
    found = {}
    if names:
        found = {
            p.name: p
            for p in frappe.get_all(
                PAYMENT_DOCTYPE,
                filters={"name": ["in", names]},
                fields=["name", "status", "cheque", "approval_date", "ceo_approval_date", "payment_date"],
            )
        }
    out = []
    for line in lines:
        if not line.payment_name:
            out.append(LinePayment(payment=None, status=None))
            continue
        p = found.get(line.payment_name)
        if p is None or p.cheque != cheque:
            continue
        approvals = [_text(d) for d in (p.approval_date, p.ceo_approval_date) if d]
        out.append(LinePayment(
            payment=p.name,
            status=(p.status or "").strip(),
            approval_date=max(approvals) if approvals else None,
            payment_date=_text(p.payment_date),
        ))
    return out


def _issue_date(status: str, payments: list[LinePayment]) -> str | None:
    """The payments' last approval date, for a cheque whose payments have been approved."""
    if status not in (ISSUED, CLEARED):
        return None
    dates = [p.approval_date for p in payments if p.approval_date]
    return max(dates) if dates else None


def _clearance_date(status: str, payments: list[LinePayment]) -> str | None:
    """The payments' last payment date, for a Cleared cheque."""
    if status != CLEARED:
        return None
    dates = [p.payment_date for p in payments if p.payment_date and p.status == STATUS_PAID]
    return max(dates) if dates else None


def _note(from_status: str, to_status: str, payments: list[LinePayment]) -> str:
    if from_status == CLEARED and to_status != CLEARED:
        unpaid = [p.payment for p in payments if p.payment and p.status != STATUS_PAID]
        return (
            f"Was Cleared, but its payments are not all Paid ({', '.join(unpaid) or 'a line has no payment'}): "
            f"Cleared now means the bank paid it, so it is {to_status}."
        )
    return STATUS_NOTE


def _why_not(payments: list[LinePayment]) -> str:
    if not payments:
        return "no payment on its lines still names it"
    odd = [f"payment {p.payment} is {p.status or 'blank'}" for p in payments if p.payment]
    return "its payments' statuses say nothing about it: " + ", ".join(odd)


def _write(name: str, wanted: tuple, *, note: str | None = None) -> None:
    _, old_type, status, issue_date, clearance_date = wanted
    reshape_old_cheque(
        name, status=status, old_type=bool(old_type), issue_date=issue_date, clearance_date=clearance_date,
        user=frappe.session.user, note=note,
    )


def _text(value) -> str | None:
    return str(value) if value else None


def summary(result: dict) -> list[str]:
    """What the patch prints: the counts, then every Cheque it changed, flagged Old-type, could not work
    out, or could not save, each with why."""
    def label(c):
        return f"{c['cheque']} ({c['cheque_no']})"

    lines = [
        f"{len(result['changed'])} Cheque(s) changed, {len(result['old_type'])} flagged Old-type, "
        f"{len(result['not_worked_out'])} left as they were for a person to check, {len(result['failed'])} refused"
    ]
    for c in result["changed"]:
        what = [f"{c['from_status']} -> {c['status']}" if c["from_status"] != c["status"] else f"stays {c['status']}"]
        if c["issue_date"]:
            what.append(f"issue date {c['issue_date']}")
        if c["clearance_date"]:
            what.append(f"clearance date {c['clearance_date']}")
        lines.append(f"changed {label(c)}: {', '.join(what)}")
    lines += [f"Old-type {label(c)}: {c['reason']}" for c in result["old_type"]]
    lines += [f"check {label(c)}: kept {c['status']}; {c['reason']}" for c in result["not_worked_out"]]
    lines += [f"refused {label(c)}: {c['reason']}" for c in result["failed"]]
    return lines
