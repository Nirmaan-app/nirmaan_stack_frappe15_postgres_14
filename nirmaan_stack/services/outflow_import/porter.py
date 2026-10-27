# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Porter Statement import's pure rules (ADR-0032, GLOSSARY § Porter deliveries).

PURE MODULE -- no `frappe`, no database. `api/outflow_import/porter.py` reads the file and the project
master, calls these, and persists what they decide. Nothing Porter-shaped lives outside the `porter*`
modules of `services/outflow_import/` and `api/outflow_import/`.

WHAT A PORTER STATEMENT IS. Porter's monthly CSV, one line per delivery order. Each line names the
**Porter Invoice** that bills it (its `invoice_link`), and a Porter Invoice bills only its COMPLETED
orders: a cancelled order is on the statement and on no invoice (measured 2026-09: the Hyderabad invoice
is Rs 613, its 2 completed orders, not the cancelled Rs 328 beside them).

WHAT THIS MODULE DECIDES.

1. `read_porter_statement` -- the file grouped into its Porter Invoices, or a REFUSAL. Nothing is saved
   before this has accepted the whole file, because saving the CSV commits inside the request.
2. `statement_line` -- the one reader of a line's stored columns.
3. `REASON_*` / `STRENGTH_*` -- why each completed order is placed where it is, and how far to trust it.
   The signals that decide it are in `porter_placement.py` (#1448); the review writes `REASON_REVIEW`.
4. `remark_group_key` -- which review group an order is assigned with (#1446).

Its siblings, each pure too: `porter_state` (the invoices' and the import's states, and the lines Create
still writes), `porter_verdict` (does an invoice PDF agree with the statement, #1444), `porter_wording`
(what Create and Rectify write on the Expense and the Porter Order, #1445 / #1449), `porter_placement`
(#1448) and `porter_repeats` (#1447). `porter_pdf` is the one sibling that is NOT pure: it reads the
database to build a Porter Expense's invoice PDF link.

⚠️ IT NEVER CALLS THE MATCHER. A Porter line creates its expense and settles nothing (ADR-0032, like
Cashbook's ADR-0015), so nothing here may reach `match_batch` / `match_row`; pinned by an AST test.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from nirmaan_stack.services.outflow_import.normalize import normalize_amount
from nirmaan_stack.services.outflow_import.parser import (
    PORTER_INVOICE_LINK_COLUMN,
    PORTER_ORDER_COMPLETED,
    PORTER_ORDER_STATUS_COLUMN,
    PORTER_STATEMENT_COLUMNS,
    ParseResult,
    RawRow,
)

__all__ = [
    "EXPENSE_TYPE",
    "INVOICE_DOCTYPE",
    "MATCH_BASIS",
    "ORDER_DOCTYPE",
    "OWN_IMPORT_LINE_REFUSAL",
    "PORTER_COLUMNS",
    "PorterInvoiceGroup",
    "PorterLine",
    "PorterStatement",
    "PorterStatementError",
    "REASON_ADDRESS",
    "REASON_CONFLICT",
    "REASON_HISTORY",
    "REASON_INITIALS",
    "REASON_NAME",
    "REASON_REVIEW",
    "REASON_TYPO",
    "STRENGTH_CHECK",
    "STRENGTH_STRONG",
    "read_porter_statement",
    "remark_group_key",
    "statement_line",
]

#: The statement's columns, by Porter's own names. Every one is required by the parser adapter.
PORTER_COLUMNS = PORTER_STATEMENT_COLUMNS

#: The two Porter doctypes (ADR-0032): one Porter Invoice per invoice link (its PDF, what Gemini read, the
#: comparison), one Porter Order per CRN (every order column). The expense owns the link to its order.
INVOICE_DOCTYPE = "Porter Invoice"
ORDER_DOCTYPE = "Porter Order"

#: Every Porter Expense, Project or Non-Project, is typed this (owner, ADR-0032).
EXPENSE_TYPE = "Material Transportation Charges"

#: `Outflow Import Row.match_basis` on a completed Porter line: the import's own plan, never the matcher's.
MATCH_BASIS = "porter statement"

#: Why a suggestion was made (`porter_placement`). A reader must show a reason it does not know as it
#: is, never drop it; `porterReview.ts` labels each one (pinned by `porterReview.test.ts`).
#: The remark names the project: its whole name, or a word unique to it (`project_match`).
REASON_NAME = "name"
#: The remark holds a word one letter off a 5+ letter word unique to one project ("cignus" -> Cygnus).
REASON_TYPO = "typo"
#: The remark spells a project's initials with spaces ("v r mall" -> VR Mall Food Court, "e y" -> Ernst
#: & Young).
REASON_INITIALS = "initials"
#: The order's from or to address names one project's site by two pieces of evidence (words unique to
#: that site, or its unique pincode). Joined to a name reason when it agrees: "name+address".
REASON_ADDRESS = "address"
#: The remark names one project, but most of its group's orders go to another project's site: no
#: suggestion, so a person decides.
REASON_CONFLICT = "conflict"
#: An earlier Porter import's order with the same remark and city was kept on this placement (its live
#: Expense: created as reviewed, or Rectified since).
REASON_HISTORY = "history"
#: The Accountant chose the placement in Review (#1446): no longer a suggestion, so it has no strength.
REASON_REVIEW = "review"

#: How far to trust a suggestion. A weak one is marked Check and is reviewed first.
STRENGTH_STRONG = "Strong"
STRENGTH_CHECK = "Check"

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
        return self.statement.get(PORTER_ORDER_STATUS_COLUMN, "").strip().lower() == PORTER_ORDER_COMPLETED

    @property
    def invoice_link(self) -> str:
        return self.statement.get(PORTER_INVOICE_LINK_COLUMN, "")

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


# --- review (#1446) -------------------------------------------------------------------------------


def remark_group_key(remarks: str | None, city: str | None) -> str:
    """The review group an order belongs to: its normalised remark and city. Blank: in no group.

    Orders that share a remark in one city are assigned once, together ("telus project", 8 orders).
    Letter case, spacing and punctuation do not split a group. An order with no remark is reviewed on
    its own: unrelated orders must not be forced onto one project.
    """
    remark = _group_words(remarks)
    if not remark:
        return ""
    return f"{_group_words(city)}|{remark}"


def _group_words(value: str | None) -> str:
    return " ".join(re.sub(r"[^0-9a-z]+", " ", (value or "").casefold()).split())
