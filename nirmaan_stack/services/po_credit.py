"""How much overpaid credit a PO can actually SPEND — the D2 cap.

WHY A CAP EXISTS AT ALL

`PO Adjustments.remaining_impact` is the running total of a PO's adjustment ledger. A
negative value reads as "we overpaid this vendor, that money is ours to reuse", and three
separate places spend it: a revision increase consumes it, a push transfers it to another
PO, and the vendor-credit pool offers it across every PO of that vendor.

But the ledger is assembled purely from revision diffs and term movements. It never consults
what was actually PAID. So it can assert credit that does not exist:

    PO/246/00103/26-27 — total ₹20,650, amount_paid ₹0, zero payment records ever
                         ledger said: −₹4,130 of overpaid credit

Spending that would move money that never arrived. The revision-increase path came within
one code path of doing exactly that: had the credit reuse fired, the increase of ₹4,366
would have added a payment term of only ₹236, under-billing the vendor by ₹4,130 while the
adjustment read `Done`. A phantom liability is bad; a phantom liability silently converted
into a real payment shortfall is much worse.

The cap is the floor under all of it: you cannot spend more than you actually overpaid.

WHY IT READS THE STORED `amount_paid` AND MUST NOT RECOMPUTE IT

`_recalculate_amount_paid` sums `Project Payments` in status `Paid` ONLY. Payments sit in
`Approved` until a bank statement settles them, and that population moves in bulk — measured
on this site inside a single session, the count of POs where `amount_paid` disagrees with
`SUM(Paid)` read 585 at one point and 15 at another, while the stored `amount_paid` field
did not move at all. Recomputing here would make the cap swing with settlement timing and,
in the direction that matters, WIDEN it — letting back in exactly the phantom it exists to
stop. Read the stored field.

TOLERANCE

Measured against every credit-holding PO on this site: 6 of 7 agree to the paisa, and one
(PO/208/00058/25-26) is ₹0.52 apart from accumulated rounding. A cap that shaved that would
be a bug of its own, so a ledger within `CAP_TOLERANCE` of the real figure is taken as-is.
₹1 matches `PO_ADJUSTMENT_OPEN_CREDIT_THRESHOLD`, the usable-credit floor already in use.
It does not weaken the cap: the case it exists to stop was ₹4,130 against ₹0.

Pure by construction (ADR-0010 B1) — no `frappe.db`, no request context. The DB reads live in
`api/po_adjustments/_payment_utils.usable_po_credit`.
"""

CAP_TOLERANCE = 1.0


def _num(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def ledger_credit(remaining_impact) -> float:
    """The credit the adjustment ledger CLAIMS. Uncapped, and not to be spent directly."""
    return max(0.0, -_num(remaining_impact))


def real_overpayment(amount_paid, total_amount) -> float:
    """What was actually paid beyond the PO's value. The ceiling on any credit."""
    return max(0.0, _num(amount_paid) - _num(total_amount))


def usable_credit(remaining_impact, amount_paid, total_amount) -> float:
    """Overpaid credit this PO may actually spend.

    `min(ledger, real)`, except that a ledger within `CAP_TOLERANCE` of the real figure is
    honoured in full so accumulated rounding never shaves a legitimate balance.
    """
    claimed = ledger_credit(remaining_impact)
    real = real_overpayment(amount_paid, total_amount)
    if claimed <= real + CAP_TOLERANCE:
        return claimed
    return real
