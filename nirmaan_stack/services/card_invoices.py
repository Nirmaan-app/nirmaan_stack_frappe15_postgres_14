# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A card spend's invoice (spec #1565, #1570, ADR-0037 ruling 8). Pure: no `frappe.db`, no request.

Every card spend is a Paid `Non Project Expenses` row carrying `credit_card_statement`. It waits in Vendor
Invoice Recon -> Pending Invoices Upload -> Credit Card until either its invoice file is attached
(`invoice_attachment`; number and date optional) or an Admin / Accountant Lead marks it *No invoice* with a
reason (`no_invoice_reason`, `no_invoice_by`, `no_invoice_at`). These are the refusals both actions share.
The endpoints are `api/expenses/card_invoices.py`.
"""

from __future__ import annotations

import datetime
from typing import NamedTuple


class CardExpenseFacts(NamedTuple):
    """What the rules read of one expense, re-read inside the endpoint's lock."""

    name: str
    is_card: bool
    invoice_attachment: str | None
    no_invoice_by: str | None


REASON_REQUIRED = "Type the reason this spend has no invoice."
FILE_REQUIRED = "Attach the invoice file."
FUTURE_INVOICE_DATE = "Invoice date cannot be in the future."


def card_line_details(payment_ref: str | None) -> str:
    """The statement line's transaction details: the payment_ref "{details} - {SerNo}" with the SerNo taken off."""
    ref = (payment_ref or "").strip()
    head, sep, tail = ref.rpartition(" - ")
    if sep and tail.isdigit():
        return head
    return ref


def statement_months(start, end) -> list[str]:
    """Every "YYYY-MM" from the month of `start` to the month of `end`, oldest first: the Statement months
    (GLOSSARY) of a statement whose period is those days. A reversed pair is read in order."""
    if not start or not end:
        return []
    first, last = sorted(datetime.date.fromisoformat(str(day)[:10]) for day in (start, end))
    months, year, month = [], first.year, first.month
    while (year, month) <= (last.year, last.month):
        months.append(f"{year}-{month:02d}")
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return months


def _still_waiting_problem(facts: CardExpenseFacts) -> str | None:
    if not facts.is_card:
        return f"{facts.name} is not a card spend."
    if facts.invoice_attachment:
        return f"{facts.name} already has its invoice."
    if facts.no_invoice_by:
        return f"{facts.name} is already marked No invoice by {facts.no_invoice_by}."
    return None


def no_invoice_problem(facts: CardExpenseFacts, reason: str | None) -> str | None:
    """Why this spend may not be marked *No invoice* with `reason`, or None when it may."""
    return _still_waiting_problem(facts) or (None if (reason or "").strip() else REASON_REQUIRED)


def attach_problem(facts: CardExpenseFacts, file_url: str | None, invoice_date: str | None, *, today: str) -> str | None:
    """Why `file_url` may not be attached as this spend's invoice, or None. The date (ISO) is optional."""
    problem = _still_waiting_problem(facts)
    if problem:
        return problem
    if not (file_url or "").strip():
        return FILE_REQUIRED
    if invoice_date and str(invoice_date) > today:
        return FUTURE_INVOICE_DATE
    return None
