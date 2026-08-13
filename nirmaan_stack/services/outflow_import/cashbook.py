# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What a Cashbook statement will create (Bulk Import Outflow, Cashbook slice 4).

PURE MODULE -- no `frappe`, no database, no request context. Same shape and the same reason as
`matcher.py` and `project_match.py`: everything it needs is handed in, so the whole decision is
testable against a real statement with no bench, no site and no fixtures.

⚠️ THIS IS NOT A MATCHER, AND THE DIFFERENCE IS THE WHOLE FEATURE. `matcher.py` finds an existing
approved record that a bank transfer PAYS. There is nothing to find here: a petty-cash spend has no
counterpart in any ledger, so this module decides what to CREATE. That inverts the feature's
standing rule that the import never creates -- an owner ruling, taken deliberately, and narrower
than it sounds because `Project Expenses` already auto-approves anything under Rs 5,000 on
creation, which on a measured statement was 113 of 115 rows.

ONE PLAN, TWO READERS. The dialog renders this and the background job executes it. That is
deliberate: two passes over the same rows -- one to preview, one to write -- is how a screen comes
to promise one thing and a worker to do another, and there is no per-row review here to catch it.

WHAT IT DECIDES, IN ORDER
-------------------------
1. **Is this row importable at all?** Four ways it is not, each a VISIBLE skip carrying its own
   sentence, never a silent drop -- the statement's own totals block is already gone by now
   (`parser`), so everything reaching here was a real line in the file.
2. **Which ledger?** A remark naming exactly one project makes it a Project Expense; anything else
   makes it a Non-Project Expense. There is no third answer: an owner ruling puts a row nobody can
   place into Non-Project rather than holding it back, so nothing here ever refuses to decide.
3. **Which expense type?** Read from the same text, against the rules for THAT ledger -- see
   `pick_expense_type`. Nothing found gives the fallback.

⚠️ STEPS 2 AND 3 ARE ORDERED, NOT INDEPENDENT. The two expense ledgers have almost separate
vocabularies (12 project-only types, 25 non-project-only, 2 shared), so the type cannot be chosen
until the ledger is known. "Courier charges veeva project" is Material Transportation Charges;
"Courier charges" alone is Postage & Courier. The same words, a different answer, because the first
type does not exist on the other side.

MEASURED on the real 137-row export: 115 importable rows, 87 to a project and 28 not, with 26 (22%)
falling back to `Petty Cash`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Iterable, Mapping, Sequence

from nirmaan_stack.services.outflow_import.duplicates import row_identity
from nirmaan_stack.services.outflow_import.ledgers import (
    NON_PROJECT_EXPENSE_DOCTYPE,
    PROJECT_EXPENSE_DOCTYPE,
)
from nirmaan_stack.services.outflow_import.project_match import ProjectIndex, alias_haystack

__all__ = [
    "SPEND_ROW_KIND",
    "FALLBACK_EXPENSE_TYPE",
    "ACTION_CREATE",
    "ACTION_SKIP",
    "PlannedRow",
    "CashbookPlan",
    "PlanGroup",
    "plan_statement",
    "pick_expense_type",
    "group_plan",
]

# The one `Type` value that means money left on somebody's behalf. Everything else in a Cashbook
# export moves money BETWEEN our own balances -- a wallet top-up, a bank load, a refund -- and
# recording those as expenses would book the same rupee twice.
SPEND_ROW_KIND = "Wallet Spend"

# Where a row lands when its text names no type we recognise. It must carry BOTH the `project` and
# `non_project` flags, because a row on either ledger can reach it.
FALLBACK_EXPENSE_TYPE = "Petty Cash"

ACTION_CREATE = "create"
ACTION_SKIP = "skip"

# Every reason a row is not imported. They are constants because the preview groups by them and a
# reworded sentence would silently split one group into two.
SKIP_NOT_A_SPEND = "Moves money between our own balances, not a spend"
SKIP_NOT_SUCCESSFUL = "Did not succeed at the wallet"
SKIP_NO_AMOUNT = "No amount was debited"
SKIP_ALREADY_IMPORTED = "Already imported in {batch}"
SKIP_REPEATED_IN_FILE = "The same transfer appears earlier in this file"


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
    ledger: str | None = None
    project: str | None = None
    project_name: str = ""
    expense_type: str | None = None
    matched_keyword: str = ""
    """Which rule chose the expense type, so a surprising type can be traced to the word that
    caused it. Blank when the fallback was used -- there was no rule."""

    @property
    def creates(self) -> bool:
        return self.action == ACTION_CREATE

    @property
    def is_fallback_type(self) -> bool:
        return self.creates and self.expense_type == FALLBACK_EXPENSE_TYPE


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


@dataclass(frozen=True)
class CashbookPlan:
    rows: tuple[PlannedRow, ...] = ()

    @property
    def creating(self) -> tuple[PlannedRow, ...]:
        return tuple(row for row in self.rows if row.creates)

    @property
    def skipping(self) -> tuple[PlannedRow, ...]:
        return tuple(row for row in self.rows if not row.creates)

    @property
    def total_value(self) -> Decimal:
        return sum((row.amount for row in self.creating), Decimal("0"))

    def for_ledger(self, ledger: str) -> tuple[PlannedRow, ...]:
        return tuple(row for row in self.creating if row.ledger == ledger)


