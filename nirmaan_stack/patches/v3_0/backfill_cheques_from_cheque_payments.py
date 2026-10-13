# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Make a Cheque for every old cheque payment (#1419, spec #1407).

WHY THIS PATCH EXISTS
    Before spec #1407 a cheque was a Project Payment with Mode of Payment Cheque and a number and date
    typed on it. A Cheque is now its own record, and every Cheque payment must name its Cheque (the
    `cheque` link), so the Cheque Payments report is complete on day one.

WHAT IT MAKES
    One Cheque per cheque number (spaces ignored), bank ICICI Bank: payments sharing a number become
    one line each of one Cheque. Its date, Vendor and requester come from the earliest payment
    (by creation); its amount is the sum of its lines; it is made from the PO/WO page with no photo
    (the report tags it "No photo").
    Status: Cancelled when every payment is Rejected, and then each is a line. Otherwise the Rejected
    payments are left off the lines (each still gets the `cheque` link), and the Cheque is Cleared
    when every line's payment is Paid, else Issued. Each line's payment gets the link, mode Cheque,
    and the Cheque's number and date (`writer.link_payments`). No payment's status changes: an
    Approved one is not moved on to Reconciliation Pending here.
    A number the rules refuse (payments for two Vendors, a payment with no date, the number already
    on a Cheque) is skipped and listed with the reason, and its payments keep no link; the others are
    still made. Each number is written inside its own savepoint.

IDEMPOTENT
    Only a Cheque payment with no `cheque` link is read, and every payment of a Cheque made here gets
    one, so a second run reads nothing and writes nothing.

HOOKS
    Written through the cheques service (`writer.backfill_cheque`): the Cheque's insert runs its
    `validate`, and each payment is saved through the document. The one raw write is the Cheque's
    `owner` (see the writer). A Cheque moves no money figure, so nothing is recomputed.

