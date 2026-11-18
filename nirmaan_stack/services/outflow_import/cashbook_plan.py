# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What a Cashbook plan is made of: the four actions, one planned line (`PlannedRow`) and the whole plan
(`CashbookPlan`).

PURE MODULE, split out of `cashbook.py` (file size, #1709), which re-exports every name here; `cashbook.plan_statement`
still makes the decision.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from nirmaan_stack.services.outflow_import.cashbook_placement import FALLBACK_EXPENSE_TYPE
from nirmaan_stack.services.outflow_import.cashbook_reopen import EarlierWrongSkip
from nirmaan_stack.services.outflow_import.internal_transfers import CashbookMove
from nirmaan_stack.services.outflow_import.parser import DIRECTION_CREDIT
from nirmaan_stack.services.outflow_import.repeats import RepeatSplit

# The refund and wallet-credit kinds, their sentences and the pairing walk live in `cashbook_refunds` (#1594).
ACTION_CREATE = "create"
ACTION_SKIP = "skip"
# An open line (#1594): staged at `Mismatched`, a status the job never takes, and decided on the main table.
ACTION_OPEN = "open"
# One of Cashbook's own moves (#1623, spec #1619): staged at `Internal Transfer` with one record, never an expense.
ACTION_INTERNAL = "internal"


@dataclass(frozen=True)
class PlannedRow:
    """One statement row and what will become of it. Never a partial answer.

    A `create` row always carries a ledger and an expense type; a `skip` row always carries a
    reason. Nothing here is left for a caller to work out, because the two callers -- the preview
    and the writer -- would work it out separately.
    """

    row_number: int
    transfer_id: str
    amount: Decimal
    remarks: str
    beneficiary_name: str
    spent_by: str
    action: str
    reason: str = ""
    skip_kind: str | None = None
    """A `skip_kinds.SKIP_KINDS` member on a skip row, `None` on a create row -- chosen beside `reason` by
    `_skip_reason`, so the stored kind never has to be read back out of the sentence."""
    ledger: str | None = None
    project: str | None = None
    project_name: str = ""
    expense_type: str | None = None
    matched_keyword: str = ""
    """Which rule chose the expense type, so a surprising type can be traced to the word that
    caused it. Blank when the fallback was used -- there was no rule."""
    # #1594: the statement's `Type`; `DIRECTION_CREDIT` on a refund or wallet credit (`amount` is then its Credit),
    # else blank; and the other line's Txn Id on a *Paired wallet refund*.
    row_kind: str = ""
    direction: str = ""
    partner: str = ""
    # #1596: the earlier line skipped as own balances that this line re-opens in place; it is then not staged anew.
    reopens: EarlierWrongSkip | None = None
    # #1623: an internal line's move (`internal_transfers.cashbook_move`): its ends, money, direction and rule.
    move: CashbookMove | None = None
    # #1709: a *Wallet refund expense* -- the spend Txn Id the refund names (blank when it names none), and the name
    # of that spend's existing Expense it reduces (blank when the spend has none yet), and whether the spend is
    # created by this same statement (it then has its Expense once the job runs).
    refund_of: str = ""
    reduces: str = ""
    spend_on_statement: bool = False

    @property
    def creates(self) -> bool:
        return self.action == ACTION_CREATE

    @property
    def opens(self) -> bool:
        return self.action == ACTION_OPEN

    @property
    def refunds(self) -> bool:
        """A *Wallet refund expense* (#1709): a refund the plan creates, at minus its Credit. Every other line the plan
        creates is a spend."""
        return self.creates and self.direction == DIRECTION_CREDIT

    @property
    def is_fallback_type(self) -> bool:
        return self.creates and self.expense_type == FALLBACK_EXPENSE_TYPE


@dataclass(frozen=True)
class CashbookPlan:
    rows: tuple[PlannedRow, ...] = ()
    """Every row that will be STAGED, in file order. An exact repeat is not among them (ADR-0031)."""
    split: RepeatSplit = RepeatSplit(kept=(), repeats_not_saved=0, repeat_of_batch=None)
    """The repeat walk's answer, as `split_repeats` gave it: `split.kept` are the parsed lines behind
    `rows` (same order), `split.repeats_not_saved` the exact repeats left out."""
    pairs: tuple[tuple[PlannedRow, PlannedRow], ...] = ()
    """Each *Paired wallet refund* as `(refund, spend)`, in the refunds' file order (#1594). Both are in `rows`."""
    before_cutoff: int = 0  # #1707: the lines dated before 1 Apr 2026 (`cashbook_cutoff`); in nothing above, not staged

    @property
    def creating(self) -> tuple[PlannedRow, ...]:
        return tuple(row for row in self.rows if row.creates)

    @property
    def spending(self) -> tuple[PlannedRow, ...]:
        """The spends to create: every created line but a *Wallet refund expense* (#1709)."""
        return tuple(row for row in self.creating if not row.refunds)

    @property
    def refunding(self) -> tuple[PlannedRow, ...]:
        """The *Wallet refund expenses* to create (#1709), in file order. Review lists them apart from the spends."""
        return tuple(row for row in self.creating if row.refunds)

    @property
    def skipping(self) -> tuple[PlannedRow, ...]:
        return tuple(row for row in self.rows if row.action == ACTION_SKIP)

    @property
    def internal(self) -> tuple[PlannedRow, ...]:
        """Cashbook's own moves (#1623): staged as Internal Transfer lines, in file order."""
        return tuple(row for row in self.rows if row.action == ACTION_INTERNAL)

    @property
    def opening(self) -> tuple[PlannedRow, ...]:
        """The open lines (#1594): unpaired wallet refunds and wallet credits, in file order."""
        return tuple(row for row in self.rows if row.opens)

    @property
    def reopening(self) -> tuple[PlannedRow, ...]:
        """The lines that re-open an earlier own-balances skip in place (#1596), in file order."""
        return tuple(row for row in self.rows if row.reopens)

    @property
    def total_value(self) -> Decimal:
        """What the spends add up to. A refund is not in it (#1709): Review lists the refunds apart."""
        return sum((row.amount for row in self.spending), Decimal("0"))

    def for_ledger(self, ledger: str) -> tuple[PlannedRow, ...]:
        """The spends `ledger` gets (Review's groups); refunds are listed apart (#1709)."""
        return tuple(row for row in self.spending if row.ledger == ledger)
