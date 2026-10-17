# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Cheque line rules that read the database (spec #1407). Reads only; writes nothing.

The `validate` controller (`integrations/controllers/cheques.py`) runs `normalise_lines` then
`lines_problem` on every save, so the rules hold for every writer. The pure half of each rule is in
`rules.py`; this module fetches the facts it needs.

The rules:

* PO/WO Payment lines (#1410): each PO / Work Order is the Cheque's Vendor's and in its line's
  project, so a cheque with a typed payee takes none; each payment is a payment of its line's PO /
  Work Order, and a Rejected one cannot be put on a live (not Cancelled) Cheque.
* Expense lines (#1411): the expense is required; a Project Expense is in its line's project.
* Secured PO/WO lines (#1486, spec #1477): a Security Deposit cheque's only kind, and only its. Each
  names one of the cheque's Vendor's POs or Work Orders, once; its project is the record's.
* A payment or an expense sits on at most one Cheque that is not Cancelled, and on one line of it.
"""

from dataclasses import replace

import frappe

from nirmaan_stack.services.cheques.rules import (
    CANCELLED,
    CHEQUE_TYPE_PAYMENT,
    LINE_SECURED_RECORD,
    EXPENSE_LINE_TYPES,
    LINE_PAYMENT_DOCTYPES,
    PAYMENT_DOCTYPE,
    PROJECT_EXPENSE_DOCTYPE,
    RECORD_DOCTYPES,
    ChequeLineInput,
    expense_line_problem,
    line_kind_problem,
    parse_line,
    po_wo_line_problem,
    secured_line_problem,
)


def live_cheques_of(payment_doctype: str, payment_names, *, exclude: str | None = None) -> dict[str, dict]:
    """`{payment: {cheque, cheque_no, status}}` for each of `payment_names` (Project Payments or
    expenses of `payment_doctype`) that sits on a Cheque that is not Cancelled. `exclude` leaves one
    Cheque out (the one being saved)."""
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
    """Keep only the boxes each line's kind uses, name its payment doctype, and copy a picked
    payment's or expense's amount onto a line that has none (the form copies it once on pick; this
    covers every other writer)."""
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
        if line.payment_doctype and line.amount <= 0:
            row.amount = frappe.db.get_value(line.payment_doctype, line.payment_name, "amount") or 0
        if line.line_type == LINE_SECURED_RECORD and not line.project and line.record_doctype in RECORD_DOCTYPES \
                and line.record_name:
            # The form names only the record; its project is the record's own.
            row.project = frappe.db.get_value(line.record_doctype, line.record_name, "project")


def with_record_projects(lines: list[ChequeLineInput]) -> list[ChequeLineInput]:
    """`lines` with each Secured PO/WO line that names no project given its record's (the form names only
    the record), so an edit compares them with the lines as stored (`normalise_lines` fills them so)."""
    out = []
    for line in lines:
        if line.line_type == LINE_SECURED_RECORD and not line.project and line.record_doctype in RECORD_DOCTYPES \
                and line.record_name:
            line = replace(line, project=frappe.db.get_value(line.record_doctype, line.record_name, "project"))
        out.append(line)
    return out


def lines_problem(doc) -> str | None:
    """Why the Cheque's lines cannot be saved ("Line N: ..."), or None."""
    lines = [parse_line(row.as_dict()) for row in doc.get("lines") or []]
    before = None if doc.is_new() else doc.get_doc_before_save()
    on_before = {_key(parse_line(row.as_dict())) for row in (before.get("lines") if before else []) or []}

    # A Rejected payment is refused only on a live Cheque: a Cancelled one (the backfill's, #1419,
    # whose payments were all Rejected, or one cancelled since #1481) shows nothing as paid, and a
    # Cancelled cheque never leaves Cancelled by hand (#1484: no hand move goes back).
    cancelled = (doc.get("status") or "") == CANCELLED
    cheque_type = doc.get("cheque_type") or CHEQUE_TYPE_PAYMENT
    seen: set[tuple[str, str]] = set()
    secured: set[tuple[str, str]] = set()
    for n, line in enumerate(lines, 1):
        key = _key(line)
        problem = _line_problem(
            line, cheque_type=cheque_type, cheque_vendor=doc.get("vendor"),
            newly_linked=not cancelled and key not in on_before,
        )
        if not problem and key:
            if key in seen:
                problem = f"{_noun(line)} {line.payment_name} is on two lines of this cheque."
            seen.add(key)
        if not problem and line.line_type == LINE_SECURED_RECORD:
            record = (line.record_doctype, line.record_name)
            if record in secured:
                problem = f"{line.record_name} is on two lines of this cheque."
            secured.add(record)
        if problem:
            return f"Line {n}: {problem}"

    if cancelled:
        return None
    exclude = None if doc.is_new() else doc.name
    live = {
        (doctype, payment): other
        for doctype in sorted({d for d, _ in seen})
        for payment, other in live_cheques_of(doctype, [p for d, p in seen if d == doctype], exclude=exclude).items()
    }
    for n, line in enumerate(lines, 1):
        other = live.get(_key(line))
        if other:
            return (
                f"Line {n}: {_noun(line)} {line.payment_name} is already on cheque {other['cheque_no']} "
                f"({other['status']})."
            )
    return None


def _key(line: ChequeLineInput) -> tuple[str, str] | None:
    """What the line pays, as (doctype, name); None while it names nothing."""
    return (line.payment_doctype, line.payment_name) if line.payment_doctype and line.payment_name else None


def _noun(line: ChequeLineInput) -> str:
    return "expense" if line.line_type in EXPENSE_LINE_TYPES else "payment"


def _line_problem(
    line: ChequeLineInput, *, cheque_type: str, cheque_vendor: str | None, newly_linked: bool
) -> str | None:
    problem = line_kind_problem(line, cheque_type=cheque_type)
    if problem:
        return problem
    if line.line_type in EXPENSE_LINE_TYPES:
        return expense_line_problem(line, expense=_expense(line))
    record = None
    if line.record_doctype in RECORD_DOCTYPES and line.record_name:
        record = frappe.db.get_value(line.record_doctype, line.record_name, ["project", "vendor"], as_dict=True)
    if line.line_type == LINE_SECURED_RECORD:
        return secured_line_problem(line, cheque_vendor=cheque_vendor, record=record)
    payment = None
    if line.payment_name:
        payment = frappe.db.get_value(
            PAYMENT_DOCTYPE, line.payment_name, ["document_type", "document_name", "status"], as_dict=True
        )
    return po_wo_line_problem(
        line, cheque_vendor=cheque_vendor, record=record, payment=payment, newly_linked=newly_linked
    )


def _expense(line: ChequeLineInput) -> dict | None:
    """The line's expense as `{project}` (`{}` for a Non Project Expense), or None if it does not exist."""
    if not line.payment_name:
        return None
    doctype = LINE_PAYMENT_DOCTYPES[line.line_type]
    if doctype == PROJECT_EXPENSE_DOCTYPE:
        row = frappe.db.get_value(doctype, line.payment_name, "projects", as_dict=True)
        return {"project": row.projects} if row else None
    return {} if frappe.db.exists(doctype, line.payment_name) else None
