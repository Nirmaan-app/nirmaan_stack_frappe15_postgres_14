# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Test helpers for every suite that attaches a bill to a wallet spend or a card spend (#1639): a bill URL of
real length, the queue captured, never reached, and the Expense bills purged."""

from unittest.mock import patch
from urllib.parse import quote

import frappe

from nirmaan_stack.api.outflow_import.test_card_import import purge_records
from nirmaan_stack.services.expense_bills import BILL_DOCTYPE


def cloud_url(file_name: str, doctype: str = "Non Project Expenses") -> str:
    """A bill's URL as the cloud storage app (`frappe_gcp_attachment`) stores it: the object key names the day, the
    Expense's doctype and a random prefix before the file name, and the file name is repeated, both URL-encoded, so
    a real one runs 200 to 270 characters (every Project Expenses bill link in the 2026-10-28 data is over 140).
    Every test that lands an Expense bill uses this, never a short URL: `bill_file` and `invoice_attachment` must
    hold the whole of it (spec #1637 review)."""
    key = f"attachments/2026/11/07/{doctype}/{frappe.generate_hash(length=10)}_{file_name}"
    return (
        "/api/method/frappe_gcp_attachment.controller.generate_file"
        f"?key={quote(key, safe='')}&file_name={quote(file_name, safe='')}"
    )


def capture_jobs(case) -> list:
    """Replace `frappe.enqueue` for the rest of `case`'s test with a recorder: [(method, kwargs)].

    ⚠️ THE QUEUE IS SHARED WITH THE MAIN BENCH: a real enqueue would hand this test's bill to its worker."""
    jobs = []
    patcher = patch.object(frappe, "enqueue", side_effect=lambda method, **kw: jobs.append((method, kw)))
    patcher.start()
    case.addCleanup(patcher.stop)
    return jobs


def purge_expense_bills(expenses: list[str]) -> None:
    """Every Expense bill of these Expenses, with its Version rows (a bill owns no File row: its `bill_file` is the
    Expense's own file's URL). Rolls back first (a test may leave the transaction aborted); raw, committed, and a
    failure rolled back and reported (`purge_records`)."""
    frappe.db.rollback()
    bills = frappe.get_all(BILL_DOCTYPE, filters={"expense": ["in", expenses]}, pluck="name") if expenses else []
    if bills:
        purge_records(BILL_DOCTYPE, bills)
