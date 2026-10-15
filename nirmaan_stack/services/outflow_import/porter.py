# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Porter Statement import's pure rules (ADR-0032, GLOSSARY § Porter deliveries).

PURE MODULE -- no `frappe`, no database. `api/outflow_import/porter.py` reads the file and the project
master, calls these, and persists what they decide. Later slices of spec #1442 (validation, placement,
review, Create, Rectify, Discard) extend THIS module and that one; nothing Porter-shaped lives anywhere
else.

WHAT A PORTER STATEMENT IS. Porter's monthly CSV, one line per delivery order. Each line names the
**Porter Invoice** that bills it (its `invoice_link`), and a Porter Invoice bills only its COMPLETED
orders: a cancelled order is on the statement and on no invoice (measured 2026-09: the Hyderabad invoice
is Rs 613, its 2 completed orders, not the cancelled Rs 328 beside them).

WHAT THIS MODULE DECIDES.

1. `read_porter_statement` -- the file grouped into its Porter Invoices, or a REFUSAL. Nothing is saved
   before this has accepted the whole file, because saving the CSV commits inside the request.
2. `suggest_placement` -- the starting project suggestion for a completed order: the existing Won-only
   name matcher (`project_match`), with its reason and strength.

⚠️ IT NEVER CALLS THE MATCHER. A Porter line creates its expense and settles nothing (ADR-0032, like
Cashbook's ADR-0015), so nothing here may reach `match_batch` / `match_row`; pinned by an AST test.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from nirmaan_stack.services.outflow_import.ledgers import (
    NON_PROJECT_EXPENSE_DOCTYPE,
    PROJECT_EXPENSE_DOCTYPE,
)
from nirmaan_stack.services.outflow_import.normalize import normalize_amount
from nirmaan_stack.services.outflow_import.parser import (
    PORTER_ORDER_COMPLETED,
    PORTER_STATEMENT_COLUMNS,
    ParseResult,
    RawRow,
)
from nirmaan_stack.services.outflow_import.project_match import ProjectIndex, comparable_tokens

__all__ = [
    "EXPENSE_TYPE",
    "MATCH_BASIS",
    "OWN_IMPORT_LINE_REFUSAL",
    "PORTER_COLUMNS",
    "Placement",
    "PorterInvoiceGroup",
    "PorterLine",
    "PorterStatement",
    "PorterStatementError",
    "REASON_NAME",
    "SKIP_REASON_CANCELLED",
    "STRENGTH_CHECK",
    "STRENGTH_STRONG",
    "read_porter_statement",
    "statement_line",
    "suggest_placement",
]

#: The statement's columns, by Porter's own names. Every one is required by the parser adapter.
PORTER_COLUMNS = PORTER_STATEMENT_COLUMNS

#: Every Porter Expense, Project or Non-Project, is typed this (owner, ADR-0032).
EXPENSE_TYPE = "Material Transportation Charges"

#: `Outflow Import Row.match_basis` on a completed Porter line: the import's own plan, never the matcher's.
MATCH_BASIS = "porter statement"

#: Why a suggestion was made. Only the name matcher exists in this slice; #1447 adds the others.
REASON_NAME = "name"

#: How far to trust a suggestion. A weak one is marked Check and is reviewed first.
STRENGTH_STRONG = "Strong"
STRENGTH_CHECK = "Check"

#: The skip sentence of a cancelled order, beside its locked skip kind (`skip_kinds.SKIP_KIND_PORTER_CANCELLED`).
SKIP_REASON_CANCELLED = "Porter order cancelled. Porter does not bill it, so it becomes no expense."

#: What Create, Link, Allocate and Skip say when asked to write a Porter line from the main table.
OWN_IMPORT_LINE_REFUSAL = (
    "This is a Porter delivery. It can only be created by its Porter Statement import, once Porter's "
    "invoices have been checked. Open that import from Import History, on the Porter Statement tab."
)


class PorterStatementError(ValueError):
    """The file reads as a Porter Statement but cannot be imported as one. The message names why."""


