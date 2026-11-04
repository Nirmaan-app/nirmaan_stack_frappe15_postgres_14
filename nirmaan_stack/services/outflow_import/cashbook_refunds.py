# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Cashbook refunds and wallet credits: their kinds, their sentences, and the pairing walk (#1594).

PURE MODULE, split out of `cashbook.py`, which calls it from `plan_statement` (spec #1585 "Planning (pure
module)", "Pairing rule"; ADR-0015 Amendment B decision 7). GLOSSARY: *Paired wallet refund*, *Unpaired wallet
refund*, *Wallet credit*.

A refund (Refund to Wallet, Credit Adjustment) names its spend as `REF-<Txn Id>`. It pairs with that spend only
when the spend is on the same statement and the refund's Credit equals the spend's Debit exactly; both lines are
then skipped, each naming the other. Any other refund, and every wallet credit, is an open line.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Callable, Sequence

from nirmaan_stack.services.outflow_import.amounts import rupees
from nirmaan_stack.services.outflow_import.repeats import KeptLine

# Kept beside the spends because a *Paired wallet refund* pairs a refund with one of them (#1594).
COLLECT_ROW_KIND = "Collect Payment"
# A refund names its spend as `REF-<Txn Id>` (ADR-0015 Amendment B decision 7). GLOSSARY: *Paired wallet refund*,
# *Unpaired wallet refund*.
REFUND_ROW_KINDS = frozenset({"Refund to Wallet", "Credit Adjustment"})
REFUND_PREFIX = "REF-"
# GLOSSARY: *Wallet credit* -- money paid into a wallet from outside the company.
WALLET_CREDIT_ROW_KIND = "Wallet Credit"
# The lines whose money is in the statement's `Credit` column (`RawRow.credit_amount`, #1590): money IN.
CREDIT_ROW_KINDS = REFUND_ROW_KINDS | {WALLET_CREDIT_ROW_KIND}
# A refund's own status: the wallet writes REFUNDED; SUCCESS is accepted as the same fact.
REFUND_MOVED_STATUSES = frozenset({"REFUNDED", "SUCCESS"})

# A *Paired wallet refund* (#1594): both lines skipped, each naming the other by its Txn Id.
SKIP_PAIRED_REFUND = (
    "Paired wallet refund: this refund gives back the whole of the spend {partner} on this statement. "
    "Neither line becomes a record."
)
SKIP_PAIRED_SPEND = (
    "Paired wallet refund: this spend is given back in full by the refund {partner} on this statement. "
    "Neither line becomes a record."
)
# What an open line says on the main table, as its note (#1594). Never a skip reason: the line is open.
OPEN_UNPAIRED_REFUND_PART = (
    "Unpaired wallet refund: gives back {refund} of the {spend_amount} spend {spend}. Decide what it is."
)
OPEN_UNPAIRED_REFUND_NOT_HERE = (
    "Unpaired wallet refund: its spend {spend} is not on this statement. Decide what it is."
)
OPEN_UNPAIRED_REFUND_NOT_PAIRED = (
    "Unpaired wallet refund: its spend {spend} is not recorded from this statement. Decide what it is."
)
OPEN_WALLET_CREDIT = "Wallet credit: money paid into the wallet from outside. Decide what it is."


def row_kind(raw) -> str:
    """The statement's `Type`, trimmed."""
    return (getattr(raw, "row_kind", "") or "").strip()


def line_money(raw) -> Decimal:
    """The line's money: its Credit on a refund or a wallet credit, else its Debit.

    ⚠️ IT IS ALSO THE AMOUNT IN THE LINE'S IDENTITY (`cashbook.plan_statement`), so an open line staged with its
    Credit as `amount` is found again by a re-upload. A refund or wallet credit staged before #1594 stored 0 and
    so is not found: the new statement stages it again under the new rules.
    """
    if row_kind(raw) in CREDIT_ROW_KINDS:
        return getattr(raw, "credit_amount", Decimal("0")) or Decimal("0")
    return getattr(raw, "amount", Decimal("0")) or Decimal("0")


def refunded_spend_id(transfer_id: str) -> str:
    """The Txn Id a refund names after `REF-`, or "" when it names none."""
    transfer_id = transfer_id or ""
    return transfer_id[len(REFUND_PREFIX):] if transfer_id.startswith(REFUND_PREFIX) else ""


def pair_refunds(
    kept: Sequence[KeptLine],
    opens: Sequence[bool],
    pairable: Callable[[KeptLine], bool],
) -> list[tuple[int, int]]:
    """`(refund position, spend position)` in `kept` for each *Paired wallet refund*.

    `opens[i]` says the plan would leave line `i` open; only an open refund looks for its spend. `pairable` says
    whether a line is a Wallet Spend or Collect Payment that, unpaired, nothing would skip but its kind. Only KEPT
    lines are candidates: an exact repeat of an earlier import already has its Expense, so its refund stays open.
    One spend pairs with one refund: the first, in file order.
    """
    taken: set[int] = set()
    pairs: list[tuple[int, int]] = []
    for at, line in enumerate(kept):
        if not opens[at] or row_kind(line.row) not in REFUND_ROW_KINDS:
            continue
        spend_id = refunded_spend_id(getattr(line.row, "transfer_id", ""))
        if not spend_id:
            continue
        for other_at, other in enumerate(kept):
            if (
                other_at not in taken
                and (getattr(other.row, "transfer_id", "") or "") == spend_id
                and line_money(other.row) == line_money(line.row)
                and pairable(other)
            ):
                taken.add(other_at)
                pairs.append((at, other_at))
                break
    return pairs


def unpaired_reason(transfer_id: str, amount: Decimal, rows: Sequence) -> str:
    """Why an open refund did not pair: part of a spend on this statement, a spend not on it, or a spend on it
    that this statement does not record (an exact repeat of an earlier import, a failed or skipped one).
    `rows` are every parsed line of the statement, repeats included."""
    spend_id = refunded_spend_id(transfer_id)
    spends = [raw for raw in rows if spend_id and (getattr(raw, "transfer_id", "") or "") == spend_id]
    if not spends:
        return OPEN_UNPAIRED_REFUND_NOT_HERE.format(spend=spend_id or "it names")
    other = next((raw for raw in spends if line_money(raw) != amount), None)
    if other is not None:
        return OPEN_UNPAIRED_REFUND_PART.format(
            refund=rupees(amount), spend_amount=rupees(line_money(other)), spend=spend_id
        )
    return OPEN_UNPAIRED_REFUND_NOT_PAIRED.format(spend=spend_id)
