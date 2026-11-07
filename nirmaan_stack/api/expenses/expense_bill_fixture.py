# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Test helpers for every suite that attaches a bill to a wallet spend or a card spend (#1639): the queue
captured, never reached, and the Expense bills purged."""

from unittest.mock import patch

import frappe

from nirmaan_stack.api.outflow_import.test_card_import import purge_records
from nirmaan_stack.services.expense_bills import BILL_DOCTYPE


def capture_jobs(case) -> list:
    """Replace `frappe.enqueue` for the rest of `case`'s test with a recorder: [(method, kwargs)].

    ⚠️ THE QUEUE IS SHARED WITH THE MAIN BENCH: a real enqueue would hand this test's bill to its worker."""
    jobs = []
    patcher = patch.object(frappe, "enqueue", side_effect=lambda method, **kw: jobs.append((method, kw)))
    patcher.start()
    case.addCleanup(patcher.stop)
    return jobs


def purge_expense_bills(expenses: list[str]) -> None:
    """Every Expense bill of these Expenses, with its Version rows and the File row Frappe attaches to it on insert
    (its `bill_file`; the stored file is the Expense's, left alone). Raw and committed (`purge_records`)."""
    if expenses:
        bills = frappe.get_all(BILL_DOCTYPE, filters={"expense": ["in", expenses]}, pluck="name")
        if bills:
            frappe.db.delete("File", {"attached_to_doctype": BILL_DOCTYPE, "attached_to_name": ["in", bills]})
        purge_records(BILL_DOCTYPE, bills)
