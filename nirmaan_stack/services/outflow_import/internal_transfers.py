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
from dataclasses import dataclass, replace
from decimal import Decimal

from nirmaan_stack.services.outflow_import.bank_exclusions import (
    IFSC_CASHBOOK,
    IFSC_CASHFREE,
    IFSC_PORTER,
    NEFT_RETURN_FAILED,
)
from nirmaan_stack.services.outflow_import.duplicates import Repeat, bank_status_key
from nirmaan_stack.services.outflow_import.repeats import KeptLine
from nirmaan_stack.services.outflow_import.skip_kinds import SKIP_KIND_BY_EXCLUSION_CATEGORY

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


#: A record's direction, as its line states it: money out of, or into, the statement's own account.
TRANSFER_OUT = "Out"
TRANSFER_IN = "In"

#: `made_by` on a record a person made (#1626); a rule's record carries its rule id instead.
MADE_BY_HAND = "by hand"


def record_direction(line_direction: str | None) -> str:
    """`In` for a line the statement calls a Credit, else `Out`."""
    return TRANSFER_IN if (line_direction or "").strip() == "Credit" else TRANSFER_OUT


def cashbook_direction(debit) -> str:
    """A Cashbook move's direction, by the column the statement filled: a Debit is money out of the statement's
    account, a Credit (a top-up, whose Debit is blank and so stored as 0) money in (#1623)."""
    return TRANSFER_OUT if (debit or 0) > 0 else TRANSFER_IN


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


def card_ending(last_four: str) -> str:
    """A record's detail naming a card: `Card ending 1234`, or blank with no digits."""
    last_four = (last_four or "").strip()
    return f"Card ending {last_four}" if last_four else ""


def card_detail(text: str) -> str:
    """`Card ending 1234` when the text carries a masked card number, else blank."""
    found = _RE_CARD_LAST_FOUR.search(text or "")
    return card_ending(found.group(1)) if found else ""


def _gl_detail(text: str) -> str:
    found = _RE_GL_NUMBERS.search(text or "")
    return f"GL {found.group(1)} to {found.group(2)}" if found else ""


# A bounced wallet top-up (#1622): our wallets, each by its IFSC and by its name. The IFSC wins over the name, as
# it does for the top-up rules (`bank_exclusions` design rule (c)). Names are WORD-BOUNDED on both sides: a word
# that only contains one ("transporter", "mycashbooks") names no wallet.
_WALLET_BY_IFSC = ((IFSC_CASHFREE, PLACE_CASHFREE), (IFSC_CASHBOOK, PLACE_CASHBOOK_VA), (IFSC_PORTER, PLACE_PORTER))
_WALLET_BY_NAME = (
    (re.compile(r"\bcash\s*free\b", re.I), PLACE_CASHFREE),
    (re.compile(r"\bcash\s*book\b", re.I), PLACE_CASHBOOK_VA),
    (re.compile(r"\bporter\b", re.I), PLACE_PORTER),
)


def named_wallet(text: str) -> str | None:
    """The wallet a bank text names -- by IFSC first, then by name -- or `None` when it names none."""
    text = text or ""
    for ifsc, place in _WALLET_BY_IFSC:
        if ifsc in text:
            return place
    for pattern, place in _WALLET_BY_NAME:
        if pattern.search(text):
            return place
    return None


def _bounced_top_up(remarks: str) -> TransferEnds | None:
    """A returned NEFT is ours only when it names one of our wallets; a bounced vendor payment stays a skip."""
    wallet = named_wallet(remarks)
    return TransferEnds(wallet, PLACE_ICICI_CURRENT) if wallet else None


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
    # #1622: only when the return names one of our wallets; otherwise `None`, and the line keeps its skip.
    NEFT_RETURN_FAILED: _bounced_top_up,
}

#: The bank-exclusion categories whose lines may be Internal Transfers (spec #1619 Implementation Decisions).
#: `neft_return_failed` only when the line names one of our wallets.
INTERNAL_BANK_CATEGORIES = frozenset(_BANK_CATEGORY_ENDS)


