# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The ICICI Credit Card Statement reader (#1566, spec #1565, ADR-0039). Pure: no Frappe, no DB.

`read_card_statement(text)` takes the text `pypdf` extracts from the card's monthly PDF
(`card_pdf.statement_text` turns the bytes into it) and returns the statement: the holder and company
from the address block, the statement date, the billing period, the five summary totals and every
transaction line, as printed. It refuses, with `CardStatementError`, anything it cannot import whole:

  * text that is not this statement's layout (no period, no summary, no address block, no lines);
  * a statement not issued to Stratos Infra Technologies ("PVT LTD" and "Private Limited" are one name);
  * a non-zero *Cash Advances*;
  * THE TOTALS GATE (ADR-0039 decision 3): the spends read must equal *Purchases / Charges* and the
    credits read *Payments / Credits*, to the paisa. Plain code reads the PDF; the gate keeps it honest.

THE LAYOUT, measured on the 2026-10-01 statement (`tests/fixtures/icici_card_statement.txt`):

    Statement period : September 2, 2026 to October 1, 2026
    State Code: 29
    MR <HOLDER>                                   <- the address block: holder line, then company line
    <COMPANY>
    Previous Balance Purchases / Charges Cash Advances Payments / Credits
    Á2,24,166.02 Á1,37,584.99 Á0.00 Á2,76,821.73     <- `Á` is how pypdf reads the rupee sign
    11/09/2026 14144135412 transaction cashback 0 1,854.21 CR
    02/09/2026 14099237561 MAKEMYTRIP INDIA PVT NEW DELHI IN 0 11,935.00

A line is `DD/MM/YYYY`, an 11-digit SerNo, the transaction details, the reward points, an optional
international amount, the amount and an optional `CR`. A line dated before the period, or out of date
order, is kept as printed. The card numbers printed as headings in the list are not read (ADR-0039).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from nirmaan_stack.services.outflow_import.amounts import rupees

#: The one company whose cards are imported (GLOSSARY: Credit Card Statement), as `company_key` reads it.
OUR_COMPANY = "Stratos Infra Technologies"

_LINE = re.compile(
    r"^(?P<date>\d{2}/\d{2}/\d{4})\s+(?P<serno>\d{11})\s+(?P<details>.+?)\s+(?P<points>-?\d+)"
    r"(?:\s+(?:[A-Z]{3}\s+)?[\d,]+\.\d{2})?\s+(?P<amount>[\d,]+\.\d{2})(?P<cr>\s+CR)?\s*$"
)
_PERIOD = re.compile(r"Statement period\s*:\s*(?P<start>[A-Za-z]+ \d{1,2}, \d{4})\s+to\s+(?P<end>[A-Za-z]+ \d{1,2}, \d{4})")
_LONG_DATE = re.compile(r"^\s*([A-Za-z]+ \d{1,2}, \d{4})\s*$")
_MONEY = re.compile(r"(?<![\d,])([\d,]+\.\d{2})(?![\d])")
_STANDALONE_MONEY = re.compile(r"^\s*[^\d\s,.]?\s*([\d,]+\.\d{2})\s*$")
_SUMMARY_LABEL = "Previous Balance Purchases / Charges Cash Advances Payments / Credits"
_ADDRESS_ANCHOR = re.compile(r"^\s*State Code\s*:")
_HONORIFIC = re.compile(r"^(?:MR|MRS|MS|MISS|DR|M/S)\.?\s+", re.IGNORECASE)

# Company suffixes, as one spelling each: "PVT LTD" and "Private Limited" are the same name.
_COMPANY_SUFFIXES = frozenset({"PVT", "PRIVATE", "P", "LTD", "LIMITED"})
# What `merchant_key` drops from the END of a merchant's name (spec #1565): the bank prints the same
# merchant as "MAKEMYTRIP(INDIA) P", "MAKEMYTRIP INDIA PVT" and "makemytrip".
_MERCHANT_SUFFIXES = frozenset({"PVT", "PRIVATE", "P", "LTD", "LIMITED", "INDIA"})
# The first word of a two-word city the bank prints after the merchant ("NEW DELHI").
_CITY_PREFIXES = frozenset({"NEW", "NAVI"})


class CardStatementError(ValueError):
    """The file cannot be imported whole. The message is for the accountant, as is."""


@dataclass(frozen=True)
class CardLine:
    """One transaction line, as printed."""

    date: date
    serno: str
    details: str
    amount: Decimal
    is_credit: bool
    merchant_key: str


@dataclass(frozen=True)
class CardTotals:
    """The statement's own summary: what the lines must add up to."""

    previous_balance: Decimal
    purchases: Decimal
    cash_advances: Decimal
    payments: Decimal
    total_due: Decimal


@dataclass(frozen=True)
class CardStatement:
    holder: str
    company: str
    statement_date: date
    period_from: date
    period_to: date
    totals: CardTotals
    lines: tuple[CardLine, ...]

    @property
    def spends(self) -> tuple[CardLine, ...]:
        return tuple(line for line in self.lines if not line.is_credit)

    @property
    def credits(self) -> tuple[CardLine, ...]:
        return tuple(line for line in self.lines if line.is_credit)

    @property
    def spends_total(self) -> Decimal:
        return sum((line.amount for line in self.spends), Decimal("0.00"))

    @property
    def credits_total(self) -> Decimal:
        return sum((line.amount for line in self.credits), Decimal("0.00"))


