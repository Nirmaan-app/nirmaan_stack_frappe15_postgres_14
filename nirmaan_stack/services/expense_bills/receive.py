# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""THE ONE ENTRY POINT for a bill landing on a wallet spend or a card spend (#1639, spec #1637, ADR-0045).

`receive_bill` mirrors the file (and any number and date a person typed) onto the Expense, records the Expense
bill as Checking -- the previous one of that Expense stays as history, no longer latest -- and queues its reading
(`expense_bills.reading`) for after the commit. A file merged from several bills (the Cashbook import's, #1641) is
recorded Not checked at once, its total the line amount, and is never read; a Collect payment's bill brings the
reading made at import (#1642) and is recorded from it, never read again. It never refuses a bill and never waits for the reading
(GLOSSARY *Bill check*: a Bill check never stops a bill from being attached).

Every code path that writes `invoice_attachment` on a wallet spend or a card spend must come through here;
`services/expense_bills/test_bill_writers.py` proves it, and names every other writer of the field with its reason.
"""

from __future__ import annotations

from decimal import Decimal

import frappe
from frappe.utils import now_datetime

from nirmaan_stack.services.expense_bills import APPROVED, BILL_DOCTYPE, PENDING
from nirmaan_stack.services.expense_bills.bill_check import CHECKING, ReadFailed, check_bill, money
from nirmaan_stack.services.expense_bills.reading import Reading, queue_reading, record_check
from nirmaan_stack.services.outflow_import.expense_links import list_expense_lines


def is_wallet_or_card_spend(doc) -> bool:
    """Is Expense `doc` a wallet spend or a card spend, the only Expenses whose bill is an Expense bill?"""
    return bool(doc.get("cashbook_batch") or doc.get("credit_card_statement"))


def receive_bill(
    doc,
    file_url: str,
    invoice_ref: str | None,
    invoice_date: str | None,
    user: str,
    bill_count: int = 1,
    *,
    approve: bool = False,
    kept: Reading | None = None,
    file_stays: bool = False,
) -> str:
    """File `file_url` as Expense `doc`'s bill (`doc` read `FOR UPDATE` by the caller) and record it; returns the
    Expense bill's name. Saves `doc` through the document layer (its `doc_events` run). Never commits: the caller
    does, and the reading is queued only once that commit lands.

    `bill_count` is how many bills the file holds. Two or more (one PDF merged from a line's bill links) give the
    verdict's Not checked straight away: its total is the line amount, no number or date, Pending, and no reading
    is queued (a merged file gives one guessed total, spec #1637 story 6).

    The typed `invoice_ref` and `invoice_date` go on the Expense and on the bill alike (`invoice_no`, `invoice_date`);
    a Matched reading later fills only what is still empty (`reading.record_check`).

    `approve`: the bill is approved at once in `user`'s name (an approver replacing a paid Expense's bill on Payment
    Done, #1643). Its Bill check still runs and is recorded, and never replaces that number or date.

    `kept` is a reading already made of this file (a Collect payment's, kept on its line at import, #1642): the
    verdict is taken from it against the line, recorded as the job records one (a Matched bill auto-approved, its
    number and date filled where empty), and no reading is queued.

    `file_stays` keeps the file's one `File` where it is (a Collect payment's stays on its line, #1642): the URL is
    written after the save, raw, so Frappe's attach-on-save hook mints no `File` on the Expense sharing its stored
    object (an undo deletes an Expense with every File attached to it, and the cloud app deletes the object by its
    key). The Expense bill never gets a `File` row of its own: `bill_file` is a plain URL (Small Text, not Attach,
    which alone makes Frappe mint one; a text column, since the cloud storage app's URLs run up to 270 characters),
    so the one `File` stays the Expense's (or the line's).
    """
    url = file_url.strip()
    if not file_stays:
        doc.invoice_attachment = url
    doc.invoice_ref = (invoice_ref or "").strip() or None
    doc.invoice_date = invoice_date or None
    doc.save(ignore_permissions=True)
    if file_stays:
        # Raw, after the save: see the docstring. Nothing is derived from `invoice_attachment`, so no hook is owed.
        frappe.db.set_value(doc.doctype, doc.name, "invoice_attachment", url, update_modified=False)
        doc.invoice_attachment = url

    line, line_amount = statement_line_of(doc.doctype, doc.name, doc.amount)
    retire_bills(doc.doctype, doc.name)
    if bill_count > 1:
        kept = Reading(ReadFailed("A merged file is not read."))
    verdict = check_bill(kept.read, line_amount, bill_count) if kept is not None else None
    bill = frappe.get_doc(
        {
            "doctype": BILL_DOCTYPE,
            "expense_doctype": doc.doctype,
            "expense": doc.name,
            "is_latest": 1,
            "bill_file": url,
            "uploaded_by": user,
            "status": PENDING,
            "statement_line": line,
            "line_amount": float(line_amount),
            "bill_check": verdict.result if verdict else CHECKING,
            "invoice_no": doc.invoice_ref,
            "invoice_date": doc.invoice_date,
        }
    )
    if approve:
        bill.update({"status": APPROVED, "approved_by": user, "approved_on": now_datetime()})
    bill.insert(ignore_permissions=True)
    if verdict is None:
        queue_reading(bill.name)
    else:
        record_check(bill.name, kept, verdict)
    return bill.name


def retire_bills(doctype: str, expense: str) -> None:
    """Every Expense bill of Expense `expense` becomes history (`is_latest` 0): a new bill is landing, or the
    Expense is being deleted (an Unreconcile's undo, or any other delete; `integrations/controllers/expense_bills.on_trash`).
    A deleted Expense's bills are never deleted, and every queue and list joins the Expense, so they leave them all."""
    # Raw: `Expense Bill` has no doc_events, and `is_latest` is a history marker nothing is derived from.
    frappe.db.sql(
        f"""UPDATE "tab{BILL_DOCTYPE}" SET is_latest = 0
            WHERE expense_doctype = %s AND expense = %s AND is_latest = 1""",
        (doctype, expense),
    )


def statement_line_of(doctype: str, expense: str, expense_amount) -> tuple[str | None, Decimal]:
    """The statement line that recorded the spend and that line's amount, read through the one live-link read
    (`outflow_import.expense_links.list_expense_lines`).

    A wallet spend or a card spend is made from exactly one line, its amount equal to the line's at creation, so its
    one line is the one. Should it carry several, the latest is taken. An Expense with no line (none is expected),
    or whose line was deleted, is compared against its own amount, with no line named.
    """
    lines = [line for line in list_expense_lines(doctype, expense) if line.line_amount is not None]
    if lines:
        return lines[-1].import_row, money(lines[-1].line_amount)
    return None, money(expense_amount)
