# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Give each Wallet Credit the Cashbook import left open its *Wallet credit expense* (#1720, ADR-0015 Amendment E).

Before #1720 a Wallet Credit (money paid into the wallet from outside) was staged as an open line (`Mismatched`) for a
person to decide. Owner decision (2026-11-18): it is booked at minus its Credit, placed from its remark the way a spend
is. This patch does the same for the lines still open: on production, 11 lines of `OFI-26-00337` (Rs 22,214, 10 Apr to
9 Nov 2026), none of whose remarks names a project.

WHICH LINES
    A line of a Cashbook import with `row_kind` 'Wallet Credit' that is still open and was not decided by hand
    (`cashbook_open_lines.open_lines`). A line a person decided is left as they left it.

WHAT EACH GETS
    Its placement as the import plans one today (`cashbook_placement.placement`): a Project Expense on the project its
    remark names, else a Non Project Expense typed from the remark, else Petty Cash. `create_open_lines` then writes
    its Expense exactly as the job does, in the name of the person who uploaded its import. A credit whose negative
    Expense is already booked (its Txn Id at minus its Credit, `cashbook_open_lines.booked_holder`) is left open and
    counted.

ONE LINE, ONE TRANSACTION, IDEMPOTENT: see `cashbook_open_lines`. IT PRINTS how many Expenses it created per ledger,
how many credits were already booked, and each line it could not create.
"""

from __future__ import annotations

from decimal import Decimal

from nirmaan_stack.api.outflow_import.cashbook import project_index
from nirmaan_stack.api.outflow_import.cashbook_open_lines import (
    CreateReport,
    LinePlace,
    booked_holder,
    create_open_lines,
    open_lines,
)
from nirmaan_stack.services.outflow_import.candidates import load_expense_rules
from nirmaan_stack.services.outflow_import.cashbook_placement import placement
from nirmaan_stack.services.outflow_import.cashbook_refunds import WALLET_CREDIT_ROW_KIND


def create_open_wallet_credit_expenses(lines: list[str] | None = None) -> CreateReport:
    """Book every open Wallet Credit line (`lines` scopes the run, for a test); return the counts."""
    credits = open_lines((WALLET_CREDIT_ROW_KIND,), lines)
    index, rules = project_index(), load_expense_rules()

    def place_of(line) -> LinePlace:
        place = placement((line.remarks or "").strip(), index, rules)
        return LinePlace(place["ledger"], place["project"], place["expense_type"])

    return create_open_lines(
        credits, place_of, already_booked=lambda line: booked_holder(line, -Decimal(str(line.amount)))
    )


def execute():
    """The patch: book the whole site's open Wallet Credits, and print the counts."""
    print(create_open_wallet_credit_expenses().text())
