# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What clearing an Old-type cheque does differently (#1478, #1516; owner, 2026-10-21). Part of THE cheques
service; never commits. `status.clear` asks it wherever an Old-type cheque differs from any other.

An Old-type cheque is cleared by its bank line like any other Payment cheque, from Issued, Approval Pending
or Cancelled, every line paid in full. Each record a line names (a Project Payment or an expense) that is
not yet Paid is settled for that line's amount, a payment still waiting first brought on to Reconciliation
Pending by `status._bring_forward`; one already Paid is left as it is. An expense is settled only from
Reconciliation Pending (`clear_rules.clear_problem`). Each line gets one match record, except a Paid record
another bank line already matches. The lines must add up to the line (`clear_rules.old_type_lines_problem`).
"""

import frappe
from frappe.utils import flt

from nirmaan_stack.services.cheques.bank_import_rules import BANK_APPROVAL_NOTE
from nirmaan_stack.services.cheques.clear_rules import OldTypeLine, old_type_lines_problem
from nirmaan_stack.services.cheques.rules import ISSUED, PAYMENT_DOCTYPE, PENDING
from nirmaan_stack.services.cheques.writer import CHEQUES, history_row
from nirmaan_stack.services.outflow_import.allocation import MATCH_SETTLED
from nirmaan_stack.services.outflow_import.normalize import normalize_amount
from nirmaan_stack.services.outflow_import.row_settlement import MATCH_DOCTYPE, record_settlement
from nirmaan_stack.services.outflow_import.settle import SettleResult, link_lines_to_expense


def expense_statuses(doc) -> dict[tuple[str, str], str]:
    """`{(doctype, name): status}` of every expense Old-type cheque `doc`'s lines name (any record but a
    Project Payment), read before the clear writes anything."""
    return {
        (row.payment_doctype, row.payment_name):
            (frappe.db.get_value(row.payment_doctype, row.payment_name, "status") or "").strip()
        for row in doc.get("lines") or []
        if row.payment_name and row.payment_doctype != PAYMENT_DOCTYPE
    }


def lines_problem(doc, payments: list[str], *, bank_amount) -> str | None:
    """Why a bank line of `bank_amount` cannot settle Old-type cheque `doc`'s lines, or None
    (`clear_rules.old_type_lines_problem`, which reads each payment line beside its payment's amount)."""
    amounts = {
        r.name: flt(r.amount)
        for r in frappe.get_all(PAYMENT_DOCTYPE, filters={"name": ["in", payments or [""]]}, fields=["name", "amount"])
    }
    lines = [
        OldTypeLine(idx=row.idx, doctype=row.payment_doctype, name=row.payment_name, amount=flt(row.amount),
                    record_amount=amounts.get(row.payment_name) if row.payment_doctype == PAYMENT_DOCTYPE else None)
        for row in doc.get("lines") or []
    ]
    return old_type_lines_problem(lines, bank_amount=bank_amount)


def issue(cheque: str, *, day: str, user: str) -> None:
    """Approval Pending -> Issued for an Old-type cheque its bank line clears, with `BANK_APPROVAL_NOTE`, as
    `status.issue` writes it for any other (the import review reads that row, `bank_import_rules.bank_start`).
    `status.issue` takes no Old-type cheque: its lines may pay expenses. Issued on `day`, when the import
    approved its payments. Never commits."""
    doc = frappe.get_doc(CHEQUES, cheque, for_update=True)
    doc.append("status_history", history_row(PENDING, ISSUED, user, BANK_APPROVAL_NOTE))
    doc.status = ISSUED
    doc.issue_date = day
    doc.save(ignore_permissions=True)


def settle_lines(doc, line, *, paid_before: set[tuple[str, str]], statement_file_url: str | None,
                 user: str) -> list[SettleResult]:
    """Settle every record Old-type cheque `doc`'s lines name for its line's amount, one match record per
    line (#1516), and return the match records still to write on bank line `line` (`status._record_bank_line`).
    A payment not Paid before was just paid (`status.clear`'s pay loop); an expense is linked to the bank line
    here, through the import's own expense settle (`settle.link_lines_to_expense`), as if the line's amount
    were the bank line's, so it is checked, dated and made Paid exactly as a linked expense is.

    A record in `paid_before` (`(doctype, name)`, Paid before the clear) is left as it is. It gets the
    line's match record only when no bank line matches it yet: a second would count the same money twice,
    and the bank line then shows the gap."""
    legs = []
    for row in doc.get("lines") or []:
        record = (row.payment_doctype, row.payment_name)
        if record in paid_before:
            if not _bank_matched(*record):
                legs.append(_line_leg(row))
            continue
        if row.payment_doctype == PAYMENT_DOCTYPE:
            legs.append(_line_leg(row))
            continue
        # The line's share of the bank line; every other field is the bank line's.
        share = frappe._dict({**line, "amount": flt(row.amount)})
        link_lines_to_expense(
            [share], row.payment_doctype, row.payment_name, user, statement_file_url,
            record_link=lambda _row, result: record_settlement(line, line, result, user),
        )
    return legs


def _line_leg(row) -> SettleResult:
    """The match record of an Old-type cheque line: its record, for the line's amount."""
    amount = normalize_amount(row.amount)
    return SettleResult(doctype=row.payment_doctype, name=row.payment_name, amount=amount, created=False,
                        original_amount=amount)


def _bank_matched(doctype: str, name: str) -> bool:
    """Does a bank line already settle record `name` (a live match record)?"""
    return bool(frappe.db.exists(MATCH_DOCTYPE, {"target_doctype": doctype, "target_name": name,
                                                 "match_kind": MATCH_SETTLED}))
