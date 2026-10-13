# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""How much of each Received Vendor Refund settles a PO Adjustment's negative balance (#1399, ADR-0032).

Pure by ADR-0010 B1: no frappe. The DB side, which reads the ledger and the refunds and writes the
ledger entries, is `api/po_adjustments/refund_links.sync_po_refund_links`.

THE RULE. The balance to settle is the ledger's sum WITHOUT its own refund links (`base_balance`):
the revision impacts, absorbs, transfers, write-offs and old-style entries. Only a negative base is
overpaid money; a zero or positive one takes nothing. The PO's Received refunds settle it in the
order given (oldest first), each up to what is still unsettled, so the links cover the negative
balance and no more. What the refunds hold beyond that is `over_balance`: the PO shows it as a
warning ("Refund is ₹X more than overpaid. Revise the PO?"), because the money arrived before a
revision explains it.

Recomputed from source every time, never adjusted by a delta, so the same inputs give the same
links however many times it runs.
"""

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

_PAISA = Decimal("0.01")


def _money(value) -> Decimal:
    try:
        return Decimal(str(value or 0)).quantize(_PAISA, rounding=ROUND_HALF_UP)
    except ArithmeticError:
        return Decimal("0.00")


@dataclass(frozen=True)
class RefundLinks:
    #: refund name -> the part of it that settles the balance, in the order the refunds were given.
    links: dict = field(default_factory=dict)
    #: What the Received refunds hold beyond the negative balance (≥ 0).
    over_balance: Decimal = Decimal("0.00")

    @property
    def linked(self) -> Decimal:
        return sum(self.links.values(), Decimal("0.00"))


def plan_refund_links(base_balance, refunds) -> RefundLinks:
    """The links that settle `base_balance` from `refunds`, a sequence of `(name, amount)` pairs.

    `base_balance` is the ledger's sum without its refund links (negative = overpaid).
    """
    unsettled = max(-_money(base_balance), Decimal("0.00"))
    links: dict = {}
    received = Decimal("0.00")
    for name, amount in refunds:
        amount = max(_money(amount), Decimal("0.00"))
        received += amount
        take = min(amount, unsettled)
        if take > 0:
            links[name] = take
            unsettled -= take
    linked = sum(links.values(), Decimal("0.00"))
    return RefundLinks(links=links, over_balance=received - linked)
