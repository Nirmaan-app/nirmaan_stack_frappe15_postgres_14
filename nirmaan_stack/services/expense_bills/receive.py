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

import frappe

from nirmaan_stack.services.expense_bills import BILL_DOCTYPE, PENDING
from nirmaan_stack.services.expense_bills.bill_check import CHECKING
from nirmaan_stack.services.expense_bills.reading import queue_reading


def receive_bill(doc, file_url: str, invoice_ref: str | None, invoice_date: str | None, user: str) -> str:
    """File `file_url` as Expense `doc`'s bill (`doc` read `FOR UPDATE` by the caller) and record it; returns the
    Expense bill's name. Saves `doc` through the document layer (its `doc_events` run). Never commits: the caller
    does, and the reading is queued only once that commit lands."""
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
            "line_amount": line_amount,
        }
    ).insert(ignore_permissions=True)
    queue_reading(bill.name)
    return bill.name


def statement_line_of(doctype: str, expense: str, expense_amount) -> tuple[str | None, float]:
    """The statement line that recorded the spend (its Settled match) and that line's amount.

    A wallet spend or a card spend is made from exactly one line, its amount equal to the line's at creation. An
    Expense with no such line (none is expected) is compared against its own amount, with no line named.
    """
    rows = frappe.db.sql(
        """
        SELECT r.name, r.amount
        FROM "tabOutflow Row Match" m JOIN "tabOutflow Import Row" r ON r.name = m.import_row
        WHERE m.target_doctype = %s AND m.target_name = %s AND m.match_kind = 'Settled'
        ORDER BY m.creation DESC, m.name DESC
        LIMIT 1
        """,
        (doctype, expense),
        as_dict=True,
    )
    if rows:
        return rows[0].name, float(rows[0].amount or 0)
    return None, float(expense_amount or 0)
