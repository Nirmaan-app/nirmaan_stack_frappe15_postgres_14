# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Which recognised lines are Internal Transfers, and where the money came from and went (spec #1619, ADR-0044).

PURE: no Frappe, no database. GLOSSARY: *Internal Transfer* -- the company's own money moving between two of
its own places. The bank exclusion rules (`bank_exclusions`) still decide which ICICI lines are not spend; this
table then says which of their categories are Internal Transfers (and their From, To and detail) and which stay
Skipped. The rule fills From and To; nobody is asked.

From and To come from a fixed list of places (`PLACES`). A second bank account or card issuer needs the list
extended here, in code (owner, 2026-11-06).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

PLACE_ICICI_CURRENT = "ICICI Current Account"
PLACE_ICICI_LEDGER = "ICICI Bank Ledger"
PLACE_CASHFREE = "Cashfree Wallet"
PLACE_CASHBOOK_VA = "Cashbook Virtual Account"
PLACE_CASHBOOK_WALLET = "Cashbook Employee Wallet"
PLACE_PORTER = "Porter Wallet"
PLACE_ICICI_CARD = "ICICI Credit Card"

#: Every place a transfer may start or end at. The doctype's `from_place` / `to_place` Selects carry this list
#: in this order (pinned by test).
PLACES = (
    PLACE_ICICI_CURRENT,
    PLACE_ICICI_LEDGER,
    PLACE_CASHFREE,
    PLACE_CASHBOOK_VA,
    PLACE_CASHBOOK_WALLET,
    PLACE_PORTER,
    PLACE_ICICI_CARD,
)


@dataclass(frozen=True)
class TransferEnds:
    """Where one internal move came from and went to, plus a short detail (an employee, a card's last four)."""

    from_place: str
    to_place: str
    detail: str = ""


# A card number as the bank masks it: two or more X's (or *), then the last four digits.
_RE_CARD_LAST_FOUR = re.compile(r"[Xx*]{2,}(\d{4})\b")
# The bank's own ledger move names both ledgers: `Ac xfr from gl 01234 to 56789`.
_RE_GL_NUMBERS = re.compile(r"from\s+gl\s+(\w+)\s+to\s+(\w+)", re.I)


def card_detail(text: str) -> str:
    """`Card ending 1234` when the text carries a masked card number, else blank."""
    found = _RE_CARD_LAST_FOUR.search(text or "")
    return f"Card ending {found.group(1)}" if found else ""


def _gl_detail(text: str) -> str:
    found = _RE_GL_NUMBERS.search(text or "")
    return f"GL {found.group(1)} to {found.group(2)}" if found else ""


def _to_card(remarks: str) -> TransferEnds:
    return TransferEnds(PLACE_ICICI_CURRENT, PLACE_ICICI_CARD, card_detail(remarks))


# Per bank-exclusion category: the transfer it is, from the line's bank text. A category absent here stays
# Skipped (`bank_card_adjustment`: the bank's ₹2 rounding, where no money of ours moved).
_BANK_CATEGORY_ENDS = {
    "platform_cashfree": lambda remarks: TransferEnds(PLACE_ICICI_CURRENT, PLACE_CASHFREE),
    "platform_cashbook": lambda remarks: TransferEnds(PLACE_ICICI_CURRENT, PLACE_CASHBOOK_VA),
    "platform_porter": lambda remarks: TransferEnds(PLACE_ICICI_CURRENT, PLACE_PORTER),
    "gateway_wallet_return": lambda remarks: TransferEnds(PLACE_CASHFREE, PLACE_ICICI_CURRENT),
    "internal_gl_transfer": lambda remarks: TransferEnds(PLACE_ICICI_CURRENT, PLACE_ICICI_LEDGER, _gl_detail(remarks)),
    "internal_gl_transfer_in": lambda remarks: TransferEnds(
        PLACE_ICICI_LEDGER, PLACE_ICICI_CURRENT, _gl_detail(remarks)
    ),
    "credit_card_bill_payment": _to_card,
    "credit_facility_auto_debit": _to_card,
}

#: The bank-exclusion categories whose lines are Internal Transfers (spec #1619 Implementation Decisions).
INTERNAL_BANK_CATEGORIES = frozenset(_BANK_CATEGORY_ENDS)


def bank_line_transfer(category: str, remarks: str) -> TransferEnds | None:
    """The transfer an ICICI line is, given the exclusion category that recognised it -- or `None` to leave it
    as today's skip (no category, or a category that is not an internal move)."""
    ends = _BANK_CATEGORY_ENDS.get(category or "")
    return ends(remarks or "") if ends else None
