# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""May this transfer pay PART of this approved payment? (Bulk Import Outflow, slice PS.)

PURE MODULE -- no `frappe`, no database, no request context. It imports `amounts` and `ledgers`,
both pure. Same shape and the same reason as `matcher.py` and `similarity.py`: the rule that decides
whether money may be split is worth being able to read, and test, without a bench.

THE PROBLEM IT SOLVES
---------------------
A vendor is approved ONE payment of Rs 5,00,000 and the bank pays it in two transfers of Rs 2,00,000
and Rs 3,00,000. Every transfer is `Mismatched`, and until PS neither could be resolved at all:
`settle_row` refuses the first with `AmountMismatchError` (the gap is far outside the settle window)
and there is nothing else on the screen to do.

⚠️ THE DEFERRED DESIGN WAS THE OTHER WAY ROUND, AND THIS REPLACES IT. The 2026-08-10 analysis
looked for N transfers that SUM to one record -- subset-sum, a group id on the row, and N bank
references crammed into a `varchar(140)`. Splitting the record first turns that into N ordinary
1-to-1 settlements, each of which `settle_payment` already handles unchanged. Two invariants survive
untouched as a result, and they are the strongest argument for the shape: `_enforce_single_claim`
("a record is claimed once") sees two records claimed by two transfers, and `Outflow Row Match`'s
unique `(transfer_id, target_doctype, target_name)` sees two different targets.

⚠️ THIS DECIDES ELIGIBILITY. IT DOES NOT DECIDE WHAT HAPPENED. Whether the shortfall is a part
payment or a deduction such as TDS is a question about the world that no data in this system can
answer -- see `looks_like_tds`. This module says only whether the SHAPE permits a split; a person
says that the balance is still owed, and `settle_row_partial` requires them to say so.

ONE ANSWER, AND IT USED TO BE TWO (slice TD, REMOVED)
----------------------------------------------------
    partial_eligibility  -> may we SPLIT this record and carry a balance forward?

⚠️ THERE WAS A SECOND ANSWER HERE AND IT IS GONE ON PURPOSE -- do not reinstate it. Slice TD let a
reviewer record a shortfall as TDS on a `Service Requests` payment, deriving `amount - bank` and
writing it to the legacy `Project Payments.tds` while leaving `amount` GROSS. SR tax withheld is now
recorded once, at APPROVAL, by `services/payment_tds.py`: it writes a `Payment TDS Deduction` row and
rewrites `Project Payments.amount` to the NET figure, so a transfer against an approved SR payment
matches `amount` outright and never reaches this module at all. Keeping both would have meant two
mechanisms with OPPOSITE conventions (net-stored here, gross-stored there) offering to withhold twice
on the same row, against an `amount_due` that already subtracts the first. **This import records no
tax.** Deduction settlements ever performed before the removal: zero.

⚠️ IT IS NEVER CONSULTED BY THE MATCHER, AND MUST NOT BECOME SO (owner ruling R3). The entire write
safety of this feature rests on "the +-Rs 5 settle window gates the write"; a partial is by
definition outside that window, so it exists only behind a human opening the door on one specific
row. `matcher.py`, `disambiguate.py` and `status.py` must not import this, directly or transitively.
A test pins the absence of that import.

WHY THE PAYMENT LEDGER ONLY (owner ruling R6)
---------------------------------------------
`Project Expenses` and `Non Project Expenses` have no split machinery, no `split_from` field, and no
PO payment terms to keep in step. Splitting one would mean inventing all three. Payments only, and
that is a scope fence rather than an oversight.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from nirmaan_stack.services.outflow_import.amounts import (
    AMOUNT_TOLERANCE,
    amount_difference,
    to_decimal,
)
from nirmaan_stack.services.outflow_import.ledgers import (
    PAYMENT_DOCTYPE,
    settleable_statuses,
)

__all__ = [
    "INTENT_PART_PAYMENT",
    "VALID_INTENTS",
    "TDS_RATE_HINTS",
    "Eligibility",
    "partial_eligibility",
    "looks_like_tds",
]


# ---------------------------------------------------------------------------------------------
# The reviewer's declaration
# ---------------------------------------------------------------------------------------------

