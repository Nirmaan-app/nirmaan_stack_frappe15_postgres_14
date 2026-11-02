# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What Review says about a Cashbook plan: the destination groups, the invoice counts and the whole preview.

PURE MODULE, split out of `cashbook.py` (#1594, to keep it under the file-size limit). It only reads a
`CashbookPlan`; the decision itself stays in `cashbook.plan_statement`.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from nirmaan_stack.services.outflow_import.cashbook import CashbookPlan, PlannedRow
from nirmaan_stack.services.outflow_import.cashbook_collect import COLLECT_ROW_KIND
from nirmaan_stack.services.outflow_import.ledgers import (
    NON_PROJECT_EXPENSE_DOCTYPE,
    PROJECT_EXPENSE_DOCTYPE,
)
from nirmaan_stack.services.outflow_import.sources import CASHBOOK_SOURCE

__all__ = ["PlanGroup", "group_plan", "InvoiceCounts", "invoice_counts", "preview_payload"]


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


def preview_payload(parsed, plan: CashbookPlan, filename: str, verdict, late_bills: list[dict]) -> dict:
    """What `api/outflow_import/cashbook.preview_cashbook_statement` returns: the plan as Review shows it.

    `verdict` is the `duplicates.DuplicateVerdict` the confirm would enforce; `late_bills` are the repeat lines
    that bring a bill for an existing Expense (#1593), already in the shape Review lists them.
    """
    groups = group_plan(plan)
    invoices = invoice_counts(plan)
    return {
        "preview": True,
        "source": CASHBOOK_SOURCE,
        "original_filename": filename,
        "period_from": str(parsed.period_from) if parsed.period_from else None,
        "period_to": str(parsed.period_to) if parsed.period_to else None,
        "total_rows": len(parsed.rows),
        "creating": len(plan.creating),
        "skipping": len(plan.skipping),
        "opening": len(plan.opening),
        "total_value": float(plan.total_value),
        # The Cashfree preview's duplicate keys, with the same meanings (ADR-0031): `duplicate_rows`
        # is the exact repeats that will NOT be saved, `new_rows` what will be. `refused` means the
        # confirm must not be offered at all; `warn` means it is offered anyway.
        "duplicate_rows": verdict.duplicates,
        "new_rows": verdict.new,
        "duplicate_message": verdict.message,
        "refused": verdict.refuse,
        "warn": verdict.warn,
        "duplicate_of_batch": verdict.earliest_batch,
        "warnings": list(parsed.warnings),
        # #1591: the spends that will create an Expense, by their bills -- 1 file (the invoice as it is),
        # 2 or more (merged into one PDF), none (the Expense waits for an invoice).
        "invoices": {
            "one_file": invoices.one_file,
            "merged": invoices.merged,
            "waiting": invoices.waiting,
        },
        "groups": [
            {
                "ledger": group.ledger,
                "key": group.key,
                "label": group.label,
                "count": group.count,
                "value": float(group.value),
                "rows": [
                    {
                        "row_number": row.row_number,
                        "transfer_id": row.transfer_id,
                        "amount": float(row.amount),
                        "remarks": row.remarks,
                        "beneficiary_name": row.beneficiary_name,
                        "spent_by": row.spent_by,
                        "expense_type": row.expense_type,
                        "matched_keyword": row.matched_keyword,
                        "is_fallback_type": row.is_fallback_type,
                    }
                    for row in group.rows
                ],
            }
            for group in groups
        ],
        # The lines of a pair are shown under `pairs`, not here.
        "skipped": [_preview_line(row) for row in plan.skipping if not row.partner],
        # #1594: each Paired wallet refund, refund first: both lines are skipped, each naming the other.
        "pairs": [
            {"refund": _preview_line(refund), "spend": _preview_line(spend)} for refund, spend in plan.pairs
        ],
        # #1594: the lines that will stay open on the main table (unpaired wallet refunds, wallet credits). A Collect
        # payment is listed under `collect_payments` instead, highlighted.
        "open_lines": [_preview_line(row) for row in plan.opening if row.row_kind != COLLECT_ROW_KIND],
        # #1595: the Collect payments that will stay open for a person to decide, highlighted on Review.
        "collect_payments": [
            {**_preview_line(row), "spent_by": row.spent_by} for row in plan.opening if row.row_kind == COLLECT_ROW_KIND
        ],
        # #1596: the lines an earlier import skipped as own balances that this statement re-opens in place, each
        # with the import that holds it. Each is also listed above under what it becomes.
        "reopened": [
            {**_preview_line(row), "earlier_batch": row.reopens.batch, "becomes": "open" if row.opens else "paired"}
            for row in plan.reopening
        ],
        # #1593: the existing Expenses that will get a bill from a repeat line, which is itself not saved.
        "late_bills": late_bills,
    }


def _preview_line(row) -> dict:
    """One statement line as Review lists it outside the groups: a skip, a pair's line or an open line."""
    return {
        "row_number": row.row_number,
        "transfer_id": row.transfer_id,
        "amount": float(row.amount),
        "remarks": row.remarks,
        "beneficiary_name": row.beneficiary_name,
        "row_kind": row.row_kind,
        "reason": row.reason,
    }
