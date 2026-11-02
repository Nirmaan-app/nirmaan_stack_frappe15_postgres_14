# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Which repeat lines of a Cashbook Statement bring a bill for an existing Expense (#1593).

PURE MODULE -- no `frappe`, no database. Spec #1585 "Dedupe and late bills": an employee may add a bill in the
wallet app after the spend was imported. The next export carries the line again, now with links, and the line is
an exact repeat (identity is unchanged: Txn Id, amount, date), so it is still not saved. Its bills are the one
thing it brings: when the Expense with that payment reference still waits for an invoice, the job attaches them
to it (`api.outflow_import.cashbook._attach_late_bills`).

⚠️ ONLY A REPEAT OF AN EARLIER IMPORT (`RepeatSplit.earlier_exact`). A repeat within the same file has no
Expense yet: its first copy is the line that creates it.

⚠️ EXACTLY ONE EXPENSE, OR NONE. The Expense is found by the same identity the import's "already booked" check
uses (`payment_ref` + amount + `payment_date`, `cashbook._booked_index`). When two Expenses agree, the bill could
belong to either, so it goes to neither.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping
from dataclasses import dataclass
from decimal import Decimal

from nirmaan_stack.services.outflow_import.cashbook_refunds import line_money
from nirmaan_stack.services.outflow_import.duplicates import PriorSighting, find_prior_sightings
from nirmaan_stack.services.outflow_import.repeats import RepeatSplit

__all__ = ["LateBill", "late_bills"]


@dataclass(frozen=True)
class LateBill:
    """A repeat line whose bills go to an existing Expense. `record` is the Expense's label in the index given to
    `late_bills` (`"<doctype> <name>"` from `cashbook._booked_index`)."""

    row_number: int
    transfer_id: str
    amount: Decimal
    remarks: str
    record: str
    links: tuple[str, ...]


def late_bills(
    split: RepeatSplit,
    expenses: Mapping[tuple, tuple[PriorSighting, ...]],
    waiting: Collection[str],
) -> tuple[LateBill, ...]:
    """The repeat lines of `split` that bring bills for an Expense still waiting for one, in file order.

    `expenses` indexes every Expense carrying one of the statement's Txn Ids (`duplicates.index_prior_sightings`);
    `waiting` holds the labels of those with no `invoice_attachment` and no No invoice mark. An Expense is named
    once, by its first line.
    """
    found: list[LateBill] = []
    named: set[str] = set()
    for raw in split.earlier_exact:
        links = tuple(getattr(raw, "bill_links", ()) or ())
        transfer_id = getattr(raw, "transfer_id", "") or ""
        if not links or not transfer_id:
            continue
        amount = line_money(raw)
        agreeing = find_prior_sightings(expenses, transfer_id, amount, getattr(raw, "added_on_date", None))
        if len(agreeing) != 1:
            continue
        record = agreeing[0].label
        if record not in waiting or record in named:
            continue
        named.add(record)
        found.append(
            LateBill(
                row_number=getattr(raw, "row_number", 0),
                transfer_id=transfer_id,
                amount=amount,
                remarks=(getattr(raw, "remarks", "") or "").strip(),
                record=record,
                links=links,
            )
        )
    return tuple(found)
