# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Does one Porter Invoice's PDF, as Gemini read it, agree with the statement? (#1444, #1559, ADR-0032)

PURE MODULE -- no `frappe`, no database. `judge_invoice` is the Comparing step of the validation job
(`api/outflow_import/porter_validation.py`); its verdict is one of the invoice statuses in
`porter_state`. It needs only the statement's figures and what was read, so an invoice can be judged
again from its stored reading, without downloading the PDF.

ONLY THE PORTER FARE AND THE INVOICE DATE DECIDE (spec #1554). The GST on a Porter Order comes from the
statement whatever the PDF says, and Gemini often misreads a GSTIN, so a GSTIN, tax or invoice-number
difference -- or one it could not read -- is a WARNING on the verdict, never a failure.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, timedelta
from decimal import Decimal

from nirmaan_stack.services.outflow_import.amounts import PORTER_INVOICE_TOLERANCE, rupees
from nirmaan_stack.services.outflow_import.porter_state import (
    INVOICE_ERROR,
    INVOICE_FAILED,
    INVOICE_PASSED,
)

__all__ = [
    "INVOICE_DATE_SLACK_DAYS",
    "InvoiceFigures",
    "InvoiceRead",
    "InvoiceVerdict",
    "InvoiceWarning",
    "invoice_date_window",
    "judge_invoice",
    "stored_warnings",
    "warnings_from_stored",
]

#: How many days after the statement's last order an invoice may still be dated: Porter issues the
#: month's invoices just after it ends.
INVOICE_DATE_SLACK_DAYS = 7


@dataclass(frozen=True)
class InvoiceFigures:
    """The statement's side of the comparison: one Porter Invoice over its COMPLETED orders, and the
    statement's period (its first and last order completion dates, the import's `period_from` / `period_to`).
    A period of None leaves the invoice date unchecked."""

    invoice_number: str
    porter_gstin: str
    customer_gstin: str
    fare: Decimal
    tax: Decimal
    first_order_date: date | None
    last_order_date: date | None


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
class InvoiceWarning:
    """A figure the PDF reads differently from the statement, which does not stop the invoice agreeing.
    `figure` is its label (Invoice number, Porter GSTIN, Customer GSTIN, Tax); `statement` and `read` are
    as shown, `read` None when Gemini could not read it."""

    figure: str
    statement: str
    read: str | None


@dataclass(frozen=True)
class InvoiceVerdict:
    """`status` is Passed, Failed or Error; `message` names the invoice and why (blank on Passed);
    `warnings` the figures that differ without deciding anything, whatever the status."""

    status: str
    message: str
    warnings: tuple[InvoiceWarning, ...] = ()


def invoice_date_window(first_order_date: date, last_order_date: date) -> tuple[date, date]:
    """The dates a Porter Invoice of this statement may carry: its first order to its last plus
    `INVOICE_DATE_SLACK_DAYS`, both ends included."""
    return first_order_date, last_order_date + timedelta(days=INVOICE_DATE_SLACK_DAYS)


def judge_invoice(statement: InvoiceFigures, read: InvoiceRead) -> InvoiceVerdict:
    """Compare what Gemini read with the statement's figures for one Porter Invoice.

    * Failed -- the fare is more than `PORTER_INVOICE_TOLERANCE` off, or the invoice date falls outside
      `invoice_date_window`. Each is named, fare first.
    * Error -- nothing failed, but the fare or the date was not read. A read glitch decides nothing, so
      the invoice can be retried; a failure outweighs it.
    * Passed -- otherwise.

    Whatever the status, the invoice number, Porter GSTIN (the supplier's), customer GSTIN (the receiver's)
    and tax (within the same tolerance) are compared too, and each that differs or was not read is a
    warning. Spacing and letter case in a number or a GSTIN are not a difference.
    """
    failed: list[str] = []
    unread: list[str] = []
    warnings: list[InvoiceWarning] = []

    if read.fare is None:
        unread.append("fare")
    elif _money_differs(read.fare, statement.fare):
        failed.append(f"Fare: invoice {_rupees(read.fare)}, statement {_rupees(statement.fare)}")

    if read.invoice_date is None:
        unread.append("invoice date")
    elif statement.first_order_date and statement.last_order_date:
        start, end = invoice_date_window(statement.first_order_date, statement.last_order_date)
        if not start <= read.invoice_date <= end:
            failed.append(
                f"Invoice date: invoice {_day(read.invoice_date)}, outside the statement's orders "
                f"{_day(statement.first_order_date)} to {_day(statement.last_order_date)} plus "
                f"{INVOICE_DATE_SLACK_DAYS} days"
            )

    for figure, read_value, statement_value in (
        ("Invoice number", read.invoice_number, statement.invoice_number),
        ("Porter GSTIN", read.supplier_gstin, statement.porter_gstin),
        ("Customer GSTIN", read.receiver_gstin, statement.customer_gstin),
    ):
        if not _ident(read_value) or _ident(read_value) != _ident(statement_value):
            warnings.append(
                InvoiceWarning(figure, (statement_value or "").strip(), (read_value or "").strip() or None)
            )
    if read.tax is None or _money_differs(read.tax, statement.tax):
        warnings.append(
            InvoiceWarning("Tax", _rupees(statement.tax), None if read.tax is None else _rupees(read.tax))
        )

    number = statement.invoice_number
    if failed:
        return InvoiceVerdict(
            INVOICE_FAILED, f"Invoice {number} disagrees with the statement. {'; '.join(failed)}.", tuple(warnings)
        )
    if unread:
        return InvoiceVerdict(
            INVOICE_ERROR,
            f"Invoice {number}: could not read the {' and '.join(unread)} off the PDF. Retry it.",
            tuple(warnings),
        )
    return InvoiceVerdict(INVOICE_PASSED, "", tuple(warnings))


def stored_warnings(warnings: tuple[InvoiceWarning, ...]) -> dict | None:
    """The warnings as `Porter Invoice.validation_warnings` holds them: an object, never a bare list (a
    JSON field), and None when there are none -- so "has warnings" is `IS NOT NULL`."""
    return {"warnings": [asdict(warning) for warning in warnings]} if warnings else None


def warnings_from_stored(stored: dict | None) -> tuple[InvoiceWarning, ...]:
    """`stored_warnings` read back."""
    return tuple(InvoiceWarning(**warning) for warning in (stored or {}).get("warnings") or ())


def _money_differs(read_value: Decimal, statement_value: Decimal) -> bool:
    return abs(Decimal(read_value) - Decimal(statement_value)) > PORTER_INVOICE_TOLERANCE


def _rupees(value: Decimal) -> str:
    return rupees(value, paise=True)


def _day(value: date) -> str:
    """A date as the screens write it, dd-MMM-yyyy."""
    return value.strftime("%d-%b-%Y")


def _ident(value: str | None) -> str:
    """An invoice number or GSTIN as compared: no spaces, upper case."""
    return "".join((value or "").split()).upper()