def bank_line_transfer(category: str, remarks: str) -> TransferEnds | None:
    """The transfer an ICICI line is, given the exclusion category that recognised it -- or `None` to leave it
    as today's skip (no category, or a category that is not an internal move)."""
    ends = _BANK_CATEGORY_ENDS.get(category or "")
    return ends(remarks or "") if ends else None


# --- Cashbook Statement (#1623) ---------------------------------------------------------------------------------

CASHBOOK_BANK_TO_VA = "Bank → VA"
CASHBOOK_VA_TO_WALLET = "VA → Wallet"
CASHBOOK_WALLET_TO_VA = "Wallet → VA"
#: The Cashbook Types that are our own moves, each with the id its record names as the rule that made it.
CASHBOOK_INTERNAL_KINDS = {
    CASHBOOK_BANK_TO_VA: "cashbook_bank_to_va",
    CASHBOOK_VA_TO_WALLET: "cashbook_va_to_wallet",
    CASHBOOK_WALLET_TO_VA: "cashbook_wallet_to_va",
}


#: A Cashbook line staged before the statement's Type was stored is read by its Txn Id (spec #1619).
CASHBOOK_KIND_BY_TXN_PREFIX = (
    ("VALOAD-", CASHBOOK_BANK_TO_VA),
    ("BUSINESS_USER-", CASHBOOK_VA_TO_WALLET),
    ("C2B-", CASHBOOK_WALLET_TO_VA),
)


def cashbook_line_kind(row_kind: str | None, transfer_id: str | None) -> str:
    """A Cashbook line's Type: the one stored, or, on a line staged before the Type was stored, the move its Txn Id
    names. Blank when neither says."""
    kind = (row_kind or "").strip()
    if kind:
        return kind
    txn = (transfer_id or "").strip()
    return next((named for prefix, named in CASHBOOK_KIND_BY_TXN_PREFIX if txn.startswith(prefix)), "")


def cashbook_line_transfer(row_kind: str, *, from_party: str, to_party: str) -> TransferEnds | None:
    """The transfer a Cashbook line is, by its Type (the statement's `From` and `To` name the employee), or `None`
    for every other Type (a spend, a refund, a wallet credit, a collect payment keep their own handling).

    ⚠️ `Bank → VA` RUNS FROM THE ICICI CURRENT ACCOUNT, a decision (spec #1619): it is the only bank account that
    funds Cashbook (57 of 57 such lines Jan to Sep 2026 matched an ICICI debit).
    """
    kind = (row_kind or "").strip()
    if kind == CASHBOOK_BANK_TO_VA:
        return TransferEnds(PLACE_ICICI_CURRENT, PLACE_CASHBOOK_VA)
    if kind == CASHBOOK_VA_TO_WALLET:
        return TransferEnds(PLACE_CASHBOOK_VA, PLACE_CASHBOOK_WALLET, (to_party or "").strip())
    if kind == CASHBOOK_WALLET_TO_VA:
        return TransferEnds(PLACE_CASHBOOK_WALLET, PLACE_CASHBOOK_VA, (from_party or "").strip())
    return None


def cashbook_raw_transfer(raw) -> TransferEnds | None:
    """`cashbook_line_transfer` for a parsed Cashbook row: its Type, and the employee from `From` / `To`."""
    return cashbook_line_transfer(
        getattr(raw, "row_kind", "") or "",
        from_party=getattr(raw, "added_by_raw", "") or "",
        to_party=getattr(raw, "beneficiary_name", "") or "",
    )


def cashbook_transfer_money(raw) -> Decimal:
    """The money a Cashbook move moved: its Debit, or its Credit where the Debit is blank (a top-up). The line's
    own stored amount stays its Debit, its repeat identity (#1623)."""
    debit = getattr(raw, "amount", None) or Decimal("0")
    credit = getattr(raw, "credit_amount", None) or Decimal("0")
    return debit if debit > 0 else credit