@dataclass(frozen=True)
class PorterLine:
    """One order of the statement: the parsed row, plus every column verbatim (`statement`)."""

    row: RawRow
    statement: Mapping[str, str]

    @property
    def crn(self) -> str:
        return self.row.transfer_id

    @property
    def completed(self) -> bool:
        """Porter completed the order, and therefore bills it. Anything else is a cancelled order."""
        return self.statement.get("order_status", "").strip().lower() == PORTER_ORDER_COMPLETED

    @property
    def invoice_link(self) -> str:
        return self.statement.get("invoice_link", "")

    @property
    def invoice_number(self) -> str:
        return self.statement.get("porter_invoice_number", "")

    @property
    def fare(self) -> Decimal:
        """The Porter fare, before GST -- the Expense amount."""
        return self.row.amount

    @property
    def tax(self) -> Decimal:
        """Reverse-charge GST as the statement rounds it on this row. Never part of the Expense."""
        return normalize_amount(self.statement.get("tax_amount"))

    @property
    def completed_on(self) -> date | None:
        return self.row.added_on_date


@dataclass(frozen=True)
class PorterInvoiceGroup:
    """One Porter Invoice: the lines that name one invoice link, and the statement's figures for it."""

    invoice_link: str
    invoice_number: str
    porter_gstin: str
    customer_gstin: str
    billing_entity: str
    city: str
    lines: tuple[PorterLine, ...]

    @property
    def completed(self) -> tuple[PorterLine, ...]:
        return tuple(line for line in self.lines if line.completed)

    @property
    def completed_orders(self) -> int:
        return len(self.completed)

    @property
    def fare_total(self) -> Decimal:
        """Over COMPLETED orders only: an invoice's total never includes a cancelled order."""
        return sum((line.fare for line in self.completed), Decimal("0"))

    @property
    def tax_total(self) -> Decimal:
        return sum((line.tax for line in self.completed), Decimal("0"))


@dataclass(frozen=True)
class PorterStatement:
    """The whole file, accepted: its lines in file order, and its invoices in order of first sight."""

    lines: tuple[PorterLine, ...]
    invoices: tuple[PorterInvoiceGroup, ...]

    @property
    def completed(self) -> tuple[PorterLine, ...]:
        return tuple(line for line in self.lines if line.completed)

    @property
    def cancelled(self) -> tuple[PorterLine, ...]:
        return tuple(line for line in self.lines if not line.completed)

    @property
    def fare_total(self) -> Decimal:
        return sum((line.fare for line in self.completed), Decimal("0"))

    @property
    def period_from(self) -> date | None:
        """The first order completion date. The CSV declares no period of its own."""
        dates = [line.completed_on for line in self.completed if line.completed_on]
        return min(dates) if dates else None

    @property
    def period_to(self) -> date | None:
        dates = [line.completed_on for line in self.completed if line.completed_on]
        return max(dates) if dates else None


# The four facts every line of one invoice must agree on, with the words a refusal uses for each.
_INVOICE_IDENTITY = (
    ("porter_invoice_number", "invoice number"),
    ("porter_gstin", "Porter GSTIN"),
    ("customer_gstin", "customer GSTIN"),
    ("billing_entity", "billing entity"),
)


def read_porter_statement(parsed: ParseResult) -> PorterStatement:
    """Group a parsed Porter Statement into its Porter Invoices, or refuse it.

    Refused, with a reason naming the line or invoice (`PorterStatementError`):
      * a line with no invoice link -- it belongs to no invoice, so nothing could ever check it;
      * a CRN on two lines -- the CRN is the order's identity, and one order would become two expenses;
      * a completed order with no readable completion time -- it is the expense's payment date;
      * an invoice link whose lines disagree on invoice number, Porter GSTIN, customer GSTIN or billing
        entity -- the validation compares ONE of each against Porter's PDF;
      * one invoice number under two invoice links -- the invoice number is the Porter Invoice's identity.

    The parser has already refused a file missing a required column, or with no rows.
    """
    lines = tuple(PorterLine(row=row, statement=dict(row.extra)) for row in parsed.rows)

    seen: set[str] = set()
    for line in lines:
        if not line.invoice_link:
            raise PorterStatementError(f"Order {line.crn} names no invoice link.")
        if line.crn in seen:
            raise PorterStatementError(f"Order {line.crn} appears more than once in this file.")
        seen.add(line.crn)
        if line.completed and line.completed_on is None:
            raise PorterStatementError(
                f"Order {line.crn} is completed but has no readable completion time."
            )

    by_link: dict[str, list[PorterLine]] = {}
    for line in lines:
        by_link.setdefault(line.invoice_link, []).append(line)

    invoices = tuple(_invoice_of(link, members) for link, members in by_link.items())

    links_by_number: dict[str, list[str]] = {}
    for invoice in invoices:
        links_by_number.setdefault(invoice.invoice_number, []).append(invoice.invoice_link)
    for number, links in links_by_number.items():
        if len(links) > 1:
            raise PorterStatementError(
                f"Invoice number {number} appears under {len(links)} invoice links: {', '.join(links)}."
            )

    return PorterStatement(lines=lines, invoices=invoices)