# ⚠️ THE TWO CASES ARE INDISTINGUISHABLE IN THE DATA, WHICH IS WHY THIS VOCABULARY SURVIVES THE
# REMOVAL OF THE SECOND ANSWER. A Rs 5,00,000 payment against a Rs 4,50,000 transfer is EITHER a part
# payment (Rs 50,000 is still owed) OR a deduction such as TDS (nothing more is owed, Rs 50,000 was
# withheld). Nothing stored on the payment separates them -- so the reviewer still DECLARES that the
# balance is owed, even though a split is now the only thing this import can do about it.
#
# ⚠️ `Project Payments.tds` IS EMPTY ON AN APPROVED PAYMENT. That is an INVARIANT -- the owner's
# rule, 2026-08-12 -- and NOT a description of the table. Measured that day: 39 approved rows carry
# a TDS figure, every one of them RESIDUE from a fulfilment that was undone by a hand write outside
# the document lifecycle (33 have a `Version` row reading `Approved -> Paid` and no row for the way
# back; all 39 had their `utr` and `payment_date` cleared and their `tds` missed).
#
# THE CONSEQUENCE IS A RULE ABOUT THIS MODULE: **nothing here reads OR WRITES `tds`.** Once slice TD
# was removed the import stopped touching that column entirely; a signature that accepted a stored
# value would be designing for a state the business says cannot exist.
#
# Get the intent wrong in the PART PAYMENT direction and this feature creates an approved payment
# that will never be paid, inflating what the PO thinks it still owes, forever. That is worse than
# the dead end it replaces, which is why the intent is REQUIRED, never defaulted, and never inferred.
#
# ⚠️ ONE LEGAL VALUE IS NOT A REASON TO DROP THE PARAMETER. `VALID_INTENTS` is the allowlist that
# makes a missing or garbage intent THROW on a money-out endpoint; removing it would leave a door
# that accepts a bare "split this" with nothing to reject, and would strip the declaration that
# `_record_partial_provenance` writes onto both halves.
INTENT_PART_PAYMENT = "part_payment"
VALID_INTENTS = frozenset({INTENT_PART_PAYMENT})

# Statutory TDS rates common on this ledger, as PERCENTAGES of the record. Used ONLY to raise a
# warning beside the split the reviewer is about to take.
#
# ⚠️ A HINT, NEVER A RULE. A part payment can land on 2.00% by coincidence and a TDS deduction can
# land anywhere once more than one rate applies. This list exists so a reviewer about to create a
# phantom balance is asked to look twice -- it must never gate, default or pre-select anything.
#
# ⚠️ IT MATTERS MORE SINCE SLICE TD WAS REMOVED, NOT LESS. While a deduction was recordable here, a
# reviewer meeting a real withholding had somewhere to put it; now the only thing this import can do
# with a shortfall is SPLIT, and on a genuine deduction that mints an approved balance nobody owes.
# The warning is the whole guard, which is why it must stay loud -- and still must not gate.
TDS_RATE_HINTS = (Decimal("1"), Decimal("2"), Decimal("5"), Decimal("10"))

# How near a hint counts as near, in PERCENTAGE POINTS.
#
# ⚠️ DELIBERATELY NOT NAMED WITH THE WORD "tolerance", and
# `test_amounts.TestThereIsExactlyOneCopyOfTheNumber` is why: it fails any such constant bound to a
# Decimal outside `amounts.py`, because a second copy of the SETTLE WINDOW would drift and the
# symptom is a screen offering a record the confirm then refuses. This is not a money window at
# all -- it is how close a percentage has to sit to read as a statutory rate. The guard caught the
# ambiguous name, which is exactly what it is for. (It scans SOURCE TEXT, so the forbidden phrase
# must stay out of the comments too -- hence this paraphrase.)
TDS_HINT_NEARNESS_PCT = Decimal("0.05")


# ---------------------------------------------------------------------------------------------
# The verdict
# ---------------------------------------------------------------------------------------------

# Named refusals, so a caller can tell them apart WITHOUT matching on message text -- the same
# reason `settle.py` subclasses its errors rather than throwing one sentence for four causes.
REFUSAL_NOT_A_PAYMENT = "not_a_payment"
REFUSAL_NOT_APPROVED = "not_approved"
REFUSAL_NOT_SHORT = "not_short"
REFUSAL_WITHIN_WINDOW = "within_window"
REFUSAL_NOT_POSITIVE = "not_positive"


