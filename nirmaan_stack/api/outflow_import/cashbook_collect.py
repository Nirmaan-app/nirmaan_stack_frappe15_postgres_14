# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A person decides each Collect payment (#1595, spec #1585, ADR-0015 Amendment B decision 6).

A *Collect payment* is a wallet line where a shop asked for money and the employee approved it. It may not be
a company spend, so the import never records it on its own: the plan stages it as an open line at
`Mismatched` (`services/outflow_import/cashbook_collect`), which the job never takes, and a person picks
Create expense or Skip by hand on the main table.

Its bill is copied at import, by the Cashbook job (`cashbook_bills.store_collect_bills`): the links die 7 days after
export, and the decision may come later. This module holds what a Create from such a line adds
(`statement_line_create_extras`, read by `expenses.create_expense`): the Cashbook marker, so the Expense waits in
Pending Invoices Upload -> Cashbook, and the stored bill as its invoice.
"""

from __future__ import annotations

from nirmaan_stack.services.outflow_import.settle import ExpenseInvoice
from nirmaan_stack.services.outflow_import.sources import CASHBOOK_SOURCE


def statement_line_create_extras(doc, source: str | None) -> dict:
    """What a Create on the main table adds for a line staged by the Cashbook Statement import (#1595): the
    Cashbook marker (`cashbook_batch`), so the new Expense waits in the Cashbook tab while it has no invoice, and
    the line's stored bill as its invoice. Empty for any other line.

    Such a line is told apart by its stored statement Type (`row_kind`), which only that import writes: an older
    Cashbook line has none, and its Expense must never wait (spec #1585 "Which Expenses wait").

    The stored bill's URL is copied, never a second File made: its one File stays attached to the line, as the
    Porter import's invoice stays attached to its Porter Invoice (`settle.ExpenseInvoice`).
    """
    if source != CASHBOOK_SOURCE or not (doc.get("row_kind") or "").strip():
        return {}
    extras: dict = {"cashbook_batch": doc["import_batch"]}
    if doc.get("stored_bill"):
        extras["invoice"] = ExpenseInvoice(number="", file_url=doc["stored_bill"])
    return extras
