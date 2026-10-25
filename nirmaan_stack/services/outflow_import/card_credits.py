# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Sorting a card statement's lines so only real work stays open (#1567, spec #1565, ADR-0037 decision 4).

PURE: no Frappe, no DB. `sort_card_lines(lines)` answers, for every line the reader returned, what it is:

    SPEND            a card spend: it becomes a Non-Project Expense on Create
    CARD_PAYMENT     money paid INTO the card (auto-debit, UPI and other payments received, an auto-debit
                     return): a system skip, never unskipped
    CASHBACK         the bank's cashback: a system skip, never unskipped (cashback is not recorded as income)
    REFUND           a merchant credit that cancels a spend of the same merchant key and exactly the same
                     amount on this statement; its `partner` is that spend
    REFUNDED_SPEND   the spend a REFUND cancels; its `partner` is the refund. Both lines are skipped together
                     and come back together on unskip
    UNPAIRED_CREDIT  any other merchant credit: open, with the choices a bank credit has

⚠️ ONE CREDIT CANCELS ONE SPEND: the latest spend before it (by date, then as printed), and a spend is
cancelled at most once. So two identical bookings with one refund leave one spend open. A spend dated after
the credit, or dated the same day but printed after it, is never its partner. Credits are paired in date order, then as printed.

⚠️ PAYMENTS AND CASHBACK ARE KNOWN BY THEIR WORDS, and only on a credit. A spend's details are never read
for them: every debit stays a spend.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

from nirmaan_stack.services.outflow_import.amounts import rupees
from nirmaan_stack.services.outflow_import.card_statement import CardLine
from nirmaan_stack.services.outflow_import.skip_kinds import (
    SKIP_KIND_CARD_CASHBACK,
    SKIP_KIND_CARD_PAYMENT,
    SKIP_KIND_CARD_REFUND_PAIR,
)
from nirmaan_stack.services.outflow_import.status import (
    ROW_SKIPPED,
    SKIP_ORIGIN_SYSTEM,
    SKIP_REASON_CARD_CASHBACK,
    SKIP_REASON_CARD_PAYMENT,
    SKIP_REASON_CARD_REFUND,
    SKIP_REASON_CARD_REFUNDED_SPEND,
)

SPEND = "spend"
CARD_PAYMENT = "card payment"
CASHBACK = "cashback"
REFUND = "refund"
REFUNDED_SPEND = "refunded spend"
UNPAIRED_CREDIT = "unpaired credit"

#: What a main-table action on a card SPEND is refused with: it waits for the card import's own Create
#: (`sources.line_waits_for_its_own_create`). A card credit is decided on the main table.
CARD_SPEND_REFUSAL = (
    "This is a card spend. It can only be created by its Credit Card Statement import. Open that import "
    "from Import History, on the Credit Card tab."
)

#: The kinds that are skipped at upload. The other two (a spend, an unpaired credit) are open work.
SKIPPED_KINDS = frozenset({CARD_PAYMENT, CASHBACK, REFUND, REFUNDED_SPEND})

# Read on the merchant key (upper case, punctuation dropped): "Autodebit Payment Recd." ->
# "AUTODEBIT PAYMENT RECD", "Auto Dr.Retn-Insuff. fund" -> "AUTO DR RETN INSUFF FUND".
_PAYMENT = re.compile(r"\bPAYMENT (?:RECD|RECEIVED)\b|^AUTO DR RETN\b")
_CASHBACK = re.compile(r"\bCASH ?BACK\b")


@dataclass(frozen=True)
class LineSort:
    """What one line is. `partner` is the other line of a refund pair, else `None`."""

    kind: str
    partner: CardLine | None = None

    @property
    def skipped(self) -> bool:
        return self.kind in SKIPPED_KINDS


def skip_values(sort: LineSort) -> dict:
    """The `Outflow Import Row` fields a line's sort stages it with: a system skip with its kind and
    sentence (the sentence also the line's note, as the table shows it), or nothing for open work. The
    pair's `card_refund_partner` link is written once both lines exist (`card_upload.stage`)."""
    if not sort.skipped:
        return {}
    if sort.kind == CARD_PAYMENT:
        kind, reason = SKIP_KIND_CARD_PAYMENT, SKIP_REASON_CARD_PAYMENT
    elif sort.kind == CASHBACK:
        kind, reason = SKIP_KIND_CARD_CASHBACK, SKIP_REASON_CARD_CASHBACK
    else:
        template = SKIP_REASON_CARD_REFUND if sort.kind == REFUND else SKIP_REASON_CARD_REFUNDED_SPEND
        kind, reason = SKIP_KIND_CARD_REFUND_PAIR, template.format(partner=partner_label(sort.partner))
    return {
        "row_status": ROW_SKIPPED,
        "skip_origin": SKIP_ORIGIN_SYSTEM,
        "skip_kind": kind,
        "skip_reason": reason,
        "outcome_note": reason,
    }


def partner_label(line: CardLine) -> str:
    """How a refund pair's sentence names the other line: `SerNo 14099237561 of 02-Sep-2026, ₹11,935`."""
    return f"SerNo {line.serno} of {line.date:%d-%b-%Y}, {rupees(line.amount)}"


def sort_card_lines(lines: Iterable[CardLine]) -> dict[str, LineSort]:
    """Every line's sort, keyed by SerNo."""
    lines = list(lines)
    result: dict[str, LineSort] = {}
    merchant_credits: list[tuple[int, CardLine]] = []
    for position, line in enumerate(lines):
        if not line.is_credit:
            result[line.serno] = LineSort(SPEND)
        elif _PAYMENT.search(line.merchant_key):
            result[line.serno] = LineSort(CARD_PAYMENT)
        elif _CASHBACK.search(line.merchant_key):
            result[line.serno] = LineSort(CASHBACK)
        else:
            merchant_credits.append((position, line))

    open_spends = [(position, line) for position, line in enumerate(lines) if not line.is_credit]
    for position, credit in sorted(merchant_credits, key=lambda pair: (pair[1].date, pair[0])):
        candidates = [
            (spend.date, spend_position, spend)
            for spend_position, spend in open_spends
            if spend.merchant_key == credit.merchant_key
            and spend.amount == credit.amount
            and (spend.date, spend_position) < (credit.date, position)
        ]
        if not candidates:
            result[credit.serno] = LineSort(UNPAIRED_CREDIT)
            continue
        _, spend_position, spend = max(candidates, key=lambda c: (c[0], c[1]))
        open_spends.remove((spend_position, spend))
        result[credit.serno] = LineSort(REFUND, partner=spend)
        result[spend.serno] = LineSort(REFUNDED_SPEND, partner=credit)
    return result
