# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Which lines of a Cashbook statement re-open a line an earlier import wrongly skipped (#1596).

PURE MODULE -- no `frappe`, no database. Spec #1585 "Re-opening old wrong skips", ADR-0015 Amendment B decision 8.
Earlier imports skipped every Collect payment, refund and wallet credit as "Moves money between our own balances".
When a new statement carries such a line and the new rules make it an open line or one line of a *Paired wallet
refund*, the import re-opens THAT earlier line under the new rules (`api.outflow_import.cashbook._reopen_line`); it
never stages a second line for it, and never creates an Expense.

HOW AN EARLIER COPY IS FOUND. By Txn Id and date (`duplicates.dates_agree`), and by amount: the same Debit for a
Collect payment; for a refund or wallet credit its Credit, or 0, because the earlier import read no Credit and
stored 0 (#1594). An earlier copy staged by the new import knows its Type, and only one of the same Type is taken.
Each earlier copy is re-opened by one line, the first in file order.

Only the own-balances reason re-opens (`EarlierWrongSkip` is read only from lines skipped with it). Every other
skip kind stays as it is, and a real internal movement (VA -> Wallet, Bank -> VA, Wallet -> VA) is never a
candidate: the new rules skip it too.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Callable, Iterable, Sequence

from nirmaan_stack.services.outflow_import.cashbook_refunds import (
    COLLECT_ROW_KIND,
    CREDIT_ROW_KINDS,
    line_money,
    row_kind,
)
from nirmaan_stack.services.outflow_import.duplicates import PriorSighting, dates_agree, find_prior_sightings

__all__ = ["REOPENABLE_ROW_KINDS", "EarlierWrongSkip", "claim_wrong_skips", "earlier_sightings", "old_rule_amount"]

# The Types the earlier imports skipped as own balances and the new rules act on.
REOPENABLE_ROW_KINDS = CREDIT_ROW_KINDS | {COLLECT_ROW_KIND}


@dataclass(frozen=True)
class EarlierWrongSkip:
    """An earlier staged Cashbook line skipped with the own-balances reason, as the import reads it back."""

    line: str
    """The `Outflow Import Row` it is."""
    batch: str
    transfer_id: str
    amount: Decimal
    added_on_date: date | None
    row_kind: str = ""
    """Its stored Type; blank on a line the earlier import staged (it stored none)."""


def old_rule_amount(raw) -> Decimal | None:
    """The amount the earlier import stored for this line when it differs from its money now: 0 for a refund or
    wallet credit (no Credit was read), else `None`."""
    return Decimal("0") if row_kind(raw) in CREDIT_ROW_KINDS else None


def claim_wrong_skips(
    rows: Iterable,
    wrong_skips: Sequence[EarlierWrongSkip],
    reopenable: Callable[[object], bool],
) -> dict[int, EarlierWrongSkip]:
    """`{id(row): the earlier line it re-opens}` for the parsed `rows` of a statement.

    `reopenable(row)` says whether the new rules, before any repeat test, make the row an open line (pairing may
    then make it a *Paired wallet refund*, which is still a re-open). A row the new rules skip claims nothing.
    """
    by_id: dict[str, list[EarlierWrongSkip]] = {}
    for skip in wrong_skips:
        by_id.setdefault(skip.transfer_id, []).append(skip)
    taken: set[str] = set()
    claims: dict[int, EarlierWrongSkip] = {}
    for raw in rows:
        kind = row_kind(raw)
        candidates = by_id.get(getattr(raw, "transfer_id", "") or "")
        if kind not in REOPENABLE_ROW_KINDS or not candidates or not reopenable(raw):
            continue
        amounts = {line_money(raw), old_rule_amount(raw)}
        for skip in candidates:
            if (
                skip.line not in taken
                and skip.row_kind in ("", kind)
                and skip.amount in amounts
                and dates_agree(skip.added_on_date, getattr(raw, "added_on_date", None))
            ):
                taken.add(skip.line)
                claims[id(raw)] = skip
                break
    return claims


def earlier_sightings(raw, already, claims: dict[int, EarlierWrongSkip]) -> tuple[PriorSighting, ...]:
    """The repeat walk's earlier sightings of `raw` (`repeats.split_repeats`) on a Cashbook statement.

    None for a line that re-opens an earlier copy (`claims`): it is not a repeat. A refund or wallet credit is also
    found by its earlier copy's amount 0 (`old_rule_amount`), so one whose old copy is not re-opened (skipped for
    another reason, or the new rules skip it too) is a repeat of that copy and is not staged a second time.
    """
    if id(raw) in claims:
        return ()
    transfer_id, when = getattr(raw, "transfer_id", "") or "", getattr(raw, "added_on_date", None)
    found = find_prior_sightings(already, transfer_id, line_money(raw), when)
    old_amount = old_rule_amount(raw)
    if found or old_amount is None:
        return found
    return find_prior_sightings(already, transfer_id, old_amount, when)
