# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Give each wallet refund the Cashbook import left open its *Wallet refund expense* (#1709, ADR-0015 Amendment D).

Before #1709 a refund that did not pair with its spend (Refund to Wallet, Credit Adjustment) was staged as an open
line (`Mismatched`) for a person to decide. Owner decision (2026-11-18): it is booked at minus its Credit where its
spend is booked. This patch does the same for the lines still open: on production, one line of `OFI-26-00337`
(Rs 11,248, 22 Jun 2026).

WHICH LINES
    A line of a Cashbook import with `row_kind` 'Refund to Wallet' or 'Credit Adjustment' that is still open and was
    not decided by hand (`cashbook_open_lines.open_lines`). A line a person decided is left as they left it.

WHAT EACH GETS
    Its placement as the import plans one today (`cashbook_refund_expense.refund_placement`): the spend's Expense as
    it is now when it has one (`cashbook_refund_spends.spend_expenses`), else a Non Project Expense typed from the
    refund's remark. `cashbook_open_lines.create_open_lines` then writes its Expense exactly as the job does, in the
    name of the person who uploaded its import. A refund whose negative Expense is already booked (its Txn Id at minus
    its Credit, `cashbook.booked_as`) is left open and counted.

ONE LINE, ONE TRANSACTION, IDEMPOTENT: see `cashbook_open_lines`. A line whose write is refused is rolled back, left
open and printed; the others go on.

IT PRINTS how many Expenses it created per ledger, how many refunds were already booked, and each line it could not
create.
"""

from __future__ import annotations

from decimal import Decimal

from nirmaan_stack.api.outflow_import.cashbook import booked_as
from nirmaan_stack.api.outflow_import.cashbook_open_lines import (
    CreateReport,
    LinePlace,
    create_open_lines,
    open_lines,
)
from nirmaan_stack.api.outflow_import.cashbook_refund_spends import spend_expenses
from nirmaan_stack.services.outflow_import.candidates import load_expense_rules
from nirmaan_stack.services.outflow_import.cashbook_refund_expense import refund_placement
from nirmaan_stack.services.outflow_import.cashbook_refunds import REFUND_ROW_KINDS, refunded_spend_id


def create_open_refund_expenses(lines: list[str] | None = None) -> CreateReport:
    """Book every open wallet refund line (`lines` scopes the run, for a test); return the counts."""
    refunds = open_lines(REFUND_ROW_KINDS, lines)
    spends = spend_expenses(refunded_spend_id(line.transfer_id) for line in refunds)
    rules = load_expense_rules()

    def place_of(line) -> LinePlace:
        place = refund_placement(
            line.transfer_id, (line.remarks or "").strip(), spends.get(refunded_spend_id(line.transfer_id)), None, rules
        )
        return LinePlace(place.ledger, place.project, place.expense_type)

    return create_open_lines(refunds, place_of, already_booked=_already_booked)


def _already_booked(line) -> str | None:
    """The Expense already holding this refund (its Txn Id at minus its Credit), as the import's check finds it."""
    when = line.added_on.date() if line.added_on else None
    return booked_as(line.transfer_id, -Decimal(str(line.amount)), when)


def execute():
    """The patch: book the whole site's open wallet refunds, and print the counts."""
    print(create_open_refund_expenses().text())
