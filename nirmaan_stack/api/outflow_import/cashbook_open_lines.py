# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Create the Expense of a Cashbook line an earlier import left open (spec #1711): the shape both one-time patches
share, `v3_0.create_open_collect_payment_expenses` (#1708) and `v3_0.create_open_cashbook_refund_expenses` (#1709).
Each patch says only which lines it takes and where each one goes; this module does the rest.

WHICH LINES (`open_lines`)
    A line of a Cashbook Statement import of the given statement Types, at `Mismatched`, with no Settled
    `Outflow Row Match` and no hand decision: no `decided_by`, no "Confirm by hand" mark (an Unreconcile leaves one)
    and no skip origin. A line a person decided is left as they left it.

WHAT EACH GETS (`create_open_lines`)
    Under its row lock, and only while it is still open, the line is given its placement and the values a created
    line is staged with (`Pending match run`, `match_basis`, `auto_matched`); `cashbook.write_line_expense` then
    writes its Expense exactly as the job does, in the name of the person who uploaded its import.

ONE LINE, ONE TRANSACTION. A line whose write is refused is rolled back, left open and printed; the others go on.
A line already booked (`already_booked`) is left open and counted, not printed: it would print on every run.

IDEMPOTENT. A created line is Settled, so a second run selects nothing and writes nothing.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Iterable

import frappe

from nirmaan_stack.api.outflow_import.cashbook import write_line_expense
from nirmaan_stack.api.outflow_import.cashbook_lines import MATCH_BASIS, ROW_DOCTYPE, lock_line_if
from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES, PROJECT_EXPENSE_DOCTYPE
from nirmaan_stack.services.outflow_import.row_settlement import refresh_batch_rollup
from nirmaan_stack.services.outflow_import.sources import CASHBOOK_SOURCE
from nirmaan_stack.services.outflow_import.status import ROW_MISMATCHED, ROW_PENDING_MATCH


@dataclass(frozen=True)
class LinePlace:
    """Where a line's Expense goes: the ledger, the project (Project Expenses only) and the expense type."""

    ledger: str
    project: str | None
    expense_type: str


@dataclass
class CreateReport:
    """What one run did: Expenses created per ledger, how many lines were already booked, and the lines it could not
    create with why."""

    created: dict[str, int] = field(default_factory=lambda: dict.fromkeys(EXPENSE_DOCTYPES, 0))
    already_booked: int = 0
    failed: list[tuple[str, str]] = field(default_factory=list)

    def text(self) -> str:
        """The lines a patch prints."""
        lines = [f"{doctype}: created {count}" for doctype, count in self.created.items()]
        if self.already_booked:
            lines.append(f"Already booked: {self.already_booked}")
        lines += [f"Not created: {line} ({reason})" for line, reason in self.failed]
        return "\n".join(lines)


def open_lines(kinds: Iterable[str], lines: list[str] | None = None) -> list[frappe._dict]:
    """Every open line of these statement Types (within `lines` when given), oldest first, with its import's
    uploader."""
    scope = "AND r.name IN %(lines)s" if lines is not None else ""
    return frappe.db.sql(
        f"""
        SELECT r.name, r.import_batch, r.transfer_id, r.amount, r.added_on, r.remarks, r.suggested_doctype,
               r.suggested_expense_type, r.resolved_project, r.stored_bill, r.bill_links, b.uploaded_by
        FROM "tabOutflow Import Row" r
        JOIN "tabOutflow Import Batch" b ON b.name = r.import_batch AND b.source = %(source)s
        WHERE r.row_kind IN %(kinds)s AND r.row_status = %(open)s
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
            "kinds": tuple(sorted(kinds)),
            "open": ROW_MISMATCHED,
            "lines": tuple(lines or ("",)),
        },
        as_dict=True,
    )


def create_open_lines(
    lines: list[frappe._dict],
    place_of: Callable[[frappe._dict], LinePlace],
    *,
    already_booked: Callable[[frappe._dict], str | None] | None = None,
    after_write: Callable[[frappe._dict, str], None] | None = None,
) -> CreateReport:
    """Create each line's Expense where `place_of` puts it, one transaction per line, and return the counts.
    `already_booked(line)` names an Expense that already holds the line (it is then left open and counted);
    `after_write(line, actor)` runs in the line's transaction after its Expense is written."""
    report = CreateReport()
    touched: set[str] = set()
    for line in lines:
        actor = line.uploaded_by or "Administrator"
        try:
            if already_booked and already_booked(line):
                report.already_booked += 1
                continue
            place = place_of(line)
            created = _create_one(line, place, actor)
            if created and after_write:
                after_write(line, actor)
        except Exception as exc:
            frappe.db.rollback()
            report.failed.append((line.name, f"{type(exc).__name__}: {exc}"))
            continue
        if created:
            frappe.db.commit()
            report.created[place.ledger] += 1
            touched.add(line.import_batch)
        else:
            frappe.db.rollback()
    for batch in sorted(touched):
        refresh_batch_rollup(batch)
    frappe.db.commit()
    return report


def _create_one(line, place: LinePlace, actor: str) -> bool:
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
    # line with, and `write_line_expense` then writes the line as the job does.
    frappe.db.set_value(
        ROW_DOCTYPE,
        line.name,
        {
            "row_status": ROW_PENDING_MATCH,
            "match_basis": MATCH_BASIS,
            "auto_matched": 1,
            "outcome_note": None,
            "suggested_doctype": place.ledger,
            "suggested_expense_type": place.expense_type,
            "resolved_project": place.project if place.ledger == PROJECT_EXPENSE_DOCTYPE else None,
        },
        update_modified=False,
    )
    return write_line_expense(line.name, line.import_batch, actor)
