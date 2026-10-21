# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Rejected or deleted payment drops off its Cheque (#1413, spec #1407). Part of THE cheques
service; never commits.

When a Project Payment, Project Expense or Non Project Expense is deleted, its line comes off every
Cheque that lists it, with a history note. A Cheque left with no lines and no description becomes
Cancelled, with a history row saying why. One left with other lines, or with a description, keeps its
status.

A REJECTED payment comes off Old-type cheques only (#1481, spec #1477). On a Payment cheque a rejection
rejects every payment and cancels the cheque, which keeps its lines (`decide.reject_cheque`). An Old-type
cheque's own cancel runs that same cascade, and keeps its lines too: the payments it rejects stay on it
(spec #1514), so a bank line that turns up later still finds what the cheque paid.

A Work Order comes off a Security Deposit cheque once, through the patch
`v3_0.drop_work_order_deposit_lines` (`take_work_orders_off_deposit`, spec #1514): Work Orders have no cheques.

Called from the lifecycle hooks: the payment's `on_update` (into Rejected, through
`controllers/cheques.on_payment_rejected`) and `on_trash`, and each expense doctype's `on_trash`.

⚠️ ON DELETE IT MUST RUN IN `on_trash`. Frappe checks links AFTER `on_trash`
(`frappe.model.delete_doc`), and `Cheque Line.payment_name` is a Dynamic Link, so a line left
standing would refuse the delete ("linked with Cheques").

⚠️ IT NEVER COMMITS. Bulk reject saves each payment inside its group's savepoint
(`api/payments/bulk_actions._process_group`); a commit here would end that isolation.

A Cheque moves no money figure, so nothing is recomputed. The payment itself is left alone: a
Rejected Cheque payment keeps its mode and its `cheque` link (a Cheque payment always has a Cheque
behind it), it is just no longer one of that Cheque's lines.
"""

import frappe

from nirmaan_stack.services.cheques.rules import (
    CANCELLED,
    CHEQUE_TYPE_SECURITY_DEPOSIT,
    PAYMENT_DOCTYPE,
    WORK_ORDER_DOCTYPE,
)
from nirmaan_stack.services.cheques.writer import CHEQUES, history_row

DELETED = "deleted"
EMPTIED_NOTE = "No lines and no description are left, so the cheque is Cancelled."


def status_after_drop(status: str, *, lines_left: int, description: str | None) -> str | None:
    """The status a Cheque moves to once a line has dropped off, or None when it keeps its own.

    Pure. A Cheque left with no lines and no description pays for nothing it can name, so it is
    Cancelled; a Cancelled one stays as it is.
    """
    if lines_left == 0 and not (description or "").strip() and status != CANCELLED:
        return CANCELLED
    return None


def drop_note(noun: str, name: str, why: str) -> str:
    """The history note for a line that dropped off ("Payment X was Rejected, so its line was removed.")."""
    return f"{noun} {name} was {why}, so its line was removed."


def drop_off_cheques(
    payment_doctype: str, payment_name: str, *, why: str, user: str, old_type_only: bool = False,
    keep_on: str | None = None,
) -> list[str]:
    """Take the lines naming `payment_name` (a `payment_doctype` record) off every Cheque that lists
    them, Cancelled ones included, each with a history note. Returns the Cheques changed.

    `why` is `rules.PAYMENT_REJECTED` or DELETED. A rejection passes `old_type_only`: a Payment cheque
    keeps its lines when its payments are rejected (#1481, `decide.reject_cheque`), so only Old-type
    cheques drop the line. `keep_on` names a Cheque the line stays on: the one whose cancel rejected the
    payment (`decide.reject_cheque` saves it under `DECIDING_FLAG`, and saves that Cheque itself after).
    Each Cheque is re-read under its row lock and saved through the document, so its `validate` rules and
    `track_changes` run.
    """
    names = sorted(set(frappe.get_all(
        "Cheque Line",
        filters={"parenttype": CHEQUES, "payment_doctype": payment_doctype, "payment_name": payment_name},
        pluck="parent",
    )))
    if old_type_only and names:
        names = sorted(frappe.get_all(CHEQUES, filters={"name": ["in", names], "old_type": 1}, pluck="name"))
    names = [name for name in names if name != keep_on]
    noun = "Payment" if payment_doctype == PAYMENT_DOCTYPE else "Expense"
    for name in names:
        doc = frappe.get_doc(CHEQUES, name, for_update=True)
        kept = [
            row for row in doc.get("lines") or []
            if (row.payment_doctype, row.payment_name) != (payment_doctype, payment_name)
        ]
        doc.set("lines", kept)
        doc.append("status_history", history_row(doc.status, doc.status, user, drop_note(noun, payment_name, why)))
        to_status = status_after_drop(doc.status, lines_left=len(kept), description=doc.description)
        if to_status:
            doc.append("status_history", history_row(doc.status, to_status, user, EMPTIED_NOTE))
            doc.status = to_status
        doc.save(ignore_permissions=True)
    return names


def work_orders_off_note(work_orders: list[str]) -> str:
    """The history note for Work Orders taken off a deposit cheque (spec #1514)."""
    noun = "Work Order" if len(work_orders) == 1 else "Work Orders"
    return f"{noun} {', '.join(work_orders)} taken off: Work Orders have no cheques."


def take_work_orders_off_deposit(name: str, *, user: str) -> list[str]:
    """Take every Work Order line off Security Deposit cheque `name`, with one history note, and return the
    Work Orders taken off (none: nothing is written). Spec #1514, ADR-0035 Amendment A: a deposit secures POs
    only.

    The cheque keeps its status even when no line is left: the paper is still held until it comes back, and
    a deposit securing nothing is a valid one (`status_after_drop` is not asked). Re-read under its row lock
    and saved through the document, so its `validate` rules and `track_changes` run. A deposit pays nothing,
    so no payment is touched and nothing is recomputed.
    """
    doc = frappe.get_doc(CHEQUES, name, for_update=True)
    if doc.cheque_type != CHEQUE_TYPE_SECURITY_DEPOSIT:
        return []
    lines = doc.get("lines") or []
    work_orders = [row.record_name for row in lines if row.record_doctype == WORK_ORDER_DOCTYPE]
    if not work_orders:
        return []
    doc.set("lines", [row for row in lines if row.record_doctype != WORK_ORDER_DOCTYPE])
    doc.append("status_history", history_row(doc.status, doc.status, user, work_orders_off_note(work_orders)))
    doc.save(ignore_permissions=True)
    return work_orders