def read_card_statement(text: str) -> CardStatement:
    """The statement in `text`, gated whole, or `CardStatementError` naming why it cannot be imported."""
    rows = [row.strip() for row in (text or "").splitlines()]
    period_from, period_to = _period(text or "")
    holder, company = _address_block(rows)
    if company_key(company) != company_key(OUR_COMPANY):
        raise CardStatementError(
            f"This statement is issued to {company}, not {OUR_COMPANY}. Only a company card's statement "
            "can be imported."
        )
    totals = _totals(rows)
    lines = tuple(_lines(rows))
    if not lines:
        raise CardStatementError("This statement has no transaction lines to import.")
    statement = CardStatement(
        holder=holder,
        company=company,
        statement_date=_statement_date(rows, period_to),
        period_from=period_from,
        period_to=period_to,
        totals=totals,
        lines=lines,
    )
    _gate(statement)
    return statement


def merchant_key(details: str) -> str:
    """The cleaned merchant name, one key per merchant: upper case, the trailing country code and city
    dropped, punctuation removed, trailing company suffixes (PVT, P, LTD, LIMITED, INDIA) dropped.

    Details with no trailing two-letter country code (a payment received, a cashback) keep every word.
    """
    words = (details or "").split()
    if len(words) >= 3 and re.fullmatch(r"[A-Za-z]{2}", words[-1]):
        words = words[:-2]
        if len(words) >= 2 and words[-1].upper() in _CITY_PREFIXES:
            words = words[:-1]
    cleaned = re.sub(r"[^A-Z0-9]+", " ", " ".join(words).upper()).split()
    while len(cleaned) > 1 and cleaned[-1] in _MERCHANT_SUFFIXES:
        cleaned.pop()
    return " ".join(cleaned)


def line_reference(line: CardLine) -> str:
    """What a card line's Expense carries as its payment reference (ADR-0039 decision 6): the
    transaction details and the SerNo. Written at staging as the line's `settlement_reference`."""
    return f"{line.details} - {line.serno}"


def company_key(name: str) -> str:
    """A company name with its suffixes and punctuation dropped: "PVT LTD" == "Private Limited"."""
    words = re.sub(r"[^A-Z0-9]+", " ", (name or "").upper()).split()
    return " ".join(word for word in words if word not in _COMPANY_SUFFIXES)


# --- the parts ------------------------------------------------------------------------------------


def _not_this_layout(what: str) -> CardStatementError:
    return CardStatementError(
        f"This does not read as an ICICI credit card statement: {what} was not found. Upload the card's "
        "monthly statement PDF as the bank sends it."
    )


def _long_date(value: str) -> date:
    return datetime.strptime(value.strip(), "%B %d, %Y").date()


def _money(value: str) -> Decimal:
    return Decimal(value.replace(",", ""))


def _period(text: str) -> tuple[date, date]:
    found = _PERIOD.search(text)
    if not found:
        raise _not_this_layout("the statement period")
    return _long_date(found.group("start")), _long_date(found.group("end"))


def _address_block(rows: list[str]) -> tuple[str, str]:
    """The holder line and the company line under `State Code:`. The holder's honorific is dropped."""
    for index, row in enumerate(rows):
        if _ADDRESS_ANCHOR.match(row) and index + 2 < len(rows):
            holder = _HONORIFIC.sub("", rows[index + 1]).strip()
            company = rows[index + 2].strip()
            if holder and company:
                return holder, company
    raise _not_this_layout("the card holder's address block")


def _totals(rows: list[str]) -> CardTotals:
    """The summary row under its label, and the Total Amount Due: the larger of the two standalone
    figures on page 1 (the other is the Minimum Amount Due, never above it)."""
    for index, row in enumerate(rows):
        if row == _SUMMARY_LABEL and index + 1 < len(rows):
            figures = [_money(value) for value in _MONEY.findall(rows[index + 1])]
            if len(figures) == 4:
                standalone = [_money(m.group(1)) for m in map(_STANDALONE_MONEY.match, rows) if m]
                return CardTotals(
                    previous_balance=figures[0],
                    purchases=figures[1],
                    cash_advances=figures[2],
                    payments=figures[3],
                    total_due=max(standalone) if standalone else Decimal("0.00"),
                )
    raise _not_this_layout("the statement summary (Purchases / Charges, Payments / Credits)")


def _statement_date(rows: list[str], period_to: date) -> date:
    """The earlier of the two standalone long dates (statement date, payment due date); the period's end
    when the layout prints neither."""
    dates = [_long_date(m.group(1)) for m in map(_LONG_DATE.match, rows) if m]
    return min(dates) if dates else period_to


def _lines(rows: list[str]):
    for row in rows:
        found = _LINE.match(row)
        if not found:
            continue
        details = found.group("details").strip()
        yield CardLine(
            date=datetime.strptime(found.group("date"), "%d/%m/%Y").date(),
            serno=found.group("serno"),
            details=details,
            amount=_money(found.group("amount")),
            is_credit=bool(found.group("cr")),
            merchant_key=merchant_key(details),
        )


def _gate(statement: CardStatement) -> None:
    """ADR-0039 decision 3: all or nothing, to the paisa, no override."""
    totals = statement.totals
    if totals.cash_advances != 0:
        raise CardStatementError(
            f"This statement has Cash Advances of {rupees(totals.cash_advances)}. A cash withdrawal on a card "
            "cannot be imported, so nothing was imported."
        )
    problems = []
    if statement.spends_total != totals.purchases:
        problems.append(
            f"spends read {rupees(statement.spends_total, paise=True)}, Purchases / Charges "
            f"{rupees(totals.purchases, paise=True)}"
        )
    if statement.credits_total != totals.payments:
        problems.append(
            f"credits read {rupees(statement.credits_total, paise=True)}, Payments / Credits "
            f"{rupees(totals.payments, paise=True)}"
        )
    if problems:
        raise CardStatementError(
            "The lines read do not add up to the statement's own totals, so nothing was imported: "
            + "; ".join(problems)
            + "."
        )
