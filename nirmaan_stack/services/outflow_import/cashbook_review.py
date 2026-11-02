# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What Review says about a Cashbook plan: the destination groups and the invoice counts.

PURE MODULE, split out of `cashbook.py` (#1594, to keep it under the file-size limit). It only reads a
`CashbookPlan`; the decision itself stays in `cashbook.plan_statement`.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from nirmaan_stack.services.outflow_import.cashbook import CashbookPlan, PlannedRow
from nirmaan_stack.services.outflow_import.ledgers import (
    NON_PROJECT_EXPENSE_DOCTYPE,
    PROJECT_EXPENSE_DOCTYPE,
)

__all__ = ["PlanGroup", "group_plan", "InvoiceCounts", "invoice_counts"]


@dataclass(frozen=True)
class PlanGroup:
    """One line of the preview: a destination, how many rows go there, and what they add up to."""

    ledger: str
    key: str
    label: str
    rows: tuple[PlannedRow, ...]
    value: Decimal

    @property
    def count(self) -> int:
        return len(self.rows)


def group_plan(plan: CashbookPlan) -> tuple[PlanGroup, ...]:
    """The preview's lines: project groups first, then non-project groups by expense type.

    ⚠️ THE TWO LEDGERS GROUP BY DIFFERENT THINGS, ON PURPOSE. A project expense is checked by
    asking "does this project have work this month" -- so it groups by PROJECT, and a project with
    one small row stands out as the shape a wrong match takes. A non-project expense has no project
    to check, so the only useful question is what kind of spending it is: it groups by TYPE.

    Ordered by value, descending, within each ledger. That is not a presentation choice either --
    it is what pushes the one-row groups into a block at the bottom, where a reader who is going to
    scan anything will scan them.
    """
    groups: list[PlanGroup] = []
    for ledger, key_of, label_of in (
        (PROJECT_EXPENSE_DOCTYPE, lambda r: r.project or "", lambda r: r.project_name or r.project or ""),
        (NON_PROJECT_EXPENSE_DOCTYPE, lambda r: r.expense_type or "", lambda r: r.expense_type or ""),
    ):
        buckets: dict[str, list[PlannedRow]] = {}
        labels: dict[str, str] = {}
        for row in plan.for_ledger(ledger):
            buckets.setdefault(key_of(row), []).append(row)
            labels.setdefault(key_of(row), label_of(row))
        for key, rows in buckets.items():
            groups.append(
                PlanGroup(
                    ledger=ledger,
                    key=key,
                    label=labels[key],
                    rows=tuple(rows),
                    value=sum((row.amount for row in rows), Decimal("0")),
                )
            )
    return tuple(sorted(groups, key=lambda g: (g.ledger, -g.value, g.label)))


@dataclass(frozen=True)
class InvoiceCounts:
    """What Review says about the bills before Create (#1591): of the lines that will create an Expense,
    how many carry one bill (it becomes the invoice as it is), how many carry 2 or more (merged into one
    PDF), and how many carry none (the Expense waits for an invoice)."""

    one_file: int
    merged: int
    waiting: int


def invoice_counts(plan: CashbookPlan) -> InvoiceCounts:
    """Count the create lines of `plan` by their bill links. `plan.split.kept` and `plan.rows` are the same
    lines in the same order (`CashbookPlan`)."""
    links = [
        len(getattr(kept.row, "bill_links", ()) or ())
        for kept, planned in zip(plan.split.kept, plan.rows, strict=True)
        if planned.creates
    ]
    return InvoiceCounts(
        one_file=sum(1 for n in links if n == 1),
        merged=sum(1 for n in links if n > 1),
        waiting=sum(1 for n in links if n == 0),
    )
