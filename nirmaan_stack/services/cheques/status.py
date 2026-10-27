# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Payment cheque's status moves with its payments (spec #1477, ADR-0035): issued when they are
approved, cleared when they are paid, cancelled when they are rejected. Part of THE cheques service;
never commits. There is no free status change: every move is one of the named operations below, and
none goes back (Cleared -> Issued and Cancelled -> Issued are gone, #1484).

**Issue** (#1479). `issue` is THE ONLY CODE THAT TAKES A PAYMENT CHEQUE FROM APPROVAL PENDING TO ISSUED, but for an
Old-type cheque its bank line clears (`old_type_clear.issue`); both write it through `writer.mark_issued`. A Payment
cheque starts Approval Pending and is Issued in the same write that moves its last payment on to Reconciliation
Pending (`cheque_payments.move_to_reconciliation` calls it), with its issue date set to the day of its
payments' last approval. Every approval route ends in that move (single L1, CEO, bulk, auto-approve and
the raiser's own step at creation), so they all issue through here; a cheque made for payments already
moved on is issued as it is made (`writer.create_cheque`).

**Clear** (#1484, #1516). ONLY A BANK-STATEMENT LINE CLEARS A CHEQUE (ADR-0035 Amendment A): nobody clears
one by hand. `clear` takes an imported line (`Outflow Import Row`) carrying the cheque's number and amount
and makes every payment on the cheque Paid, with the line's date as each one's payment date, and the
cheque Cleared, with that date as its Cheque/Payment Date (`cheque_date`, #1520: the paper date is not
kept on the Cheque), `CLEARED_BY_BANK_IMPORT`, and the line. The line gets
one match record (`Outflow Row Match`) per payment, written as the import's own settle writes them, so it
reads Settled and no longer shows as unmatched. Its caller is the bank import (`bank_import.clear_from_line`).
It may start from Approval Pending or Cancelled too (`clear_rules.CLEARABLE_FROM`): the bank has already paid, so
`_bring_forward` first approves an Approval Pending cheque's payments (approval date = the line's date, the cheque
Issued with history "approved by bank import") or revives a Cancelled one's Rejected payments (history
"cancelled, but the bank paid it"), all inside the same savepoint, before the pay loop. A cheque Cleared by
hand before #1516 gets a later bank line through `link_bank_line` (spec story 48): match records only,
nothing paid again. A Cleared cheque has no undo: the import's Unreconcile refuses its payments
(`cleared_cheque_of`).

**Old-type cheques** (#1478) are cleared by their bank line like any other (#1516; owner, 2026-10-21),
every line paid in full; what `clear` does differently for one is in `old_type_clear`.

**Cancel** (#1484). `cancel` is THE reject cascade (`decide.reject_cheque`) behind a note: every payment
on the cheque Rejected with the note as their reason, the cheque Cancelled. Refused once Cleared.

**Cancel a deposit** (#1486). `cancel_deposit` is the one move a Security Deposit cheque has: Issued ->
Cancelled when it comes back, with a required note. It pays nothing, so no payment is touched; it is never
cleared (`clear_rules.clear_problem`) and never issued (it is Issued when recorded, `writer.add_deposit_cheque`).
"""

import frappe
from frappe import _
from frappe.utils import flt, nowdate

from nirmaan_stack.api.outflow_import.vendor_credit_refresh import SETTLED_ENTRY_TYPE, recompute_vendor_credit
from nirmaan_stack.services.cheque_payments import to_reconciliation
from nirmaan_stack.services.cheques import old_type_clear
from nirmaan_stack.services.cheques.approval_rules import approval_problem
from nirmaan_stack.services.cheques.bank_import_rules import (
    BANK_APPROVAL_NOTE,
    BANK_REVIVAL_NOTE,
    EXPENSE_KIND,
    PAYMENT_KIND,
    bank_approval_note,
)
from nirmaan_stack.services.cheques.clear_rules import (
    BANK_BRINGS_FORWARD,
    BankLine,
    ClearPayment,
    bank_line_problem,
    cancel_note_problem,
    cancel_problem,
    clear_problem,
    deposit_cancel_problem,
)
from nirmaan_stack.services.cheques.decide import (
    DECIDING_FLAG,
    approval_lines,
    lock_payments,
    reject_cheque,
    write_po_terms,
)
from nirmaan_stack.services.cheques.lines import cheques_naming
from nirmaan_stack.services.cheques.payment_rules import CLEARING_FLAG
from nirmaan_stack.services.cheques.rules import (
    CANCELLED,
    CHEQUE_TYPE_PAYMENT,
    CHEQUE_TYPE_SECURITY_DEPOSIT,
    CLEARED,
    CLEARED_BY_BANK_IMPORT,
    PAYMENT_DOCTYPE,
    PAYMENT_REJECTED,
    PENDING,
    PO_DOCTYPE,
    issue_date_from,
    ready_to_issue,
    rupees,
)
from nirmaan_stack.services.cheques.writer import CHEQUES, CHEQUES_CHANGED_EVENT, history_row, mark_issued
from nirmaan_stack.services.outflow_import.amounts import amounts_match
from nirmaan_stack.services.outflow_import.normalize import normalize_amount
from nirmaan_stack.services.outflow_import.row_settlement import (
    record_settlement,
    refresh_batch_rollup,
    refresh_row_allocation,
)
from nirmaan_stack.services.outflow_import.settle import (
    SettleResult,
    advance_po_latest_payment_date,
    apply_statement_attachment,
    outflow_import_write,
)
from nirmaan_stack.services.settlement import (
    STATUS_APPROVED,
    STATUS_CEO_PENDING,
    STATUS_PAID,
    STATUS_RECONCILIATION_PENDING,
    STATUS_REQUESTED,
)

BANK_LINE_DOCTYPE = "Outflow Import Row"
BANK_BATCH_DOCTYPE = "Outflow Import Batch"


def _line_payments(doc) -> list[str]:
    """The Project Payments the Cheque's lines name, in name order (expense lines are not payments)."""
    return sorted({row.payment_name for row in doc.get("lines") or []
                   if row.payment_doctype == PAYMENT_DOCTYPE and row.payment_name})


def _refuse(doc, what: str, reason: str):
    frappe.throw(_("Cheque {0} cannot be {1}: {2}.").format(doc.cheque_no, what, reason))


def clear(cheque: str, *, bank_line: str | None, user: str) -> dict:
    """Clear Payment cheque `cheque` with imported bank line `bank_line`: every payment on it becomes Paid,
    dated the line's day, and the cheque becomes Cleared on that day (its Cheque/Payment Date), by bank
    import, with the line recorded on it. Returns `{cheque, cheque_no, status, payments, moved, bank_line,
    statement_file_url, started}`: the payments it paid, every record it paid as `(kind, status it was at)`
    for the import review (`bank_import_rules.bank_cleared_note`), the statement the line came from (the
    caller links that file to each payment after its commit), and the status the cheque was at.

    THERE IS NO OTHER WAY TO CLEAR A CHEQUE (#1516): without a line it is refused. Starting from Approval Pending or
    Cancelled, `_bring_forward` approves or revives the payments first, in the same savepoint. Each payment
    takes the line's reference as its UTR (when it has none) and the statement as its attachment, and gets
    one match record, as the import's settle writes them; the line becomes Settled. An Old-type cheque
    settles each line's record for the line's amount instead (`old_type_clear`).

    Refuses, naming the cheque and the reason, and changes nothing when the cheque cannot be cleared
    (`clear_rules.clear_problem`) or the line does not fit it. Locks the cheque, its POs, its payments and
    the line. Runs inside the caller's savepoint and NEVER COMMITS: each payment save carries the outflow
    import's flags, so no hook commits mid-cheque.
    """
    doc = frappe.get_doc(CHEQUES, cheque, for_update=True)
    started = doc.status
    old_type = bool(doc.old_type)
    payments = _line_payments(doc)
    rows = lock_payments(payments) if payments else {}
    was = {p: (rows[p].status or "").strip() for p in payments}
    expenses = old_type_clear.expense_statuses(doc) if old_type else {}
    # Records Paid before this clear (an Old-type cheque's only): left as they are.
    paid_before = {(PAYMENT_DOCTYPE, p) for p in payments if was[p] == STATUS_PAID}
    paid_before |= {record for record, status in expenses.items() if status == STATUS_PAID}
    reason = clear_problem(
        status=doc.status, cheque_type=doc.cheque_type, old_type=old_type,
        payments=[ClearPayment(p, rows[p].status, bool(rows[p].on_hold)) for p in payments],
        bank_line=bool(bank_line), expenses=[(name, status) for (_doctype, name), status in expenses.items()],
    )
    if not reason and started in BANK_BRINGS_FORWARD and not old_type:
        # An Old-type cheque may pay expenses, which the approval rule refuses: its lines are checked
        # against the bank line below instead (`old_type_lines_problem`).
        reason = approval_problem(cheque_no=doc.cheque_no, amount=doc.amount, lines=approval_lines(doc))
    if reason:
        _refuse(doc, "cleared", reason.rstrip("."))
    # Checked before anything is written: the line pays every payment on the cheque.
    line = _lock_bank_line(doc, bank_line)
    if old_type:
        reason = old_type_clear.lines_problem(doc, payments, bank_amount=line.amount)
    else:
        reason = _payments_total_problem(line, payments)
    if reason:
        _refuse(doc, "cleared with that bank line", reason)
    # The bank's date is a fact: a cheque approved in the system after the bank paid it still clears.
    day = str(line.added_on)[:10]

    waiting = [p for p in payments
               if rows[p].status != STATUS_RECONCILIATION_PENDING and (PAYMENT_DOCTYPE, p) not in paid_before]
    if started in BANK_BRINGS_FORWARD or waiting:
        # Approval Pending: the import approves the payments; Cancelled: it revives them; an Old-type cheque's
        # waiting ones are approved whatever its status. Either way they reach Reconciliation Pending here, in
        # this savepoint, and are paid below like an Issued cheque's. A Paid one is left as it is.
        _bring_forward(doc, waiting, day=day, user=user, bank_line=bank_line)
        doc = frappe.get_doc(CHEQUES, cheque, for_update=True)
        rows = lock_payments(payments)

    to_pay = [p for p in payments if rows[p].status == STATUS_RECONCILIATION_PENDING]
    statement_file_url = frappe.db.get_value(BANK_BATCH_DOCTYPE, line.import_batch, "source_file") or None

    paid = [_pay(name, day, cheque=cheque, line=line, statement_file_url=statement_file_url) for name in to_pay]
    write_po_terms({p: rows[p] for p in to_pay}, STATUS_PAID)
    # A Reconciliation Pending -> Paid save moves no vendor credit through the payment's hook, which only
    # watches Approved -> Paid; recomputed from source once per vendor, as the import's settle does.
    recompute_vendor_credit([r.document_name for r in paid if r.document_type == PO_DOCTYPE], SETTLED_ENTRY_TYPE)
    if old_type:
        legs = old_type_clear.settle_lines(doc, line, paid=set(to_pay), paid_before=paid_before,
                                           statement_file_url=statement_file_url, user=user)
    else:
        legs = [_leg(pay) for pay in paid]
    _record_bank_line(line, legs, user)

    brought = [(p, was[p]) for p in waiting if was[p] != PAYMENT_REJECTED]
    if brought and started != PENDING:
        # Every move the import makes is in the cheque's history (ADR-0035). An Approval Pending cheque's
        # approval is its Issued row; an Old-type cheque's waiting payments get this one.
        doc.append("status_history", history_row(doc.status, doc.status, user, bank_approval_note(brought)))
    note = f"Cleared by bank import, bank line {line.name}."
    if started == CANCELLED:
        note = f"{note.rstrip('.')}: {BANK_REVIVAL_NOTE}."
    doc.append("status_history", history_row(doc.status, CLEARED, user, note))
    doc.status = CLEARED
    # The Cheque/Payment Date becomes the day the bank paid (#1520); the paper date is not kept on the
    # Cheque. Each payment's own `cheque_date` still holds it.
    doc.cheque_date = day
    doc.cleared_by = CLEARED_BY_BANK_IMPORT
    doc.bank_line = line.name
    doc.save(ignore_permissions=True)
    frappe.publish_realtime(CHEQUES_CHANGED_EVENT, {"cheques": [cheque]}, after_commit=True)
    moved = [(PAYMENT_KIND, was[p]) for p in to_pay]
    moved += [(EXPENSE_KIND, status) for record, status in expenses.items() if record not in paid_before]
    return {
        "cheque": cheque, "cheque_no": doc.cheque_no, "status": CLEARED, "payments": to_pay, "moved": moved,
        "bank_line": line.name, "statement_file_url": statement_file_url, "started": started,
    }


def _leg(pay) -> SettleResult:
    """The match record of a payment the line paid in full."""
    amount = normalize_amount(pay.amount)
    return SettleResult(doctype=PAYMENT_DOCTYPE, name=pay.name, amount=amount, created=False, original_amount=amount)


def _bring_forward(doc, payments: list[str], *, day: str, user: str, bank_line: str | None) -> None:
    """Bring each of `payments` (on bank-cleared cheque `doc`: Approval Pending, Cancelled, or an Old-type
    cheque's waiting payments) to Reconciliation Pending, as an approval followed by the move would
    (`cheque_payments.move_to_reconciliation`): each is saved Approved, then taken on by THE step both
    share (`cheque_payments.to_reconciliation`: the TDS retry, then the save at Reconciliation Pending). A payment still waiting is
    approved by the bank import, dated `day` (the line's date: L1 for one at Requested, CEO for one at CEO
    Pending); a Cancelled cheque's Rejected payments are revived, each with a comment. An Approval Pending
    cheque is then Issued with the history note `BANK_APPROVAL_NOTE`.

    Every save carries the import's flags (`from_outflow_import` and the request flag keep each hook from
    committing; `bulk_approval` leaves the PO terms to the caller) and `DECIDING_FLAG`, so the payment's
    own guard sees the cheque's decision, not a lone approval. Never commits.
    """
    for name in payments:
        pay = frappe.get_doc(PAYMENT_DOCTYPE, name)
        was = (pay.status or "").strip()
        if was == STATUS_REQUESTED:
            pay.approval_date = day
        elif was == STATUS_CEO_PENDING:
            pay.ceo_approval_date = day
        _for_the_bank(pay, doc.name)
        with outflow_import_write():
            if was != STATUS_APPROVED:
                pay.status = STATUS_APPROVED
                pay.save(ignore_permissions=True)
            to_reconciliation(pay)  # a held payment never gets here: `clear_problem` refuses it
        if was == PAYMENT_REJECTED:
            line = f", bank line {bank_line}" if bank_line else ""
            pay.add_comment("Comment", text=_("Revived by the bank import: cheque {0} was cancelled, but the bank "
                                              "paid it{1}.").format(doc.cheque_no, line))
    if doc.status != PENDING:
        return
    if doc.old_type:
        old_type_clear.issue(doc.name, day=day, user=user)
    elif not issue(doc.name, user=user, note=BANK_APPROVAL_NOTE):
        _refuse(doc, "cleared", "its payments could not all be approved")


def _for_the_bank(pay, cheque: str) -> None:
    """The flags every bring-forward save carries (`_bring_forward`)."""
    pay.flags.from_outflow_import = True
    pay.flags.bulk_approval = True
    pay.flags[DECIDING_FLAG] = cheque


def link_bank_line(cheque: str, *, bank_line: str, user: str) -> dict:
    """Link bank line `bank_line` to Payment cheque `cheque`, Cleared by hand before #1516 with no line: one
    match record per Paid payment on it, the line Settled, and the line recorded on the cheque (spec
    story 48). Nothing is paid again: the payments, their dates and the cheque's status and history stay
    as the hand clear left them. Returns what `clear` returns, `started` = Cleared.

    Refuses (and changes nothing) unless the cheque is a not Old-type Payment cheque, Cleared, with no
    bank line yet, and the line fits it (`clear_rules.bank_line_problem`, the paid payments' total within ₹5).
    An Old-type cheque cleared by hand may have paid expenses the line cannot be matched to.
    Runs inside the caller's savepoint and NEVER COMMITS.
    """
    doc = frappe.get_doc(CHEQUES, cheque, for_update=True)
    if doc.cheque_type != CHEQUE_TYPE_PAYMENT:
        _refuse(doc, "linked to a bank line", "only a Payment cheque is matched to a bank line")
    if doc.old_type:
        _refuse(doc, "linked to a bank line", "it is an Old-type cheque that was cleared by hand")
    if doc.status != CLEARED:
        _refuse(doc, "linked to a bank line", f"it is {doc.status}, not Cleared")
    if doc.bank_line:
        _refuse(doc, "linked to a bank line", f"it is already cleared with bank line {doc.bank_line}")
    payments = _line_payments(doc)
    rows = lock_payments(payments) if payments else {}
    paid = [p for p in payments if rows[p].status == STATUS_PAID]
    line = _lock_bank_line(doc, bank_line)
    reason = _payments_total_problem(line, paid)
    if reason:
        _refuse(doc, "linked to a bank line", reason)
    _record_bank_line(line, [_leg(frappe.get_doc(PAYMENT_DOCTYPE, p)) for p in paid], user)
    doc.bank_line = line.name
    doc.save(ignore_permissions=True)
    frappe.publish_realtime(CHEQUES_CHANGED_EVENT, {"cheques": [cheque]}, after_commit=True)
    return {
        "cheque": cheque, "cheque_no": doc.cheque_no, "status": CLEARED, "payments": paid,
        "moved": [],  # nothing is paid again: the line only matches what the hand clear paid
        "bank_line": line.name, "statement_file_url": None, "started": CLEARED,
    }


def cleared_cheque_of(payment_name: str) -> str | None:
    """The number of the Cleared cheque whose lines name `payment_name`, else None. A Cleared cheque has
    no undo (ADR-0035 §5), so its payments may not be put back to Reconciliation Pending (the import's
    Unreconcile asks this)."""
    return next(
        (r.cheque_no for r in cheques_naming(PAYMENT_DOCTYPE, [payment_name]) if r.status == CLEARED), None
    )


def _lock_bank_line(doc, name: str):
    """Read bank line `name` under its row lock and refuse it unless it can clear this cheque: the bank
    match rule (`clear_rules.bank_line_problem`)."""
    line = frappe.db.get_value(BANK_LINE_DOCTYPE, name, "*", as_dict=True, for_update=True)
    if not line:
        frappe.throw(_("Bank line {0} not found.").format(name))
    reason = bank_line_problem(
        BankLine(name=line.name, source=line.source, direction=line.direction, row_status=line.row_status,
                 reference_id=line.reference_id, amount=flt(line.amount)),
        bank=doc.bank, cheque_no=doc.cheque_no, amount=doc.amount,
    )
    if reason:
        _refuse(doc, "cleared with that bank line", reason)
    return line


def _payments_total_problem(line, payments: list[str]) -> str | None:
    """Since the line pays `payments`, their total must be within ₹5 of it, so the line ends Settled, never
    part allocated."""
    total = sum(flt(frappe.db.get_value(PAYMENT_DOCTYPE, p, "amount")) for p in payments)
    if amounts_match(total, line.amount):
        return None
    return f"its payments add up to {rupees(total)}, but line {line.name} is for {rupees(line.amount)}"


def _pay(name: str, payment_date: str, *, cheque: str, line, statement_file_url: str | None):
    """One payment on `cheque` Reconciliation Pending -> Paid on `payment_date`, from bank line `line`. Saved
    with the flags the import's settle uses (`services/outflow_import/settle.settle_payment`):
    `from_outflow_import` and the request flag keep every hook from committing, and `bulk_approval` leaves
    the PO term to `write_po_terms`, one save per PO. `CLEARING_FLAG` names the cheque: THIS IS THE ONE SAVE
    THAT MAKES A CHEQUE PAYMENT PAID (`payment_mode.validate_paid_by_clear`, #1552). Returns the saved
    payment."""
    pay = frappe.get_doc(PAYMENT_DOCTYPE, name)
    pay.status = STATUS_PAID
    pay.payment_date = payment_date
    if not (pay.utr or "").strip():
        pay.utr = (line.settlement_reference or "").strip() or None
    apply_statement_attachment(pay, statement_file_url)
    pay.flags.from_outflow_import = True
    pay.flags.bulk_approval = True
    pay.flags[CLEARING_FLAG] = cheque
    with outflow_import_write():
        pay.save(ignore_permissions=True)
    advance_po_latest_payment_date(pay, frappe.utils.getdate(payment_date))
    return pay


def _record_bank_line(line, legs: list[SettleResult], user: str) -> None:
    """One match record per leg on bank line `line`, then the line's status from its records (Settled)
    and its batch's roll-up: the import's own writers (`services/outflow_import/row_settlement`), so the
    line reads exactly as a line the import settled across several records does."""
    for leg in legs:
        record_settlement(line, line, leg, user)
    refresh_row_allocation(line.name, user)
    refresh_batch_rollup(line.import_batch)


def cancel(cheque: str, *, note: str, user: str) -> dict:
    """Cancel cheque `cheque` by hand: THE reject cascade (`decide.reject_cheque`), with `note` as every
    payment's rejection reason and on the cheque's history row. Returns what `reject_cheque` returns.

    Refuses without a note, and once the cheque is Cleared (no undo) or already Cancelled; a line already
    Paid (an Old-type cheque's payment or expense) refuses too, named. A Security Deposit cheque is
    `cancel_deposit`'s. Runs inside the caller's transaction and NEVER COMMITS.
    """
    reason = cancel_note_problem(note)
    if reason:
        frappe.throw(_(reason))
    doc = frappe.get_doc(CHEQUES, cheque, for_update=True)
    reason = cancel_problem(status=doc.status, paid=_paid_lines(doc))
    if not reason and doc.cheque_type == CHEQUE_TYPE_SECURITY_DEPOSIT:
        reason = "it is a Security Deposit cheque: mark it returned instead"
    if reason:
        _refuse(doc, "cancelled", reason)
    return reject_cheque(cheque, reason=note.strip(), user=user)


def _paid_lines(doc) -> list[tuple[str, str]]:
    """`(kind, name)` of each record cheque `doc`'s lines name that is already Paid, in line order: its
    payments, and an Old-type cheque's expenses (`clear_rules.cancel_problem` reads them)."""
    payments = _line_payments(doc)
    paid = set(frappe.get_all(PAYMENT_DOCTYPE, filters={"name": ["in", payments or [""]], "status": STATUS_PAID},
                              pluck="name"))
    expenses = old_type_clear.expense_statuses(doc) if doc.old_type else {}
    out = []
    for row in doc.get("lines") or []:
        if row.payment_doctype == PAYMENT_DOCTYPE and row.payment_name in paid:
            out.append((PAYMENT_KIND, row.payment_name))
        elif expenses.get((row.payment_doctype, row.payment_name)) == STATUS_PAID:
            out.append((EXPENSE_KIND, row.payment_name))
    return out


def cancel_deposit(cheque: str, *, note: str, user: str) -> dict:
    """THE "cancel deposit cheque" operation (#1486, spec #1477): Security Deposit cheque `cheque` goes from
    Issued to Cancelled (it came back, or was torn up), with `note` (required) on its history row. Its lines
    stay as the record of what it secured; no payment is touched. Returns `{cheque, cheque_no, payments,
    rejected, status}`, the shape `cancel` returns, with no payments.

    Refuses without a note, a Payment cheque, and a deposit already Cancelled (`clear_rules.deposit_cancel_problem`).
    Runs inside the caller's transaction and NEVER COMMITS.
    """
    reason = cancel_note_problem(note)
    if reason:
        frappe.throw(_(reason))
    doc = frappe.get_doc(CHEQUES, cheque, for_update=True)
    reason = deposit_cancel_problem(status=doc.status, cheque_type=doc.cheque_type)
    if reason:
        _refuse(doc, "cancelled", reason)
    doc.append("status_history", history_row(doc.status, CANCELLED, user, note.strip()))
    doc.status = CANCELLED
    doc.save(ignore_permissions=True)
    frappe.publish_realtime(CHEQUES_CHANGED_EVENT, {"cheques": [cheque]}, after_commit=True)
    return {"cheque": cheque, "cheque_no": doc.cheque_no, "payments": [], "rejected": [], "status": CANCELLED}


def issue(name: str, *, user: str, note: str | None = None):
    """Issue Payment cheque `name` if its payments allow it: the only way out of Approval Pending to Issued.

    Re-reads the Cheque under its row lock. An Approval Pending Payment cheque (not Old-type) whose every line's
    payment is at Reconciliation Pending (`rules.ready_to_issue`) becomes Issued, refused when its lines
    fail the approval conditions (`approval_rules.approval_problem`), with its issue date
    set to the day of its payments' last approval (`rules.issue_date_from`; today when none is dated)
    and one history row by `user`, saying `note` if given. Returns the saved Cheque, or None when it
    stays as it is, so calling it again, or for a cheque that still waits on a payment, is harmless.

    ⚠️ CALL IT IN THE SAME TRANSACTION (OR SAVEPOINT) AS THE PAYMENT MOVE, never after its commit:
    should either fail, both roll back, and the cheque stays Approval Pending beside its Approved payment. It
    commits nothing, and no hook of the Cheque save commits.
    """
    doc = frappe.get_doc(CHEQUES, name, for_update=True)
    if doc.status != PENDING or doc.cheque_type != CHEQUE_TYPE_PAYMENT or doc.old_type:
        return None
    lines = doc.get("lines") or []
    payments = [row.payment_name for row in lines if row.payment_doctype == PAYMENT_DOCTYPE and row.payment_name]
    if not payments or len(payments) != len(lines):
        return None  # a line with no payment yet (or an expense line) keeps it Approval Pending
    rows = {
        r.name: r
        for r in frappe.get_all(
            PAYMENT_DOCTYPE,
            filters={"name": ["in", payments]},
            fields=["name", "status", "approval_date", "ceo_approval_date"],
        )
    }
    if not ready_to_issue([rows[p].status if p in rows else None for p in payments]):
        return None
    # The backstop under every route (story 13): no Issued cheque is short of its amount. Raised, so the
    # payment move that would issue it rolls back with it and the payment waits at Approved.
    problem = approval_problem(cheque_no=doc.cheque_no, amount=doc.amount, lines=approval_lines(doc))
    if problem:
        frappe.throw(_(problem))
    approvals = [r.approval_date for r in rows.values()] + [r.ceo_approval_date for r in rows.values()]
    mark_issued(doc, user=user, note=note, issue_date=issue_date_from(approvals) or nowdate())
    return doc
