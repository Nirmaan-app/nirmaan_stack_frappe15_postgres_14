# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Give each Collect payment the Cashbook import left open its Expense (#1708, ADR-0015 Amendment C).

Before #1708 the import staged a successful Collect payment as an open line (`Mismatched`) for a person to decide
(ADR-0015 Amendment B decision 6). Owner decision (2026-11-18): it is a wallet spend like any other, and the import
now creates it. This patch does the same for the lines still open: on production, 9 lines of `OFI-26-00337`.

WHICH LINES
    A line of a Cashbook Statement import with `row_kind` 'Collect Payment', at `Mismatched`, with the plan's ledger
    (`suggested_doctype`), no Settled `Outflow Row Match` and no hand decision: no `decided_by`, no "Confirm by hand"
    mark (an Unreconcile leaves one) and no skip origin. A line a person decided is left as they left it.

WHAT EACH GETS
    Its Expense exactly as the job writes one (`cashbook._write_one`: the Cashbook marker, `payment_by` = the
    statement's From, `payment_ref` = its Txn Id, its match row and the line Settled), in the name of the person who
    uploaded its import. The line is first given the values a created line is staged with (`Pending match run`,
    `match_basis`, `auto_matched`), under its row lock, so `_write_one` takes it as its own.
    A bill already stored on the line (`stored_bill`) becomes the Expense's invoice through the one entry point
    (`expense_bills.receive_bill`); its File stays on the line (`file_stays`), and the Expense bill is read afresh.
    Without one, the Expense waits in Pending Invoices Upload -> Cashbook like any spend without a bill.

ONE LINE, ONE TRANSACTION
    A line whose write is refused (its Txn Id's Expense already exists, for one) is rolled back, left open and
    printed; the others go on.

IDEMPOTENT
    A created line is Settled, so a second run selects nothing and writes nothing.

IT PRINTS
    How many Expenses it created per ledger, and each line it could not create.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import frappe

from nirmaan_stack.api.outflow_import.cashbook import _write_one
from nirmaan_stack.api.outflow_import.cashbook_bills import links_of
from nirmaan_stack.api.outflow_import.cashbook_lines import MATCH_BASIS, ROW_DOCTYPE, lock_line_if
from nirmaan_stack.api.outflow_import.expenses import _statement_file_url
from nirmaan_stack.services.expense_bills.receive import receive_bill
from nirmaan_stack.services.outflow_import.cashbook_refunds import COLLECT_ROW_KIND
from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES
from nirmaan_stack.services.outflow_import.row_settlement import refresh_batch_rollup
from nirmaan_stack.services.outflow_import.settle import outflow_import_write
from nirmaan_stack.services.outflow_import.sources import CASHBOOK_SOURCE
from nirmaan_stack.services.outflow_import.status import ROW_MISMATCHED, ROW_PENDING_MATCH


@dataclass
class CreateReport:
    """What one run did: Expenses created per ledger, and the lines it could not create with why."""

    created: dict[str, int] = field(default_factory=lambda: dict.fromkeys(EXPENSE_DOCTYPES, 0))
    failed: list[tuple[str, str]] = field(default_factory=list)

    def text(self) -> str:
        """The lines the patch prints."""
        lines = [f"{doctype}: created {count}" for doctype, count in self.created.items()]
        lines += [f"Not created: {line} ({reason})" for line, reason in self.failed]
        return "\n".join(lines)


def open_collect_lines(lines: list[str] | None = None) -> list[frappe._dict]:
    """Every line the patch creates an Expense for (within `lines` when given), oldest first, with its import's
    uploader."""
    scope = "AND r.name IN %(lines)s" if lines is not None else ""
    return frappe.db.sql(
        f"""
        SELECT r.name, r.import_batch, r.suggested_doctype, r.stored_bill, r.bill_links, b.uploaded_by
        FROM "tabOutflow Import Row" r
        JOIN "tabOutflow Import Batch" b ON b.name = r.import_batch AND b.source = %(source)s
        WHERE r.row_kind = %(kind)s AND r.row_status = %(open)s
          AND COALESCE(r.suggested_doctype, '') <> ''
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
            "kind": COLLECT_ROW_KIND,
            "open": ROW_MISMATCHED,
            "lines": tuple(lines or ("",)),
        },
        as_dict=True,
    )


def create_open_collect_payment_expenses(lines: list[str] | None = None) -> CreateReport:
    """Create the Expense of every open Collect payment line (`lines` scopes the run, for a test); return the counts."""
    report = CreateReport()
    touched: set[str] = set()
    for line in open_collect_lines(lines):
        try:
            created = _create_one(line)
        except Exception as exc:
            frappe.db.rollback()
            report.failed.append((line.name, f"{type(exc).__name__}: {exc}"))
            continue
        if created:
            frappe.db.commit()
            report.created[line.suggested_doctype] += 1
            touched.add(line.import_batch)
        else:
            frappe.db.rollback()
    for batch in sorted(touched):
        refresh_batch_rollup(batch)
    frappe.db.commit()
    return report


def _create_one(line) -> bool:
    """Write one line's Expense as the job does, then file its stored bill. Never commits. Returns whether it wrote:
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
        {"row_status": ROW_PENDING_MATCH, "match_basis": MATCH_BASIS, "auto_matched": 1, "outcome_note": None},
        update_modified=False,
    )
    actor = line.uploaded_by or "Administrator"
    if not _write_one(line.name, line.import_batch, actor, _statement_file_url(line.import_batch)):
        return False
    if line.stored_bill:
        doctype, expense = frappe.db.get_value(ROW_DOCTYPE, line.name, ["suggested_doctype", "suggested_name"])
        with outflow_import_write():
            receive_bill(
                frappe.get_doc(doctype, expense, for_update=True),
                line.stored_bill,
                None,
                None,
                actor,
                bill_count=max(len(links_of(line)), 1),
                file_stays=True,
            )
    return True


def execute():
    """The patch: create the whole site's open Collect payments' Expenses, and print the counts."""
    print(create_open_collect_payment_expenses().text())