def plan_statement(
    rows: Iterable,
    index: ProjectIndex,
    expense_rules: Mapping[str, Sequence[tuple[str, str]]],
    already_imported: Mapping[tuple, str] | None = None,
) -> CashbookPlan:
    """Decide what every parsed row becomes.

    `rows` are `parser.RawRow`s. `already_imported` maps a `duplicates.row_identity` to the batch
    that holds it, so a re-uploaded statement reports WHERE it was seen before rather than merely
    that it was -- the difference between a message somebody can act on and one they cannot.

    ⚠️ THE ORDER OF THE FOUR SKIP TESTS IS THE MESSAGE. A failed top-up is not a spend AND did not
    succeed; reporting it as "did not succeed" would send somebody looking for a failed payment
    that never existed. Kind first, then outcome, then amount, then whether we have seen it.
    """
    seen: dict[tuple, int] = {}
    already = dict(already_imported or {})
    planned: list[PlannedRow] = []

    for raw in rows:
        base = dict(
            row_number=getattr(raw, "row_number", 0),
            transfer_id=getattr(raw, "transfer_id", "") or "",
            amount=getattr(raw, "amount", Decimal("0")) or Decimal("0"),
            remarks=(getattr(raw, "remarks", "") or "").strip(),
            beneficiary_name=(getattr(raw, "beneficiary_name", "") or "").strip(),
            spent_by=(getattr(raw, "added_by_raw", "") or "").strip(),
        )
        skip = _skip_reason(raw, base["amount"], already, seen)
        if skip:
            planned.append(PlannedRow(action=ACTION_SKIP, reason=skip, **base))
            continue

        seen[row_identity(base["transfer_id"], base["amount"], _row_date(raw))] = base["row_number"]
        planned.append(PlannedRow(action=ACTION_CREATE, **base, **_placement(base["remarks"], index, expense_rules)))

    return CashbookPlan(rows=tuple(planned))


def _skip_reason(raw, amount: Decimal, already: Mapping[tuple, str], seen: Mapping[tuple, int]) -> str:
    if (getattr(raw, "row_kind", "") or "").strip() != SPEND_ROW_KIND:
        return SKIP_NOT_A_SPEND
    if not getattr(raw, "is_success", False):
        return SKIP_NOT_SUCCESSFUL
    # ⚠️ ZERO IS A SKIP, NOT AN ERROR. `settle.create_expense_from_row` THROWS on an amount of zero
    # or less, and it is right to -- but reaching it would fail one row's slot in a batch of a
    # hundred for something visible here, where it costs a sentence instead.
    if amount <= 0:
        return SKIP_NO_AMOUNT
    identity = row_identity(
        getattr(raw, "transfer_id", "") or "", amount, _row_date(raw)
    )
    if identity in already:
        return SKIP_ALREADY_IMPORTED.format(batch=already[identity])
    if identity in seen:
        return SKIP_REPEATED_IN_FILE
    return ""


def _row_date(raw):
    return getattr(raw, "added_on_date", None)


def _placement(
    remarks: str, index: ProjectIndex, expense_rules: Mapping[str, Sequence[tuple[str, str]]]
) -> dict:
    """Which ledger, which project, which expense type -- in that order, because type depends on it."""
    project = index.sole_project(remarks)
    if project:
        ledger, rule_key = PROJECT_EXPENSE_DOCTYPE, "Project"
    else:
        ledger, rule_key = NON_PROJECT_EXPENSE_DOCTYPE, "Non Project"

    expense_type, keyword = pick_expense_type(remarks, expense_rules.get(rule_key, ()))
    return dict(
        ledger=ledger,
        project=project,
        project_name=index.name_of(project) if project else "",
        expense_type=expense_type,
        matched_keyword=keyword,
    )


def pick_expense_type(
    remarks: str, rules: Sequence[tuple[str, str]]
) -> tuple[str, str]:
    """`(expense type, the keyword that chose it)`. Falls back rather than refusing.

    ⚠️ A KEYWORD MATCHES AT THE START OF A WORD, NOT ANYWHERE IN THE TEXT. People write "unloading"
    where the rule says "unload" and "printout" where it says "print", so a whole-word test would
    miss most of a real statement -- but a bare substring test would find "print" inside
    "blueprint" and "unload" inside a payee's name. Matching at a word START handles English
    suffixes for free and refuses the interior collisions, and it needs no regex: the haystack is
    already space-normalised and space-padded, so a word start is exactly a preceding space.

    ⚠️ THE LONGEST MATCH WINS, and `candidates.load_expense_rules` has already sorted for it. If
    two rules of the SAME length disagree, that is a genuine tie and the fallback takes it --
    the "exactly one, or nothing" rule this feature applies everywhere else. Same length AND the
    same type is not a tie: "cake" and "food" both meaning Staff Welfare is agreement.
    """
    haystack = alias_haystack(remarks)
    hits = [(keyword, expense_type) for keyword, expense_type in rules if f" {keyword}" in haystack]
    if not hits:
        return FALLBACK_EXPENSE_TYPE, ""

    longest = max(len(keyword) for keyword, _ in hits)
    contenders = {expense_type for keyword, expense_type in hits if len(keyword) == longest}
    if len(contenders) != 1:
        return FALLBACK_EXPENSE_TYPE, ""
    winner = next(keyword for keyword, _ in hits if len(keyword) == longest)
    return contenders.pop(), winner


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
