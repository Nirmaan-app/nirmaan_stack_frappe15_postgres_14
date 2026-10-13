# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Cheque line rules that read the database (spec #1407). Reads only; writes nothing.

The `validate` controller (`integrations/controllers/cheques.py`) runs `normalise_lines` then
`lines_problem` on every save, so the rules hold for every writer. The pure half of each rule is in
`rules.py`; this module fetches the facts it needs.

The rules (#1410, PO/WO Payment lines):

* each PO / Work Order is the Cheque's Vendor's and in its line's project;
* each payment is a payment of its line's PO / Work Order, and a Rejected one cannot be put on;
* a payment sits on at most one Cheque that is not Cancelled, and on one line of it.

Expense lines arrive with #1411.
"""

import frappe

from nirmaan_stack.services.cheques.rules import (
    CANCELLED,
    LINE_PO_WO_PAYMENT,
    PAYMENT_DOCTYPE,
    RECORD_DOCTYPES,
    ChequeLineInput,
    parse_line,
    po_wo_line_problem,
)


def live_cheques_of(payment_doctype: str, payment_names, *, exclude: str | None = None) -> dict[str, dict]:
    """`{payment: {cheque, cheque_no, status}}` for each of `payment_names` that sits on a Cheque
    that is not Cancelled. `exclude` leaves one Cheque out (the one being saved)."""
    names = tuple(sorted({n for n in payment_names if n}))
    if not names:
        return {}
    exclude_clause = "AND c.name != %(exclude)s" if exclude else ""
    rows = frappe.db.sql(
        f"""SELECT l.payment_name AS payment, c.name AS cheque, c.cheque_no, c.status
            FROM "tabCheque Line" l
            JOIN "tabCheques" c ON c.name = l.parent
            WHERE l.parenttype = 'Cheques'
              AND l.payment_doctype = %(doctype)s
              AND l.payment_name IN %(names)s
              AND c.status != %(cancelled)s
              {exclude_clause}
            ORDER BY c.creation""",
        {"doctype": payment_doctype, "names": names, "cancelled": CANCELLED, "exclude": exclude},
        as_dict=True,
    )
    return {r.payment: {"cheque": r.cheque, "cheque_no": r.cheque_no, "status": r.status} for r in rows}


def normalise_lines(doc) -> None:
    """Trim each line, name a PO/WO line's payment doctype, and copy a picked payment's amount onto
    a line that has none (the form copies it once on pick; this covers every other writer)."""
    for row in doc.get("lines") or []:
        line = parse_line(row.as_dict())
        row.update({
            "line_type": line.line_type,
            "project": line.project,
            "record_doctype": line.record_doctype,
            "record_name": line.record_name,
            "payment_doctype": line.payment_doctype,
            "payment_name": line.payment_name,
            "amount": line.amount,
        })
        if line.payment_doctype == PAYMENT_DOCTYPE and line.amount <= 0:
            row.amount = frappe.db.get_value(PAYMENT_DOCTYPE, line.payment_name, "amount") or 0


def lines_problem(doc) -> str | None:
    """Why the Cheque's lines cannot be saved ("Line N: ..."), or None."""
    lines = [parse_line(row.as_dict()) for row in doc.get("lines") or []]
    before = None if doc.is_new() else doc.get_doc_before_save()
    on_before = {row.payment_name for row in (before.get("lines") if before else []) or [] if row.payment_name}

    seen: set[str] = set()
    for n, line in enumerate(lines, 1):
        problem = _line_problem(line, cheque_vendor=doc.get("vendor"), newly_linked=line.payment_name not in on_before)
        if not problem and line.payment_name:
            if line.payment_name in seen:
                problem = f"payment {line.payment_name} is on two lines of this cheque."
            seen.add(line.payment_name)
        if problem:
            return f"Line {n}: {problem}"

    if (doc.get("status") or "") == CANCELLED:
        return None
    live = live_cheques_of(PAYMENT_DOCTYPE, seen, exclude=None if doc.is_new() else doc.name)
    for n, line in enumerate(lines, 1):
        other = live.get(line.payment_name)
        if other:
            return (
                f"Line {n}: payment {line.payment_name} is already on cheque {other['cheque_no']} "
                f"({other['status']})."
            )
    return None


def _line_problem(line: ChequeLineInput, *, cheque_vendor: str | None, newly_linked: bool) -> str | None:
    if line.line_type != LINE_PO_WO_PAYMENT:
        return "only PO or Work Order payment lines can be saved for now."
    record = None
    if line.record_doctype in RECORD_DOCTYPES and line.record_name:
        record = frappe.db.get_value(line.record_doctype, line.record_name, ["project", "vendor"], as_dict=True)
    payment = None
    if line.payment_name:
        payment = frappe.db.get_value(
            PAYMENT_DOCTYPE, line.payment_name, ["document_type", "document_name", "status"], as_dict=True
        )
    return po_wo_line_problem(
        line, cheque_vendor=cheque_vendor, record=record, payment=payment, newly_linked=newly_linked
    )
