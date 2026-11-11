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
from nirmaan_stack.services.expense_bills.bill_check import check_bill
from nirmaan_stack.services.expense_bills.line_check import kept_reading
from nirmaan_stack.services.expense_bills.receive import receive_bill
from nirmaan_stack.services.outflow_import.normalize import normalize_amount
from nirmaan_stack.services.outflow_import.settle import ExpenseInvoice, outflow_import_write
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
    extras: dict = {"cashbook_batch": doc["import_batch"]}
    matched = _matched_number_and_date(doc)
    if matched:
        extras["invoice"] = matched
    return extras


def _matched_number_and_date(doc) -> ExpenseInvoice | None:
    """A Matched stored bill's number and date, for the Expense's insert (#1642).

    ⚠️ ON THE INSERT, NOT SAVED AFTER IT. The bill is filed after the settlement is recorded
    (`file_stored_bill`), and a save then that fills them would be a Version after the match, which Unreconcile
    reads as a person's edit and refuses to delete the Expense. Written here, the filing finds them already set
    and saves nothing new."""
    if not doc.get("stored_bill") or _bill_count(doc["name"]) > 1:
        return None
    kept = kept_reading(doc["name"])
    if kept is None:
        return None
    verdict = check_bill(kept.read, normalize_amount(doc.get("amount")))
    if not verdict.auto_approves:
        return None
    return ExpenseInvoice(number=verdict.invoice_no, date=verdict.invoice_date)


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
    expense = frappe.get_doc(result.doctype, result.name, for_update=True)
    with outflow_import_write():
        receive_bill(
            expense,
            doc["stored_bill"],
            expense.invoice_ref,
            expense.invoice_date,
            actor,
            bill_count=_bill_count(doc["name"]),
            kept=kept_reading(doc["name"]),
            file_stays=True,
        )


def _bill_count(line: str) -> int:
    """How many bills the line's stored file holds: one per bill link (two or more were merged into one PDF)."""
    return max(len(links_of(frappe.db.get_value("Outflow Import Row", line, ["bill_links"], as_dict=True))), 1)


def _staged_by_cashbook_import(doc, source: str | None) -> bool:
    return source == CASHBOOK_SOURCE and bool((doc.get("row_kind") or "").strip())