The `patches.txt` line sits under [post_model_sync], after the sync that adds `Cheques` and
`Project Payments.cheque`.
"""

from dataclasses import dataclass

import frappe
from frappe.utils import flt

from nirmaan_stack.services.cheque_payments import MODE_CHEQUE
from nirmaan_stack.services.cheques.rules import (
    CANCELLED,
    CLEARED,
    ICICI_BANK,
    ISSUED,
    LINE_PO_WO_PAYMENT,
    PAYMENT_DOCTYPE,
    PAYMENT_REJECTED,
    ChequeHeader,
    ChequeLineInput,
    normalise_cheque_no,
)
from nirmaan_stack.services.cheques.writer import CHEQUES, backfill_cheque
from nirmaan_stack.services.settlement import STATUS_PAID

NOTE = "Made from its cheque payments when Cheques were introduced."


def execute():
    if not frappe.db.has_column(PAYMENT_DOCTYPE, "cheque") or not frappe.db.table_exists(CHEQUES):
        print("backfill_cheques_from_cheque_payments: Cheques / Project Payments.cheque absent, skipping")
        return
    result = backfill_cheques()
    frappe.db.commit()
    for line in summary(result):
        print(f"backfill_cheques_from_cheque_payments: {line}")
        frappe.logger("cheques").info(f"backfill_cheques_from_cheque_payments: {line}")


@dataclass(frozen=True)
class OldPayment:
    name: str
    owner: str
    status: str
    amount: float
    cheque_date: str | None
    record_doctype: str
    record_name: str


def backfill_cheques(payments: list[str] | None = None) -> dict:
    """Make the Cheques for every Cheque payment with no Cheque -- or only for `payments`, which is
    what the tests pass so they never touch a payment they did not plant. Commits nothing.

    Returns `{made: [{cheque, cheque_no, status, lines, left_off}], skipped: [{cheque_no, payments,
    reason}]}`.
    """
    made, skipped = [], []
    for cheque_no, group in sorted(_unlinked_by_number(payments).items()):
        savepoint = f"cheque_backfill_{frappe.generate_hash(length=8)}"
        frappe.db.savepoint(savepoint)
        try:
            made.append(_make_cheque(cheque_no, group))
        except frappe.ValidationError as e:
            frappe.db.rollback(save_point=savepoint)
            skipped.append({"cheque_no": cheque_no, "payments": [p.name for p in group], "reason": str(e) or "refused"})
    return {"made": made, "skipped": skipped}


def summary(result: dict) -> list[str]:
    """What the patch prints: the counts, then each skipped number and why."""
    made = result["made"]
    by_status = {s: sum(1 for m in made if m["status"] == s) for s in (ISSUED, CLEARED, CANCELLED)}
    lines = [
        f"{len(made)} Cheque(s) made ({', '.join(f'{n} {s}' for s, n in by_status.items())}), "
        f"{sum(m['lines'] for m in made)} line(s), {sum(len(m['left_off']) for m in made)} Rejected "
        f"payment(s) linked but left off the lines; {len(result['skipped'])} number(s) skipped"
    ]
    lines += [f"skipped {s['cheque_no']} ({', '.join(s['payments'])}): {s['reason']}" for s in result["skipped"]]
    return lines


def _unlinked_by_number(payments: list[str] | None) -> dict[str, list[OldPayment]]:
    """Every Cheque payment with no Cheque, oldest first, grouped by its number without spaces. A
    payment with no number at all is grouped under "" and so skipped by the header rules."""
    if payments is not None and not payments:
        return {}
    scope = "AND name IN %(payments)s" if payments is not None else ""
    rows = frappe.db.sql(
        f"""SELECT name, owner, status, amount, cheque_no, cheque_date,
                   document_type AS record_doctype, document_name AS record_name
            FROM "tab{PAYMENT_DOCTYPE}"
            WHERE btrim(mode_of_payment) = %(cheque)s AND COALESCE(cheque, '') = ''
              {scope}
            ORDER BY creation, name""",
        {"cheque": MODE_CHEQUE, "payments": tuple(payments or ())},
        as_dict=True,
    )
    groups: dict[str, list[OldPayment]] = {}
    for r in rows:
        groups.setdefault(normalise_cheque_no(r.cheque_no), []).append(OldPayment(
            name=r.name,
            owner=r.owner,
            status=(r.status or "").strip(),
            amount=flt(r.amount, 2),
            cheque_date=str(r.cheque_date) if r.cheque_date else None,
            record_doctype=r.record_doctype,
            record_name=r.record_name,
        ))
    return groups


def backfill_status(statuses: list[str]) -> tuple[str, list[bool]]:
    """The Cheque's status from its payments' statuses, and which of them become lines.

    Every one Rejected: Cancelled, all of them lines. Otherwise the Rejected ones are left off, and
    the Cheque is Cleared when every line's payment is Paid, else Issued.
    """
    if all(s == PAYMENT_REJECTED for s in statuses):
        return CANCELLED, [True] * len(statuses)
    on_lines = [s != PAYMENT_REJECTED for s in statuses]
    kept = [s for s, on in zip(statuses, on_lines) if on]
    return (CLEARED if all(s == STATUS_PAID for s in kept) else ISSUED), on_lines


def _make_cheque(cheque_no: str, group: list[OldPayment]) -> dict:
    status, on_lines = backfill_status([p.status for p in group])
    lines = [_line(p) for p, on in zip(group, on_lines) if on]
    left_off = [p.name for p, on in zip(group, on_lines) if not on]
    earliest = group[0]
    header = ChequeHeader(
        bank=ICICI_BANK,
        bank_name=None,
        cheque_no=cheque_no or None,
        cheque_date=earliest.cheque_date,
        amount=flt(sum(line.amount for line in lines), 2),
        vendor=frappe.db.get_value(earliest.record_doctype, earliest.record_name, "vendor"),
        payee_name=None,
        description=None,
        attachment=None,
    )
    note = NOTE + (f" Rejected, left off: {', '.join(left_off)}." if left_off else "")
    doc = backfill_cheque(header, lines, status=status, owner=earliest.owner, note=note, left_off=left_off)
    return {"cheque": doc.name, "cheque_no": doc.cheque_no, "status": status, "lines": len(lines), "left_off": left_off}


def _line(payment: OldPayment) -> ChequeLineInput:
    return ChequeLineInput(
        line_type=LINE_PO_WO_PAYMENT,
        project=frappe.db.get_value(payment.record_doctype, payment.record_name, "project"),
        record_doctype=payment.record_doctype,
        record_name=payment.record_name,
        payment_doctype=PAYMENT_DOCTYPE,
        payment_name=payment.name,
        amount=payment.amount,
    )
