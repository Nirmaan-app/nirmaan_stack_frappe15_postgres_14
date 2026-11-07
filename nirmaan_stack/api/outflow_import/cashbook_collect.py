# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A person decides each Collect payment (#1595, spec #1585, ADR-0015 Amendment B decision 6).

A *Collect payment* is a wallet line where a shop asked for money and the employee approved it. It may not be
a company spend, so the import never records it on its own: the plan stages it as an open line at
`Mismatched` (`services/outflow_import/cashbook_collect`), which the job never takes, and a person picks
Create expense or Skip by hand on the main table.

Its bill is copied at import, by the Cashbook job (`cashbook_bills.store_collect_bills`): the links die 7 days after
export, and the decision may come later. Its Bill check runs there too, against the line's amount, and is kept on
the line (`expense_bills.line_check`, #1642). This module holds what a Create from such a line adds
(`statement_line_create_extras`, read by `expenses.create_expense`): the Cashbook marker, so the Expense waits in
Pending Invoices Upload -> Cashbook; and, once the Expense is made, its stored bill filed through the one entry point
with the kept result (`file_stored_bill`), so it is not read again. Skip makes no Expense bill.
"""

from __future__ import annotations

import frappe

from nirmaan_stack.api.outflow_import.cashbook_bills import links_of
from nirmaan_stack.services.expense_bills.line_check import kept_reading
from nirmaan_stack.services.expense_bills.receive import receive_bill
from nirmaan_stack.services.outflow_import.settle import outflow_import_write
from nirmaan_stack.services.outflow_import.sources import CASHBOOK_SOURCE


def statement_line_create_extras(doc, source: str | None) -> dict:
    """What a Create on the main table adds for a line staged by the Cashbook Statement import (#1595): the
    Cashbook marker (`cashbook_batch`), so the new Expense waits in the Cashbook tab while it has no invoice. Empty
    for any other line. The stored bill is filed after the Create (`file_stored_bill`).

    Such a line is told apart by its stored statement Type (`row_kind`), which only that import writes: an older
    Cashbook line has none, and its Expense must never wait (spec #1585 "Which Expenses wait").
    """
    if not _staged_by_cashbook_import(doc, source):
        return {}
    return {"cashbook_batch": doc["import_batch"]}


def file_stored_bill(doc, source: str | None, result, actor: str) -> None:
    """File the line's stored bill as the bill of the Expense Create just made (`result`), through the one entry
    point (`expense_bills.receive_bill`, #1642), with the Bill check kept on the line: a Matched bill is
    auto-approved, any other result waits in Pending Approval, and a line still Checking hands over nothing, so
    its Expense bill is read. Runs after the Create's settlement is recorded, so the Expense bill finds its line.
    Never commits.

    The URL is copied, never a second File made: its one File stays attached to the line (`file_stays`).
    """
    if not (_staged_by_cashbook_import(doc, source) and doc.get("stored_bill")):
        return
    line = frappe.db.get_value(
        "Outflow Import Row",
        doc["name"],
        ["name", "stored_bill", "bill_links", "bill_check", "bill_check_reason", "read_total", "read_invoice_no",
         "read_invoice_date", "reader_output"],
        as_dict=True,
    )
    expense = frappe.get_doc(result.doctype, result.name, for_update=True)
    with outflow_import_write():
        receive_bill(
            expense,
            line.stored_bill,
            expense.invoice_ref,
            expense.invoice_date,
            actor,
            bill_count=max(len(links_of(line)), 1),
            kept=kept_reading(line),
            file_stays=True,
        )


def _staged_by_cashbook_import(doc, source: str | None) -> bool:
    return source == CASHBOOK_SOURCE and bool((doc.get("row_kind") or "").strip())
