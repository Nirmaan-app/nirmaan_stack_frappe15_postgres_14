# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Is this expense fully linked? The one home of that answer (ADR-0027, #1296).

An expense (Project Expenses or Non Project Expenses) may be settled by many bank lines. Each link
is one live `Settled` `Outflow Row Match` slip, and the expense's **linked total** is the SUM of
those slips' `target_amount` -- always read from the slips, never stored and never incremented.

Two halves, deliberately in one module:

  * `load_expense_links` -- ONE database aggregate: the linked total and the date of the latest
    linked line. It reads, never writes, and takes no request context.
  * `derive_expense_status` / `remaining_balance` -- PURE. Given the expense's amount and those
    two facts they return Paid or Reconciliation Pending, the payment date, and what is left.

⚠️ THE ₹5 WINDOW IS `amounts.AMOUNT_TOLERANCE`, THE SAME ONE THE MATCHER POOL AND THE SETTLE GUARD
READ. A copy here would let an expense read Paid that the settle guard still thinks has room, or
the other way round.

⚠️ NOT A B1 `PURE_MODULES` ENTRY, because the aggregate lives here too (the ticket puts both in one
services module). The decision functions below it touch no database and are unit-tested without
bench (`test_expense_links.py`).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

import frappe

from nirmaan_stack.services.outflow_import.allocation import MATCH_SETTLED
from nirmaan_stack.services.outflow_import.amounts import AMOUNT_TOLERANCE, to_decimal
from nirmaan_stack.services.outflow_import.ledgers import PAID, RECONCILIATION_PENDING

__all__ = [
    "ExpenseLinks",
    "ExpenseStatus",
    "derive_expense_status",
    "load_expense_links",
    "remaining_balance",
]

# Spelled here rather than imported from `api/`: a service never reaches up into the api layer.
_MATCH_DOCTYPE = "Outflow Row Match"
_ROW_DOCTYPE = "Outflow Import Row"


@dataclass(frozen=True)
class ExpenseLinks:
    """What an expense's live slips add up to."""

    linked_total: Decimal
    latest_line_date: date | None


@dataclass(frozen=True)
class ExpenseStatus:
    """The status an expense's links make it, and the payment date that goes with it."""

    status: str
    payment_date: date | None


def remaining_balance(amount, linked_total) -> Decimal:
    """`amount - linked_total`: how much of the expense no bank line has covered yet."""
    return to_decimal(amount) - to_decimal(linked_total)


def derive_expense_status(amount, links: ExpenseLinks) -> ExpenseStatus:
    """Paid when the linked total reaches the amount within ₹5; otherwise Reconciliation Pending.

    ⚠️ ONLY A SHORTFALL KEEPS IT PENDING. A linked total ABOVE the amount is not reachable -- linking
    is refused past what is left + ₹5, and the amount cannot be edited below the linked total -- so
    it is read as Paid rather than inventing a third state for a case the rules already close. The
    same one-sided reading as `allocation.is_fully_allocated`, and listed beside it in `amounts.py`.

    Paid carries the date of the latest linked line; Reconciliation Pending carries no date.
    """
    if remaining_balance(amount, links.linked_total) > AMOUNT_TOLERANCE:
        return ExpenseStatus(status=RECONCILIATION_PENDING, payment_date=None)
    return ExpenseStatus(status=PAID, payment_date=links.latest_line_date)


def load_expense_links(doctype: str, name: str) -> ExpenseLinks:
    """The expense's linked total and latest linked line date, in ONE aggregate query.

    ⚠️ LIVE SLIPS ONLY (`match_kind = 'Settled'`). A `Reversed` slip was undone and contributes
    nothing -- the same rule `allocation.allocated_of` applies to a row's legs.

    ⚠️ THE LINE DATE IS THE ROW'S `added_on` DATE, the same field a 1:1 settle has always written as
    `payment_date` (`_StagedRow.added_on_date`).
    """
    result = frappe.db.sql(
        f"""
        SELECT COALESCE(SUM(m.target_amount), 0) AS linked_total,
               MAX(r.added_on) AS latest_added_on
        FROM "tab{_MATCH_DOCTYPE}" m
        LEFT JOIN "tab{_ROW_DOCTYPE}" r ON r.name = m.import_row
        WHERE m.target_doctype = %(doctype)s
          AND m.target_name = %(name)s
          AND m.match_kind = %(settled)s
        """,
        {"doctype": doctype, "name": name, "settled": MATCH_SETTLED},
        as_dict=True,
    )[0]
    latest = result.get("latest_added_on")
    if isinstance(latest, datetime):
        latest = latest.date()
    return ExpenseLinks(
        linked_total=to_decimal(result.get("linked_total")),
        latest_line_date=latest,
    )
