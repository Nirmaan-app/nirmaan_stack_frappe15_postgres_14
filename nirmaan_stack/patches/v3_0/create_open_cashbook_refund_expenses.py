# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Give each wallet refund the Cashbook import left open its *Wallet refund expense* (#1709, ADR-0015 Amendment D).

Before #1709 a refund that did not pair with its spend (Refund to Wallet, Credit Adjustment) was staged as an open
line (`Mismatched`) for a person to decide. Owner decision (2026-11-18): it is booked at minus its Credit where its
spend is booked. This patch does the same for the lines still open: on production, one line of `OFI-26-00337`
(Rs 11,248, 22 Jun 2026).

WHICH LINES
    A line of a Cashbook import with `row_kind` 'Refund to Wallet' or 'Credit Adjustment', at `Mismatched`, above
    zero, with no Settled `Outflow Row Match` and no hand decision: no `decided_by`, no "Confirm by hand" mark (an
    Unreconcile leaves one) and no skip origin. A line a person decided is left as they left it.

WHAT EACH GETS
    Its placement as the import plans one today (`cashbook_refund_expense.refund_placement`): the spend's Expense as
    it is now when it has one (`cashbook_refund_spends.spend_expenses`), else a Non Project Expense typed from the
    refund's remark. The line is given that placement and the values a created line is staged with, under its row
    lock, and `cashbook._write_one` then writes its Expense exactly as the job does, in the name of the person who
    uploaded its import. A refund whose negative Expense is already booked (its Txn Id at minus its Credit) is left
    open and printed.

ONE LINE, ONE TRANSACTION. A line whose write is refused is rolled back, left open and printed; the others go on.

IDEMPOTENT. A created line is Settled, so a second run selects nothing and writes nothing.

IT PRINTS how many Expenses it created per ledger, and each line it could not create.
"""

from __future__ import annotations

from decimal import Decimal

import frappe

from nirmaan_stack.api.outflow_import.cashbook import _booked_index, _write_one
from nirmaan_stack.api.outflow_import.cashbook_lines import MATCH_BASIS, ROW_DOCTYPE, lock_line_if
from nirmaan_stack.api.outflow_import.cashbook_refund_spends import spend_expenses
from nirmaan_stack.api.outflow_import.expenses import _statement_file_url
from nirmaan_stack.patches.v3_0.create_open_collect_payment_expenses import CreateReport
from nirmaan_stack.services.outflow_import.candidates import load_expense_rules
from nirmaan_stack.services.outflow_import.cashbook_refund_expense import refund_placement
from nirmaan_stack.services.outflow_import.cashbook_refunds import REFUND_ROW_KINDS, refunded_spend_id
from nirmaan_stack.services.outflow_import.duplicates import find_prior_sighting
from nirmaan_stack.services.outflow_import.ledgers import PROJECT_EXPENSE_DOCTYPE
from nirmaan_stack.services.outflow_import.row_settlement import refresh_batch_rollup
from nirmaan_stack.services.outflow_import.sources import CASHBOOK_SOURCE
from nirmaan_stack.services.outflow_import.status import ROW_MISMATCHED, ROW_PENDING_MATCH


def open_refund_lines(lines: list[str] | None = None) -> list[frappe._dict]:
    """Every line the patch books (within `lines` when given), oldest first, with its import's uploader."""
    scope = "AND r.name IN %(lines)s" if lines is not None else ""
    return frappe.db.sql(
        f"""
        SELECT r.name, r.import_batch, r.transfer_id, r.amount, r.added_on, r.remarks, b.uploaded_by
        FROM "tabOutflow Import Row" r
        JOIN "tabOutflow Import Batch" b ON b.name = r.import_batch AND b.source = %(source)s
        WHERE r.row_kind IN %(kinds)s AND r.row_status = %(open)s AND r.amount > 0
          AND COALESCE(r.decided_by, '') = '' AND COALESCE(r.confirm_by_hand, 0) = 0
          AND COALESCE(r.skip_origin, '') = ''
          AND NOT EXISTS (
              SELECT 1 FROM "tabOutflow Row Match" m WHERE m.import_row = r.name AND m.match_kind = 'Settled'
          )
          {scope}
        ORDER BY r.creation, r.name
        """,
        {
            "source": CASHBOOK_SOURCE,
            "kinds": tuple(sorted(REFUND_ROW_KINDS)),
            "open": ROW_MISMATCHED,
            "lines": tuple(lines or ("",)),
        },
        as_dict=True,
    )


def create_open_refund_expenses(lines: list[str] | None = None) -> CreateReport:
    """Book every open wallet refund line (`lines` scopes the run, for a test); return the counts."""
    report = CreateReport()
    open_lines = open_refund_lines(lines)
    spends = spend_expenses(refunded_spend_id(line.transfer_id) for line in open_lines)
    rules = load_expense_rules()
    touched: set[str] = set()
    for line in open_lines:
        place = refund_placement(
            line.transfer_id, line.remarks or "", spends.get(refunded_spend_id(line.transfer_id)), None, rules
        )
        booked = _already_booked(line)
        if booked:
            report.failed.append((line.name, f"already booked as {booked}"))
            continue
        try:
            created = _create_one(line, place)
        except Exception as exc:
            frappe.db.rollback()
            report.failed.append((line.name, f"{type(exc).__name__}: {exc}"))
            continue
        if created:
            frappe.db.commit()
            report.created[place["ledger"]] += 1
            touched.add(line.import_batch)
        else:
            frappe.db.rollback()
    for batch in sorted(touched):
        refresh_batch_rollup(batch)
    frappe.db.commit()
    return report


def _already_booked(line) -> str | None:
    """The Expense already holding this refund (its Txn Id at minus its Credit), as the import's check finds it."""
    when = line.added_on.date() if line.added_on else None
    return find_prior_sighting(_booked_index([line.transfer_id]), line.transfer_id, -Decimal(str(line.amount)), when)


def _create_one(line, place: dict) -> bool:
    """Stage the line as the job's and write its Expense as the job does. Never commits. Returns whether it wrote:
    `False` when the line changed since it was selected."""
    still_open = lock_line_if(
        line.name,
        lambda row: row.row_status == ROW_MISMATCHED and not row.decided_by and not row.confirm_by_hand,
        columns="row_status, decided_by, confirm_by_hand",
    )
    if still_open is None:
        return False
    # Raw: `Outflow Import Row` has no doc_events; these are the values `cashbook_lines.line_values` stages a created
    # line with, and `_write_one` then writes the line as the job does.
    frappe.db.set_value(
        ROW_DOCTYPE,
        line.name,
        {
            "row_status": ROW_PENDING_MATCH,
            "match_basis": MATCH_BASIS,
            "auto_matched": 1,
            "outcome_note": None,
            "suggested_doctype": place["ledger"],
            "suggested_expense_type": place["expense_type"],
            "resolved_project": place["project"] if place["ledger"] == PROJECT_EXPENSE_DOCTYPE else None,
        },
        update_modified=False,
    )
    return _write_one(line.name, line.import_batch, line.uploaded_by or "Administrator", _statement_file_url(line.import_batch))


def execute():
    """The patch: book the whole site's open wallet refunds, and print the counts."""
    print(create_open_refund_expenses().text())
