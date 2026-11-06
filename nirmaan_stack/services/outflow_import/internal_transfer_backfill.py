# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Where a line skipped before spec #1619 goes now: an Internal Transfer, left as it is, or not placed (#1627). Pure.

The one-time patch `patches/v3_0/internal_transfers_from_old_skips` asks this of every Skipped line. It uses the
SAME table the imports use (`internal_transfers`), so an old line is placed exactly as a fresh import would place
it -- the bounced-top-up test, the Cashbook Types and the card auto-debit rule included. It never guesses: a line of
a moved kind that today's rules do not read as internal is UNPLACED, and the patch prints it with the reason.
"""

from __future__ import annotations

from dataclasses import dataclass

from nirmaan_stack.services.outflow_import.bank_exclusions import should_skip
from nirmaan_stack.services.outflow_import.card_credits import auto_debit_words
from nirmaan_stack.services.outflow_import.internal_transfers import (
    CARD_AUTO_DEBIT_RULE,
    CASHBOOK_BANK_TO_VA,
    CASHBOOK_INTERNAL_KINDS,
    CASHBOOK_VA_TO_WALLET,
    CASHBOOK_WALLET_TO_VA,
    TransferEnds,
    bank_line_transfer,
    card_auto_debit_transfer,
    cashbook_line_transfer,
)
from nirmaan_stack.services.outflow_import.skip_kinds import (
    SKIP_KIND_BY_EXCLUSION_CATEGORY,
    SKIP_KIND_CARD_PAYMENT,
    SKIP_KIND_CASHBOOK_INTERNAL,
    SKIP_KIND_FAILED_PAYMENT_RETURNED,
)

PLACED = "placed"
LEFT = "left"
UNPLACED = "unplaced"
#: A Cashbook move the wallet did not complete: re-filed as Bank refused, as the import skips it (owner decision 3).
REFUSED = "refused"

#: A Cashbook line staged before the statement's Type was stored is placed by its Txn Id (spec #1619).
CASHBOOK_KIND_BY_TXN_PREFIX = (
    ("VALOAD-", CASHBOOK_BANK_TO_VA),
    ("BUSINESS_USER-", CASHBOOK_VA_TO_WALLET),
    ("C2B-", CASHBOOK_WALLET_TO_VA),
)
CASHBOOK_REFUND_PREFIX = "REF-"

#: The bank-rule kinds every one of whose lines the rules now read as internal.
_BANK_KINDS_MOVED = frozenset(
    kind for kind in SKIP_KIND_BY_EXCLUSION_CATEGORY.values()
) - {SKIP_KIND_FAILED_PAYMENT_RETURNED, SKIP_KIND_BY_EXCLUSION_CATEGORY["bank_card_adjustment"]}


@dataclass(frozen=True)
class Placement:
    """`outcome` is PLACED (with `ends` and the `rule` its record names), LEFT (today's import keeps it skipped too),
    REFUSED (a Cashbook move that did not succeed: Bank refused) or UNPLACED (a moved kind the rules do not read as
    internal: a person checks it). `why` is for the print."""

    outcome: str
    ends: TransferEnds | None = None
    rule: str = ""
    why: str = ""


def place_old_skip(
    *,
    source: str,
    skip_kind: str,
    remarks: str = "",
    direction: str = "",
    transfer_id: str = "",
    row_kind: str = "",
    status_raw: str = "",
    added_by_raw: str = "",
    beneficiary_name: str = "",
) -> Placement:
    """Where one old Skipped line goes, as today's import would decide it."""
    kind = (skip_kind or "").strip()
    if kind == SKIP_KIND_CASHBOOK_INTERNAL:
        return _cashbook(transfer_id, row_kind, status_raw, added_by_raw, beneficiary_name)
    if kind == SKIP_KIND_CARD_PAYMENT:
        if auto_debit_words(remarks):
            # The old line kept no card heading, so its record names no card digits.
            return Placement(PLACED, card_auto_debit_transfer(""), CARD_AUTO_DEBIT_RULE)
        return Placement(LEFT, why="a card payment the statement does not say who paid")
    if kind in _BANK_KINDS_MOVED or kind == SKIP_KIND_FAILED_PAYMENT_RETURNED:
        return _bank(kind, remarks, direction)
    return Placement(LEFT, why=f"{kind or 'no'} skip type, not an internal move")


def _bank(kind: str, remarks: str, direction: str) -> Placement:
    out = (direction or "").strip() != "Credit"
    skip, category = should_skip(remarks, 1 if out else None, None if out else 1)
    ends = bank_line_transfer(category if skip else "", remarks)
    if kind == SKIP_KIND_FAILED_PAYMENT_RETURNED:
        if ends and category == "neft_return_failed":
            return Placement(PLACED, ends, category)
        return Placement(LEFT, why="a returned payment that names none of our wallets")
    if not skip:
        return Placement(UNPLACED, why=f"no rule reads this {kind} line today")
    if SKIP_KIND_BY_EXCLUSION_CATEGORY.get(category) != kind or ends is None:
        return Placement(UNPLACED, why=f"rule '{category}' reads it today, not the {kind} rule it was skipped by")
    return Placement(PLACED, ends, category)


def _cashbook(transfer_id: str, row_kind: str, status_raw: str, who_from: str, who_to: str) -> Placement:
    txn = (transfer_id or "").strip()
    if txn.startswith(CASHBOOK_REFUND_PREFIX):
        return Placement(LEFT, why="a Cashbook refund (REF-), never a transfer")
    kind = (row_kind or "").strip() or next(
        (named for prefix, named in CASHBOOK_KIND_BY_TXN_PREFIX if txn.startswith(prefix)), ""
    )
    ends = cashbook_line_transfer(kind, from_party=who_from, to_party=who_to)
    if ends is None:
        return Placement(UNPLACED, why=f"no Type, and its Txn Id ({txn[:14] or 'blank'}) names no Cashbook move")
    if (status_raw or "").strip().upper() != "SUCCESS":
        # As the import skips it (owner decision 3, #1619): no money moved, so it is Bank refused, with no record,
        # whatever an earlier line of the move said.
        return Placement(REFUSED, why="a Cashbook move the wallet says did not succeed")
    return Placement(PLACED, ends, CASHBOOK_INTERNAL_KINDS[kind])
