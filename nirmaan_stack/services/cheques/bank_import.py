# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The cheque pass of Bulk Import Transactions: an ICICI statement line clears its Payment cheque (#1485,
spec #1477, ADR-0035). Part of THE cheques service; never commits.

An ICICI statement DEBIT whose cheque column is filled (`rules.bank_cheque_key`) is looked up against the
Payment cheques on ICICI Bank, not Old-type, by number with leading zeros ignored, and the one within ₹5
of the line's amount (`rules.pick_bank_cheque`) is cleared through THE clear (`status.clear`), with the
line's date as the clearance date and `CLEARED_BY_BANK_IMPORT`, in one savepoint per line:

* Issued: cleared, every payment Paid and linked to the line (one bank-match row each);
* Pending: the import approves the payments first (approval date = the line's date, history
  `rules.BANK_APPROVAL_NOTE`), then as Issued;
* Cancelled: Rejected -> Paid, history `rules.BANK_REVIVAL_NOTE`, and the review names any payment on its
  POs raised after the cancel (`double_payment_suspects`);
* Cleared by hand with no line yet: the line is linked to it and its payments, nothing is paid again
  (`status.link_bank_line`);
* number found, amount differs (or two cheques fit, or another line cleared it): nothing is settled and
  the line says why.

A Security Deposit cheque is never found. A refusal rolls the whole cheque back and the line shows why.
The caller is the import's match run (`api/outflow_import/review._guard_duplicates_only`), which persists
what this returns and commits; this module bypasses the import's one-record-at-Reconciliation-Pending
settle for cheque lines only.
"""

from dataclasses import asdict, dataclass

import frappe
from frappe.utils import flt

from nirmaan_stack.services.cheques.rules import (
    BANK_MATCH_BASIS,
    CANCELLED,
    CHEQUE_TYPE_PAYMENT,
    CLEARED,
    CLEARED_BY_BANK_IMPORT,
    ICICI_BANK,
    PAYMENT_DOCTYPE,
    PAYMENT_REJECTED,
    PO_DOCTYPE,
    DoublePayment,
    FoundCheque,
    already_linked_note,
    bank_cheque_key,
    bank_clear_failed_note,
    bank_cleared_note,
    bank_start,
    cheque_no_key,
    pick_bank_cheque,
)
from nirmaan_stack.services.cheques.status import clear, link_bank_line
from nirmaan_stack.services.cheques.writer import CHEQUES

BANK_LINE_DOCTYPE = "Outflow Import Row"


@dataclass(frozen=True)
class LineOutcome:
    """What the cheque pass did with one line: `settled` (money written, the line is Settled) or not, the
    note the review shows, and the statement to link to each paid payment after the caller's commit."""

    settled: bool
    note: str
    statement_file_url: str | None = None
    payments: tuple = ()


def find_payment_cheques(key: str) -> list[FoundCheque]:
    """The Payment cheques on ICICI Bank, not Old-type, whose number compares equal to `key`."""
    if not key:
        return []
    rows = frappe.db.sql(
        f"""SELECT name, cheque_no, status, amount, bank_line FROM "tab{CHEQUES}"
            WHERE bank = %(bank)s AND cheque_type = %(type)s AND COALESCE(old_type, 0) = 0
              AND ltrim(cheque_no, '0') LIKE %(prefix)s
            ORDER BY creation""",
        {"bank": ICICI_BANK, "type": CHEQUE_TYPE_PAYMENT, "prefix": f"{key}%"},
        as_dict=True,
    )
    return [
        FoundCheque(name=r.name, cheque_no=r.cheque_no, status=r.status, amount=flt(r.amount), bank_line=r.bank_line)
        for r in rows
        if cheque_no_key(r.cheque_no) == key
    ]


