# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Does one Porter Invoice's PDF, as Gemini read it, agree with the statement? (#1444, ADR-0032)

PURE MODULE -- no `frappe`, no database. `judge_invoice` is the Comparing step of the validation job
(`api/outflow_import/porter_validation.py`); its verdict is one of the invoice statuses in
`porter_state`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from nirmaan_stack.services.outflow_import.amounts import PORTER_INVOICE_TOLERANCE, rupees
from nirmaan_stack.services.outflow_import.porter_state import (
    INVOICE_ERROR,
    INVOICE_FAILED,
    INVOICE_PASSED,
)

__all__ = ["InvoiceFigures", "InvoiceRead", "InvoiceVerdict", "judge_invoice"]


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
            disagree.append(f"{label}: invoice {rupees(read_value, paise=True)}, statement {rupees(statement_value, paise=True)}")

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


def _ident(value: str | None) -> str:
    """An invoice number or GSTIN as compared: no spaces, upper case."""
    return "".join((value or "").split()).upper()