def _invoice_of(link: str, members: Sequence[PorterLine]) -> PorterInvoiceGroup:
    agreed: dict[str, str] = {}
    for column, label in _INVOICE_IDENTITY:
        values = sorted({line.statement.get(column, "") for line in members})
        if len(values) > 1:
            shown = ", ".join(value or "(blank)" for value in values)
            raise PorterStatementError(
                f"The orders of invoice {link} disagree on the {label} ({shown}). Every order on one "
                f"Porter Invoice must carry the same {label}."
            )
        if not values[0]:
            raise PorterStatementError(f"The orders of invoice {link} carry no {label}.")
        agreed[column] = values[0]
    return PorterInvoiceGroup(
        invoice_link=link,
        invoice_number=agreed["porter_invoice_number"],
        porter_gstin=agreed["porter_gstin"],
        customer_gstin=agreed["customer_gstin"],
        billing_entity=agreed["billing_entity"],
        city=members[0].statement.get("city", ""),
        lines=tuple(members),
    )


def statement_line(stored: object) -> dict[str, str]:
    """`Outflow Import Row.porter_line` as a dict of Porter's columns. THE ONE READER of that field (B2).

    The row stores the line's columns verbatim at upload (`PorterLine.statement`); the database hands a
    JSON field back as text, a dict or nothing, depending on the reader. Only Porter's own column names
    are kept, each as a string; a blank or unreadable value reads as an empty line.
    """
    if isinstance(stored, (str, bytes)):
        try:
            stored = json.loads(stored or "{}")
        except ValueError:
            return {}
    if not isinstance(stored, Mapping):
        return {}
    return {
        column: "" if stored.get(column) is None else str(stored.get(column))
        for column in PORTER_COLUMNS
    }


@dataclass(frozen=True)
class Placement:
    """Where a completed order's Expense would go, and why. Blank project means Non-Project."""

    ledger: str
    project: str | None
    project_name: str
    expense_type: str
    reason: str
    strength: str


def suggest_placement(remarks: str, index: ProjectIndex) -> Placement:
    """The starting suggestion for one completed order, from the existing name matcher.

    `index` must be built over WON projects only (the caller's job, as Cashbook's `_build_plan`): indexing
    every project lets a Tendering duplicate tie a Won project's whole name, and a tie yields nothing.

    Strength: a remark holding the project's WHOLE name is Strong; a single word unique to one project
    is the loose reading, and is marked Check.
    """
    project = index.sole_project(remarks)
    if not project:
        return Placement(
            ledger=NON_PROJECT_EXPENSE_DOCTYPE,
            project=None,
            project_name="",
            expense_type=EXPENSE_TYPE,
            reason="",
            strength="",
        )
    whole_name = index.token_sets.get(project) or frozenset()
    strong = bool(whole_name) and whole_name <= comparable_tokens(remarks)
    return Placement(
        ledger=PROJECT_EXPENSE_DOCTYPE,
        project=project,
        project_name=index.name_of(project),
        expense_type=EXPENSE_TYPE,
        reason=REASON_NAME,
        strength=STRENGTH_STRONG if strong else STRENGTH_CHECK,
    )
