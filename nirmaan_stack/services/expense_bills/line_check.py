# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Collect payment's bill, checked at import (#1642, spec #1637 stories 19-21).

An open Collect payment keeps its bill on its line (`Outflow Import Row.stored_bill`, copied by the Cashbook job,
`cashbook_bills.store_collect_bills`), because nobody may decide the line for days. That bill gets its Bill check
there, against the line's amount, and the result is kept on the line in the Expense bill's own field names
(`bill_check`, `bill_check_reason`, `read_claimed_at`, `read_total`, `read_invoice_no`, `read_invoice_date`,
`reader_output`). The decide screen shows what Create will lead to (`frontend/src/pages/outflow-import/cashbookCollect.ts`, `collectBillOutcome`), and Create hands the kept
result to the one entry point (`receive.receive_bill`, `kept`), so the bill is not read twice.

    stored at import --> Checking (1 bill: reading queued)  --claim (row lock, committed)--> read_bill --> Matched /
                    \\                                                                       Mismatched / Not read
                     `-> Not checked (2 or more bills merged: never read)

The job is `reading.check_expense_bill`'s shape: it claims the line under its row lock before reading
(`reading.claim`), so a second job for it does nothing, and it reads only a line still open: a line decided while
it waited has its own Expense bill, read on its own (a line Created while Checking hands over no result, and its
Expense bill is read).
"""

from __future__ import annotations

import frappe
from frappe.utils import getdate

from nirmaan_stack.services.expense_bills import reading
from nirmaan_stack.services.expense_bills.bill_check import (
    CHECKING,
    MATCHED,
    MISMATCHED,
    NOT_READ,
    BillRead,
    ReadFailed,
    check_bill,
    paise,
)
from nirmaan_stack.services.outflow_import.status import ROW_MISMATCHED

LINE_DOCTYPE = "Outflow Import Row"
_JOB = "nirmaan_stack.services.expense_bills.line_check.check_collect_line"


def start_check(line: str, line_amount, bill_count: int) -> dict:
    """The Bill check fields a just-stored bill of `line` starts with: Not checked for a file merged from several
    bills (never read, its total the line amount), else Checking with its reading queued once the caller commits.
    The caller writes them with the stored bill, under the line's lock."""
    if bill_count > 1:
        verdict = check_bill(ReadFailed(""), paise(line_amount), bill_count)
        return {"bill_check": verdict.result, "bill_check_reason": verdict.reason}
    reading.queue_after_commit(_JOB, f"collect-bill-check-{line}", LINE_DOCTYPE, line, line=line)
    return {"bill_check": CHECKING, "bill_check_reason": None}


def check_collect_line(line: str) -> None:
    """THE JOB: read one Checking, open Collect payment line's stored bill and keep its Bill check on the line.
    Does nothing for a line another job claimed, one already checked, or one a person decided meanwhile."""
    claimed = reading.claim(
        LINE_DOCTYPE, line, "stored_bill, amount, row_status", still_open=lambda row: row.row_status == ROW_MISMATCHED
    )
    if claimed is None:
        return
    read = reading.read_or_fail(claimed.stored_bill, f"Collect payment {line}")
    verdict = check_bill(read.read, paise(claimed.amount))
    try:
        _write(line, {"bill_check": verdict.result, "bill_check_reason": verdict.reason or None, **reading.read_fields(read)})
    except Exception as exc:
        frappe.db.rollback()
        frappe.local.message_log = []
        frappe.log_error(title=f"Collect payment {line}: the Bill check could not be saved", message=frappe.get_traceback())
        # A claimed line must not stay Checking: no job reads it again.
        try:
            _write(line, {"bill_check": NOT_READ, "bill_check_reason": f"The Bill check could not be saved ({type(exc).__name__})."})
        except Exception:
            frappe.db.rollback()
            frappe.log_error(title=f"Collect payment {line}: left Checking", message=frappe.get_traceback())


def _write(line: str, values: dict) -> None:
    """Raw, committed: `Outflow Import Row` has no doc_events, and only this job and the bill copy write these
    fields, which nothing is derived from."""
    frappe.db.set_value(LINE_DOCTYPE, line, values, update_modified=False)
    frappe.db.commit()


KEPT = ("bill_check", "bill_check_reason", "read_claimed_at", "read_total", "read_invoice_no", "read_invoice_date",
        "reader_output")


def kept_reading(line: str) -> reading.Reading | None:
    """The reading kept on Collect payment line `line`, for Create to hand to `receive_bill`: None while it is still
    Checking (or from before #1642), so the Expense bill is read instead. A line left Checking by a reading that
    stopped (`reading.reading_stopped`) is Not read for that reason, as the main table shows it. A Not checked line
    gives None too: its bill count alone decides it."""
    kept = frappe.db.get_value(LINE_DOCTYPE, line, KEPT, as_dict=True) or frappe._dict()
    if reading.reading_stopped(kept.bill_check, kept.read_claimed_at):
        return reading.Reading(ReadFailed(reading.READING_STOPPED))
    if kept.bill_check == NOT_READ:
        return reading.Reading(ReadFailed(kept.bill_check_reason or "The bill was not read."))
    if kept.bill_check in (MATCHED, MISMATCHED):
        return reading.Reading(
            BillRead(
                total=None if kept.read_total is None else paise(kept.read_total),
                invoice_no=kept.read_invoice_no or "",
                invoice_date=getdate(kept.read_invoice_date) if kept.read_invoice_date else None,
            ),
            frappe.parse_json(kept.reader_output) if kept.reader_output else None,
        )
    return None
