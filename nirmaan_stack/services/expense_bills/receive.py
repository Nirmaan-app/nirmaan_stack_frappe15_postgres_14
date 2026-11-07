# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""THE ONE ENTRY POINT for a bill landing on a wallet spend or a card spend (#1639, spec #1637, ADR-0045).

`receive_bill` mirrors the file (and any number and date a person typed) onto the Expense, records the Expense
bill as Checking -- the previous one of that Expense stays as history, no longer latest -- and queues its reading
(`expense_bills.reading`) for after the commit. It never refuses a bill and never waits for the reading
(GLOSSARY *Bill check*: a Bill check never stops a bill from being attached).

Every code path that writes `invoice_attachment` on a wallet spend or a card spend must come through here;
`services/expense_bills/test_bill_writers.py` proves it, and names the writers later tickets of spec #1637 move.
"""

from __future__ import annotations

from decimal import Decimal

import frappe
from frappe.utils import now_datetime

from nirmaan_stack.services.expense_bills import APPROVED, BILL_DOCTYPE, PENDING
from nirmaan_stack.services.expense_bills.bill_check import CHECKING
from nirmaan_stack.services.expense_bills.reading import queue_reading
from nirmaan_stack.services.outflow_import.expense_links import list_expense_lines


def is_wallet_or_card_spend(doc) -> bool:
    """Is Expense `doc` a wallet spend or a card spend, the only Expenses whose bill is an Expense bill?"""
    return bool(doc.get("cashbook_batch") or doc.get("credit_card_statement"))


def receive_bill(
    doc, file_url: str, invoice_ref: str | None, invoice_date: str | None, user: str, *, approve: bool = False
) -> str:
    """File `file_url` as Expense `doc`'s bill (`doc` read `FOR UPDATE` by the caller) and record it; returns the
    Expense bill's name. Saves `doc` through the document layer (its `doc_events` run). Never commits: the caller
    does, and the reading is queued only once that commit lands.

    `approve`: the bill is approved at once in `user`'s name, with the number and date they typed (an approver
    replacing a paid Expense's bill on Payment Done, #1643). Its Bill check still runs and is recorded, and never
    replaces that number or date."""
    doc.invoice_attachment = file_url.strip()
    doc.invoice_ref = (invoice_ref or "").strip() or None
    doc.invoice_date = invoice_date or None
    doc.save(ignore_permissions=True)

    line, line_amount = statement_line_of(doc.doctype, doc.name, doc.amount)
    # Raw: `Expense Bill` has no doc_events, and `is_latest` is a history marker nothing is derived from.
    frappe.db.sql(
        f"""UPDATE "tab{BILL_DOCTYPE}" SET is_latest = 0
            WHERE expense_doctype = %s AND expense = %s AND is_latest = 1""",
        (doc.doctype, doc.name),
    )
    bill = frappe.get_doc(
        {
            "doctype": BILL_DOCTYPE,
            "expense_doctype": doc.doctype,
            "expense": doc.name,
            "is_latest": 1,
            "bill_file": doc.invoice_attachment,
            "uploaded_by": user,
            "bill_check": CHECKING,
            "status": PENDING,
            "statement_line": line,
            "line_amount": float(line_amount),
        }
    )
    if approve:
        bill.update(
            {
                "status": APPROVED,
                "approved_by": user,
                "approved_on": now_datetime(),
                "invoice_no": doc.invoice_ref,
                "invoice_date": doc.invoice_date,
            }
        )
    bill.insert(ignore_permissions=True)
    queue_reading(bill.name)
    return bill.name


def statement_line_of(doctype: str, expense: str, expense_amount) -> tuple[str | None, Decimal]:
    """The statement line that recorded the spend and that line's amount, read through the one live-link read
    (`outflow_import.expense_links.list_expense_lines`).

    A wallet spend or a card spend is made from exactly one line, its amount equal to the line's at creation, so its
    one line is the one. Should it carry several, the latest is taken. An Expense with no line (none is expected),
    or whose line was deleted, is compared against its own amount, with no line named.
    """
    lines = [line for line in list_expense_lines(doctype, expense) if line.line_amount is not None]
    if lines:
        return lines[-1].import_row, Decimal(str(lines[-1].line_amount))
    return None, Decimal(str(expense_amount or 0))