@dataclass(frozen=True)
class CashbookMove:
    """One of Cashbook's own moves, as its Internal Transfer line's record states it (#1623): where the money came
    from and went, the money moved, its direction, and the rule id the record names."""

    ends: TransferEnds
    money: Decimal
    direction: str
    rule: str


def cashbook_move(raw) -> CashbookMove:
    """The move a Cashbook line that says SUCCESS records (owner decision 3, #1619: only such a line is an Internal
    Transfer line, so each one holds exactly one record)."""
    return CashbookMove(
        ends=cashbook_raw_transfer(raw),
        money=cashbook_transfer_money(raw),
        direction=cashbook_direction(getattr(raw, "amount", None)),
        rule=CASHBOOK_INTERNAL_KINDS[(getattr(raw, "row_kind", "") or "").strip()],
    )


def name_refused_moves(kept) -> tuple[KeptLine, ...]:
    """`kept` (the repeat walk's lines, in file order), each Cashbook move line that does not say SUCCESS and has no
    earlier sighting of its own carrying, as `in_file`, the first earlier line of this file of the same move (Txn Id
    and stored amount) under another bank status (owner decision 3, #1619): its Bank refused sentence names it.

    The repeat walk never makes an Internal Transfer line the basis of an in-file status change (a top-up must not
    swallow a spend that shares its identity), so without this the sentence would name nothing."""
    first_status: dict[tuple, str] = {}
    named = []
    for line in kept:
        raw = line.row
        move = (getattr(raw, "transfer_id", "") or "", getattr(raw, "amount", None))
        status, earlier = bank_status_key(getattr(raw, "status_raw", "")), first_status.get(move)
        refused = (getattr(raw, "row_kind", "") or "").strip() in CASHBOOK_INTERNAL_KINDS and not raw.is_success
        if refused and not (line.earlier or line.in_file) and earlier not in (None, status):
            line = replace(line, in_file=Repeat(label="", earlier_status=earlier, exact=False))
        first_status.setdefault(move, status)
        named.append(line)
    return tuple(named)


def transfer_sentence(ends: TransferEnds) -> str:
    """The line's note, naming both ends: `Internal Transfer from Cashbook Virtual Account to Cashbook Employee
    Wallet (Test Employee A).`"""
    detail = f" ({ends.detail})" if ends.detail else ""
    return f"Internal Transfer from {ends.from_place} to {ends.to_place}{detail}."


# --- Credit Card Statement (#1624) ------------------------------------------------------------------------------

#: The id a card auto-debit's record names as the rule that made it.
CARD_AUTO_DEBIT_RULE = "card_auto_debit"


def card_auto_debit_transfer(card_last_four: str) -> TransferEnds:
    """The bank's auto-debit paying the card: ICICI Current Account to ICICI Credit Card, on that card."""
    return TransferEnds(PLACE_ICICI_CURRENT, PLACE_ICICI_CARD, card_ending(card_last_four))


# --- Made by, in words ------------------------------------------------------------------------------------------

# The bank rules' words are their Skip Types' (the same move, once skipped); a bounced top-up's is its own here,
# because only a bounce that names one of our wallets is an Internal Transfer.
_RULE_WORDS = {
    **{category: SKIP_KIND_BY_EXCLUSION_CATEGORY[category] for category in INTERNAL_BANK_CATEGORIES},
    NEFT_RETURN_FAILED: "Bounced wallet top-up",
    **{rule: f"Cashbook {kind}" for kind, rule in CASHBOOK_INTERNAL_KINDS.items()},
    CARD_AUTO_DEBIT_RULE: "Card auto-debit",
}


def made_by_words(made_by: str | None) -> str:
    """Who made a record, as the screen says it (review finding, #1619): `By hand`, or `Rule: <the rule in words>`,
    e.g. `Rule: Cashfree wallet top-up`. A rule id this table does not know is shown as stored."""
    made_by = (made_by or "").strip()
    if not made_by:
        return ""
    if made_by == MADE_BY_HAND:
        return "By hand"
    return f"Rule: {_RULE_WORDS.get(made_by, made_by)}"