@dataclass(frozen=True)
class Eligibility:
    """Whether a partial settlement is permitted here, and what the two halves would be.

    ⚠️ `refusal` IS ALWAYS SET WHEN `eligible` IS FALSE. A bare `False` would leave every caller --
    the endpoint's guard, the screen's offer, and the test suite -- to re-derive WHY from the inputs,
    which is three chances to disagree about one rule.
    """

    eligible: bool
    refusal: str = ""

    keep: Decimal = Decimal("0")
    """What stays on the payment: the amount the bank actually moved."""

    remainder: Decimal = Decimal("0")
    """What is carried forward as a new approved payment."""

    implied_pct: Decimal = Decimal("0")
    """The shortfall as a percentage of the record, for the TDS warning only."""


def partial_eligibility(
    record_amount,
    bank_amount,
    target_doctype: str,
    record_status: str,
) -> Eligibility:
    """Whether this transfer may settle part of this record.

    THE GATE, AND EVERY CONDITION IS LOAD-BEARING:

    1. It is a `Project Payments` record (ruling R6 -- see the module docstring).
    2. Its status is settleable, i.e. `Approved`. Read from `ledgers`, never restated here: this
       feature has already shipped one defect from two copies of that map disagreeing.
    3. The record is STRICTLY LARGER than the transfer. The reverse -- more money left the bank than
       the record claims -- is an overpayment. It is a different problem with a different answer,
       and reading it as a split would carve up a record to match money it never covered.
    4. The gap EXCEEDS the settle window. Inside the window the ordinary settle already handles it
       and rewrites the record to the bank's figure (slice X1); offering a split there would mint a
       sub-Rs 5 payment nobody will ever chase.
    5. The record is positive. A refund travels this ledger as a negative payment -- 127 exist live
       -- and splitting one is meaningless.

    ⚠️ CONDITION 4 IS ALSO WHAT MAKES `payment_split`'s OWN FLOORS UNREACHABLE FROM HERE. That
    module refuses a remainder below `MIN_SPLIT_AMOUNT` (Re 1) and a record below twice it; a gap of
    more than Rs 5 satisfies both by arithmetic. The relation `AMOUNT_TOLERANCE >= MIN_SPLIT_AMOUNT`
    is pinned by a test at the api layer, which is the one place that may import both -- this module
    stays pure and therefore cannot see a `frappe`-importing service.
    """
    record = to_decimal(record_amount)
    bank = to_decimal(bank_amount)

    if (target_doctype or "").strip() != PAYMENT_DOCTYPE:
        return Eligibility(False, REFUSAL_NOT_A_PAYMENT)

    if (record_status or "").strip() not in settleable_statuses(PAYMENT_DOCTYPE):
        return Eligibility(False, REFUSAL_NOT_APPROVED)

    if record <= 0 or bank <= 0:
        return Eligibility(False, REFUSAL_NOT_POSITIVE)

    gap = amount_difference(record, bank)
    if gap <= 0:
        return Eligibility(False, REFUSAL_NOT_SHORT)

    if gap <= AMOUNT_TOLERANCE:
        return Eligibility(False, REFUSAL_WITHIN_WINDOW)

    return Eligibility(
        eligible=True,
        keep=bank,
        remainder=gap,
        implied_pct=(gap / record * Decimal("100")),
    )


def looks_like_tds(implied_pct) -> bool:
    """Whether the shortfall sits on a common statutory TDS rate.

    ⚠️ IT WARNS. IT NEVER DECIDES, AND NOTHING MAY MAKE IT DECIDE. The two cases this distinguishes
    are genuinely indistinguishable in the data (see `INTENT_PART_PAYMENT`), so this is a prompt to
    look twice, shown BESIDE the split on offer. Wiring it to a default, a pre-selection or a refusal
    would convert a hint into a guess about money -- and the wrong guess is the one that creates a
    payment nobody will ever pay.

    A FALSE here means only "not on a common rate". It is not evidence that this IS a part payment,
    which is why the screen offers the split either way and leaves the judgement with the reviewer.

    ⚠️ SINCE SLICE TD WAS REMOVED THIS IS THE ONLY THING WARNING A REVIEWER OFF A REAL DEDUCTION, so
    the surface reading it must say what to do instead -- record it in the payments screen -- rather
    than merely noting the coincidence. It stays advisory; the instruction lives in the wording.
    """
    pct = to_decimal(implied_pct)
    return any(abs(pct - hint) <= TDS_HINT_NEARNESS_PCT for hint in TDS_RATE_HINTS)
