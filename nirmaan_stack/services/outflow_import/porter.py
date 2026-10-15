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
2. `REASON_*` / `STRENGTH_*` -- why each completed order is placed where it is, and how far to trust it.
   The signals that decide it are in `porter_placement.py` (#1448); the review writes `REASON_REVIEW`.
3. `remark_group_key` -- which review group an order is assigned with (#1446).
4. `judge_invoice` -- whether one Porter Invoice's PDF, as Gemini read it, agrees with the statement
   (#1444); `import_state` -- the import's Validating / Validated / Validation failed, from its invoices,
   then Creating / Created from its lines (#1445).
5. `expense_description`, `porter_order_fields`, `CREATE_LINE_STATUSES` -- what Create writes for each
   completed order, and which lines it writes (#1445).

⚠️ IT NEVER CALLS THE MATCHER. A Porter line creates its expense and settles nothing (ADR-0032, like
Cashbook's ADR-0015), so nothing here may reach `match_batch` / `match_row`; pinned by an AST test.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from nirmaan_stack.services.outflow_import.amounts import PORTER_INVOICE_TOLERANCE
from nirmaan_stack.services.outflow_import.normalize import normalize_amount
from nirmaan_stack.services.outflow_import.parser import (
    PORTER_ORDER_COMPLETED,
    PORTER_STATEMENT_COLUMNS,
    ParseResult,
    RawRow,
)
from nirmaan_stack.services.outflow_import.status import (
    ROW_ERROR,
    ROW_MISMATCHED,
    ROW_PENDING_MATCH,
    ROW_SETTLED,
    ROW_SKIPPED,
)

__all__ = [
    "CREATE_LINE_STATUSES",
    "EXPENSE_TYPE",
    "IMPORT_CREATED",
    "IMPORT_CREATING",
    "IMPORT_VALIDATED",
    "IMPORT_VALIDATING",
    "IMPORT_VALIDATION_FAILED",
    "INVOICE_COMPARING",
    "INVOICE_DOWNLOADING",
    "INVOICE_ERROR",
    "INVOICE_FAILED",
    "INVOICE_IN_FLIGHT",
    "INVOICE_PASSED",
    "INVOICE_QUEUED",
    "INVOICE_READING",
    "InvoiceFigures",
    "InvoiceRead",
    "InvoiceVerdict",
    "MATCH_BASIS",
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
    "SKIP_REASON_CANCELLED",
    "STRENGTH_CHECK",
    "STRENGTH_STRONG",
    "expense_description",
    "import_state",
    "judge_invoice",
    "porter_order_fields",
    "read_porter_statement",
    "remark_group_key",
    "rupees",
    "statement_line",
]

#: The statement's columns, by Porter's own names. Every one is required by the parser adapter.
PORTER_COLUMNS = PORTER_STATEMENT_COLUMNS

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


# --- validation against Porter's own invoice (#1444) ----------------------------------------------
#
# Each Porter Invoice moves Queued -> Downloading -> Reading -> Comparing -> Passed / Failed / Error,
# committed at every step so the dialog can show it. `judge_invoice` is the Comparing step; the job
# around it lives in `api/outflow_import/porter_validation.py`.

#: `Porter Invoice.validation_status`, in the order an invoice moves through them.
INVOICE_QUEUED = "Queued"
INVOICE_DOWNLOADING = "Downloading"
INVOICE_READING = "Reading"
INVOICE_COMPARING = "Comparing"
INVOICE_PASSED = "Passed"
#: The PDF disagrees with the statement. FINAL: no retry and no override, for anyone (ADR-0032).
INVOICE_FAILED = "Failed"
#: The download or the read went wrong, so nothing was decided. Retryable, for that invoice alone.
INVOICE_ERROR = "Error"

#: The invoice is still being worked on: the import is not decided yet.
INVOICE_IN_FLIGHT = frozenset({INVOICE_QUEUED, INVOICE_DOWNLOADING, INVOICE_READING, INVOICE_COMPARING})

#: The import's own state, DERIVED from its invoices (`import_state`), never stored.
IMPORT_VALIDATING = "Validating"
IMPORT_VALIDATED = "Validated"
IMPORT_VALIDATION_FAILED = "Validation failed"
#: Create has started and not every completed line is created yet (#1445): running, stopped with a line
#: in Error, or a line reopened by Unreconcile. A re-run of Create finishes it.
IMPORT_CREATING = "Creating"
#: Every completed line has its Expense.
IMPORT_CREATED = "Created"



@dataclass(frozen=True)
class InvoiceFigures:
    """The statement's side of the comparison: one Porter Invoice over its COMPLETED orders."""

    invoice_number: str
    porter_gstin: str
    customer_gstin: str
    fare: Decimal
    tax: Decimal


@dataclass(frozen=True)
class InvoiceRead:
    """What Gemini read off the invoice PDF. A blank string or `None` means it read nothing there.

    `tax` is the invoice's TOTAL tax: IGST, or CGST + SGST -- the split is irrelevant to the check.
    """

    invoice_number: str
    invoice_date: date | None
    supplier_gstin: str
    receiver_gstin: str
    fare: Decimal | None
    tax: Decimal | None


@dataclass(frozen=True)
class InvoiceVerdict:
    """`status` is Passed, Failed or Error; `message` names the invoice and why (blank on Passed)."""

    status: str
    message: str


def judge_invoice(statement: InvoiceFigures, read: InvoiceRead) -> InvoiceVerdict:
    """Compare what Gemini read with the statement's figures for one Porter Invoice.

    Passes only when ALL agree: the invoice number; the supplier GSTIN is Porter's GSTIN; the receiver
    GSTIN is the customer GSTIN; fare and tax each within `PORTER_INVOICE_TOLERANCE`. Spacing and letter case
    in a number or a GSTIN are not a difference.

    * Failed -- at least one figure disagrees. Every disagreeing figure is named, invoice first.
    * Error -- nothing disagrees but a figure was not read. A read glitch decides nothing, so the invoice
      can be retried; a disagreement outweighs it.
    """
    disagree: list[str] = []
    unread: list[str] = []

    def _identity(label: str, read_value: str, statement_value: str) -> None:
        if not _ident(read_value):
            unread.append(_UNREAD_NOUN.get(label, label))
        elif _ident(read_value) != _ident(statement_value):
            disagree.append(f"{label}: invoice {read_value.strip()}, statement {statement_value.strip()}")

    def _money(label: str, read_value: Decimal | None, statement_value: Decimal) -> None:
        if read_value is None:
            unread.append(_UNREAD_NOUN.get(label, label))
        elif abs(Decimal(read_value) - Decimal(statement_value)) > PORTER_INVOICE_TOLERANCE:
            disagree.append(f"{label}: invoice {rupees(read_value)}, statement {rupees(statement_value)}")

    _identity("Invoice number", read.invoice_number, statement.invoice_number)
    _identity("Porter GSTIN", read.supplier_gstin, statement.porter_gstin)
    _identity("Customer GSTIN", read.receiver_gstin, statement.customer_gstin)
    _money("Fare", read.fare, statement.fare)
    _money("Tax", read.tax, statement.tax)

    number = statement.invoice_number
    if disagree:
        return InvoiceVerdict(
            INVOICE_FAILED, f"Invoice {number} disagrees with the statement. {'; '.join(disagree)}."
        )
    if unread:
        listed = unread[0] if len(unread) == 1 else f"{', '.join(unread[:-1])} and {unread[-1]}"
        return InvoiceVerdict(
            INVOICE_ERROR, f"Invoice {number}: could not read the {listed} off the PDF. Retry it."
        )
    return InvoiceVerdict(INVOICE_PASSED, "")


# How a figure Gemini did not read is named mid-sentence ("could not read the invoice number and tax").
_UNREAD_NOUN = {"Invoice number": "invoice number", "Fare": "fare", "Tax": "tax"}


def import_state(invoice_statuses: Iterable[str], line_statuses: Iterable[str] = ()) -> str:
    """The import's state, from its Porter Invoices' statuses and (once validated) its lines'.

    Validation, from the invoices: Validating while any invoice is still in hand; Validated only when
    there are invoices and every one Passed; otherwise Validation failed (a Failed invoice is final, an
    Error one waits for its Retry). Nothing about the lines can outrank this.

    Create (#1445), from the lines of a validated import, a cancelled (Skipped) line aside:
      * Validated -- no line has been touched by Create yet;
      * Created   -- there are completed lines and every one is Settled;
      * Creating  -- anything between: Create is running, or stopped with a line in Error, or a line was
        unreconciled after Create (#1449). Each of these is what a re-run of Create finishes.

    Called with the invoices alone it answers the validation question only: `porter.is_validated`.
    """
    statuses = list(invoice_statuses)
    if any(status in INVOICE_IN_FLIGHT for status in statuses):
        return IMPORT_VALIDATING
    if not statuses or not all(status == INVOICE_PASSED for status in statuses):
        return IMPORT_VALIDATION_FAILED
    completed = [status for status in line_statuses if status != _LINE_SKIPPED]
    if completed and all(status == _LINE_SETTLED for status in completed):
        return IMPORT_CREATED
    if any(status != _LINE_WAITING for status in completed):
        return IMPORT_CREATING
    return IMPORT_VALIDATED


# --- Create (#1445) ------------------------------------------------------------------------------
#
# One Expense per completed order, at Paid, through `settle.create_expense_from_row`; the job around it
# lives in `api/outflow_import/porter_create.py`.

#: The line statuses Create writes an Expense for: never touched (Pending match run), failed on an earlier
#: run (Error), or reopened by Unreconcile after it was created (Mismatched, #1449). A Porter line never
#: runs the matcher, so Mismatched means only that. Settled and Skipped lines are never written.
CREATE_LINE_STATUSES = (ROW_PENDING_MATCH, ROW_ERROR, ROW_MISMATCHED)

_LINE_WAITING = ROW_PENDING_MATCH
_LINE_SETTLED = ROW_SETTLED
_LINE_SKIPPED = ROW_SKIPPED


def expense_description(booked_by: str | None, project_name: str | None) -> str:
    """The owner's wording (spec #1442 story 48): "Porter Delivery raised by {name} for {project}", or
    without " for {project}" on a Non-Project Expense. A blank name drops "raised by"."""
    name = (booked_by or "").strip()
    project = (project_name or "").strip()
    text = f"Porter Delivery raised by {name}" if name else "Porter Delivery"
    return f"{text} for {project}" if project else text


# `Porter Order` field <- Porter's statement column. The completion time is the line's own parsed
# `added_on`; the invoice and the line are links the caller sets.
_ORDER_TEXT_FIELDS = (
    ("crn", "crn"),
    ("vehicle_type", "vehicle_type"),
    ("city", "city"),
    ("from_address", "from_address"),
    ("to_address", "to_address"),
    ("waypoint_addresses", "waypoint_addresses"),
    ("travel_duration", "travel_duration"),
    ("waiting_time", "waiting_time"),
    ("booked_by", "customer_name"),
    ("booked_by_mobile", "customer_mobile"),
    ("booked_by_email", "customer_email"),
    ("remark", "customer_remarks"),
    ("order_status", "order_status"),
)


def porter_order_fields(statement: Mapping[str, str]) -> dict:
    """A `Porter Order`'s order details, from one statement line's columns (`statement_line`).

    Text is trimmed; `fare` is the Porter fare (the Expense amount) and `rcm_gst` the reverse-charge GST
    the statement prints for the order, which is NEVER part of the Expense.
    """
    fields: dict = {field: (statement.get(column) or "").strip() for field, column in _ORDER_TEXT_FIELDS}
    fields["distance_km"] = normalize_amount(statement.get("travel_distance_kms"))
    fields["fare"] = normalize_amount(statement.get("invoice_order_fare"))
    fields["rcm_gst"] = normalize_amount(statement.get("tax_amount"))
    return fields


def rupees(amount: Decimal | float | int) -> str:
    """`₹12,34,567.50`: two decimals, Indian digit grouping, as a failure message prints a figure."""
    value = Decimal(str(amount)).quantize(Decimal("0.01"))
    sign = "-" if value < 0 else ""
    whole, fraction = f"{abs(value):.2f}".split(".")
    head, tail = whole[:-3], whole[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return f"{sign}₹{','.join(groups + [tail])}.{fraction}"


def _ident(value: str | None) -> str:
    """An invoice number or GSTIN as compared: no spaces, upper case."""
    return "".join((value or "").split()).upper()
