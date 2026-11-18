# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Give each Collect payment the Cashbook import left open its Expense (#1708, ADR-0015 Amendment C).

Before #1708 the import staged a successful Collect payment as an open line (`Mismatched`) for a person to decide
(ADR-0015 Amendment B decision 6). Owner decision (2026-11-18): it is a wallet spend like any other, and the import
now creates it. This patch does the same for the lines still open: on production, 9 lines of `OFI-26-00337`.

WHICH LINES
    A line of a Cashbook Statement import with `row_kind` 'Collect Payment' that is still open and was not decided
    by hand (`cashbook_open_lines.open_lines`). A line a person decided is left as they left it.

WHERE IT GOES
    Where the import placed it (`suggested_doctype`, `suggested_expense_type`, `resolved_project`). A line with no
    ledger on it is placed now the way the job would place it (`cashbook_placement.placement` against the Won
    projects and the expense rules), never dropped.

WHAT EACH GETS
    Its Expense exactly as the job writes one (`cashbook.write_line_expense`: the Cashbook marker, `payment_by` = the
    statement's From, `payment_ref` = its Txn Id, its match row and the line Settled), in the name of the person who
    uploaded its import (`cashbook_open_lines.create_open_lines`).
    A bill already stored on the line (`stored_bill`) becomes the Expense's invoice through the one entry point
    (`expense_bills.receive_bill`); its File stays on the line (`file_stays`), and the Expense bill is read afresh.
    Without one, the Expense waits in Pending Invoices Upload -> Cashbook like any spend without a bill.

ONE LINE, ONE TRANSACTION, IDEMPOTENT: see `cashbook_open_lines`. A line whose write is refused (its Txn Id's
Expense already exists, for one) is rolled back, left open and printed; the others go on.

IT PRINTS
    How many Expenses it created per ledger, and each line it could not create.
"""

from __future__ import annotations

import frappe

from nirmaan_stack.api.outflow_import.cashbook import project_index
from nirmaan_stack.api.outflow_import.cashbook_bills import links_of
from nirmaan_stack.api.outflow_import.cashbook_lines import ROW_DOCTYPE
from nirmaan_stack.api.outflow_import.cashbook_open_lines import (
    CreateReport,
    LinePlace,
    create_open_lines,
    open_lines,
)
from nirmaan_stack.services.expense_bills.receive import receive_bill
from nirmaan_stack.services.outflow_import.candidates import load_expense_rules
from nirmaan_stack.services.outflow_import.cashbook_placement import placement
from nirmaan_stack.services.outflow_import.cashbook_refunds import COLLECT_ROW_KIND
from nirmaan_stack.services.outflow_import.settle import outflow_import_write


def create_open_collect_payment_expenses(lines: list[str] | None = None) -> CreateReport:
    """Create the Expense of every open Collect payment line (`lines` scopes the run, for a test); return the counts."""
    index, rules = project_index(), load_expense_rules()

    def place_of(line) -> LinePlace:
        if line.suggested_doctype:
            return LinePlace(line.suggested_doctype, line.resolved_project, line.suggested_expense_type)
        planned = placement((line.remarks or "").strip(), index, rules)
        return LinePlace(planned["ledger"], planned["project"], planned["expense_type"])

    return create_open_lines(open_lines((COLLECT_ROW_KIND,), lines), place_of, after_write=_file_stored_bill)


def _file_stored_bill(line, actor: str) -> None:
    """A bill already stored on the line becomes its new Expense's invoice. Never commits."""
    if not line.stored_bill:
        return
    doctype, expense = frappe.db.get_value(ROW_DOCTYPE, line.name, ["suggested_doctype", "suggested_name"])
    with outflow_import_write():
        receive_bill(
            frappe.get_doc(doctype, expense, for_update=True),
            line.stored_bill,
            None,
            None,
            actor,
            bill_count=max(len(links_of(line)), 1),
            file_stays=True,
        )


def execute():
    """The patch: create the whole site's open Collect payments' Expenses, and print the counts."""
    print(create_open_collect_payment_expenses().text())
