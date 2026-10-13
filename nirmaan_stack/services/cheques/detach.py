# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Rejected or deleted payment drops off its Cheque (#1413, spec #1407). Part of THE cheques
service; never commits.

A Cheque lists only live payments. When a Project Payment is Rejected or deleted, or a Project
Expense or Non Project Expense is deleted, its line comes off every Cheque that lists it, with a
history note. A Cheque left with no lines and no description becomes Cancelled, with a history row
saying why. One left with other lines, or with a description, keeps its status.

Called from the lifecycle hooks: the payment's `on_update` (into Rejected) and `on_trash`, and each
expense doctype's `on_trash`.

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

from nirmaan_stack.services.cheques.rules import CANCELLED, PAYMENT_DOCTYPE
from nirmaan_stack.services.cheques.writer import CHEQUES, history_row

REJECTED = "Rejected"
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


def drop_off_cheques(payment_doctype: str, payment_name: str, *, why: str, user: str) -> list[str]:
    """Take the lines naming `payment_name` (a `payment_doctype` record) off every Cheque that lists
    them, Cancelled ones included, each with a history note. Returns the Cheques changed.

    `why` is REJECTED or DELETED. Each Cheque is re-read under its row lock and saved through the
    document, so its `validate` rules and `track_changes` run.
    """
    names = sorted(set(frappe.get_all(
        "Cheque Line",
        filters={"parenttype": CHEQUES, "payment_doctype": payment_doctype, "payment_name": payment_name},
        pluck="parent",
    )))
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