def clear_from_line(row, *, source: str, user: str) -> LineOutcome | None:
    """Clear the Payment cheque bank line `row` (an import row as the match run reads it) pays. None when
    the line is not a cheque line or no Payment cheque carries its number: the import's own guard then
    decides it. Never commits; a refusal is rolled back to this line's savepoint."""
    key = bank_cheque_key(source=source, direction=row.direction, reference_id=row.reference_id)
    if not key:
        return None
    cheque, hint = pick_bank_cheque(find_payment_cheques(key), amount=row.amount)
    if cheque is None:
        return LineOutcome(settled=False, note=hint) if hint else None
    if cheque.status == CLEARED and cheque.bank_line and cheque.bank_line != row.name:
        return LineOutcome(settled=False, note=already_linked_note(cheque_no=cheque.cheque_no, bank_line=cheque.bank_line))

    day = str(row.added_on)[:10]
    savepoint = f"cheque_bank_{frappe.generate_hash(length=8)}"
    frappe.db.savepoint(savepoint)
    try:
        # Copied onto each match record by the import's writer (`expenses._record_settlement`).
        frappe.db.set_value(BANK_LINE_DOCTYPE, row.name, "match_basis", BANK_MATCH_BASIS, update_modified=False)
        if cheque.status == CLEARED:
            out = link_bank_line(cheque.name, bank_line=row.name, user=user)
        else:
            out = clear(cheque.name, clearance_date=day, user=user, bank_line=row.name,
                        cleared_by=CLEARED_BY_BANK_IMPORT)
    except Exception as e:
        frappe.db.rollback(save_point=savepoint)
        frappe.clear_messages()  # the reason is on the line; no toast per line
        if not isinstance(e, frappe.ValidationError):
            frappe.log_error(title=f"Cheque {cheque.cheque_no} not cleared by bank line {row.name}",
                             message=frappe.get_traceback())
        return LineOutcome(settled=False, note=bank_clear_failed_note(
            cheque_no=cheque.cheque_no, reason=_short_reason(str(e), cheque.cheque_no)))
    frappe.db.release_savepoint(savepoint)

    suspects = double_payment_suspects(cheque.name) if out["started"] == CANCELLED else ()
    payments = tuple(out["payments"])
    return LineOutcome(
        settled=True,
        note=bank_cleared_note(cheque_no=cheque.cheque_no, started=out["started"], payments=len(payments),
                               day=day, suspects=suspects),
        statement_file_url=out["statement_file_url"],
        payments=payments,
    )


def _short_reason(message: str, cheque_no: str) -> str:
    """"Cheque 004521 cannot be cleared: its payments add up to ..." -> "its payments add up to ..."."""
    head = f"Cheque {cheque_no} cannot be "
    if message.startswith(head) and ": " in message:
        message = message.split(": ", 1)[1]
    return message.strip().rstrip(".") or "refused"


def double_payment_suspects(cheque: str) -> list[DoublePayment]:
    """The payments on cancelled cheque `cheque`'s POs raised after it was cancelled, not Rejected and not
    on the cheque: once the bank has paid the cheque after all, each may pay the same PO twice."""
    doc = frappe.get_doc(CHEQUES, cheque)
    cancelled = [h.changed_at for h in doc.get("status_history") or [] if h.to_status == CANCELLED and h.changed_at]
    pos = sorted({row.record_name for row in doc.get("lines") or [] if row.record_doctype == PO_DOCTYPE and row.record_name})
    if not cancelled or not pos:
        return []
    own = {row.payment_name for row in doc.get("lines") or [] if row.payment_doctype == PAYMENT_DOCTYPE}
    rows = frappe.get_all(
        PAYMENT_DOCTYPE,
        filters={
            "document_type": PO_DOCTYPE, "document_name": ["in", pos], "creation": [">", max(cancelled)],
            "status": ["!=", PAYMENT_REJECTED],
        },
        fields=["name", "document_name", "amount", "status"],
        order_by="creation asc, name asc",
    )
    return [
        DoublePayment(payment=r.name, record=r.document_name, amount=flt(r.amount), status=r.status)
        for r in rows
        if r.name not in own
    ]


def cheque_outcomes(row_names) -> dict[str, dict]:
    """For the import review: per bank line that a Payment cheque records (`Cheques.bank_line`), the
    cheque, where it started (`rules.bank_start`: Issued, Pending, Cancelled, or Cleared when it was
    cleared by hand and the line only linked) and, for a Cancelled one, the possible double payments.
    Reads only."""
    names = [n for n in row_names or [] if n]
    if not names:
        return {}
    cheques = frappe.get_all(
        CHEQUES, filters={"bank_line": ["in", names]}, fields=["name", "cheque_no", "status", "cleared_by", "bank_line"]
    )
    out = {}
    for c in cheques:
        history = frappe.get_all(
            "Cheque Status History", filters={"parent": c.name, "parenttype": CHEQUES},
            fields=["from_status", "to_status", "note"], order_by="idx asc",
        )
        started = bank_start(cleared_by=c.cleared_by, history=[(h.from_status, h.to_status, h.note) for h in history])
        out[c.bank_line] = {
            "cheque": c.name,
            "cheque_no": c.cheque_no,
            "status": c.status,
            "started": started,
            "double_payments": [asdict(d) for d in double_payment_suspects(c.name)] if started == CANCELLED else [],
        }
    return out
