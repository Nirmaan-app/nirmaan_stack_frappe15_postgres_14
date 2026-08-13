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
answer -- see `looks_like_tds`. This module says only whether the SHAPE permits each answer; a person
says which one is true, and `settle_row_partial` requires them to say so.

TWO ANSWERS, ONE SHARED SHAPE (slice TD)
----------------------------------------
    partial_eligibility    -> may we SPLIT this record and carry a balance forward?
    deduction_eligibility  -> may we record the shortfall as TDS and settle in full?

The second LAYERS ON the first: the shape conditions are the same for both, and only the two extra
conditions (a Service Request parent, a 0.95-2.05% rate) belong to the deduction. Keeping one copy
of the shared half is what stops the two branches disagreeing about the same row.

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
    "INTENT_DEDUCTION",
    "VALID_INTENTS",
    "TDS_RATE_HINTS",
    "TDS_BAND_MIN_PCT",
    "TDS_BAND_MAX_PCT",
    "SERVICE_DOCTYPE",
    "Eligibility",
    "DeductionEligibility",
    "partial_eligibility",
    "deduction_eligibility",
    "looks_like_tds",
]


# ---------------------------------------------------------------------------------------------
# The reviewer's declaration
# ---------------------------------------------------------------------------------------------

# ⚠️ THE TWO CASES ARE INDISTINGUISHABLE IN THE DATA, WHICH IS WHY THIS VOCABULARY EXISTS.
# A Rs 5,00,000 payment against a Rs 4,50,000 transfer is EITHER a part payment (Rs 50,000 is still
# owed) OR a deduction such as TDS (nothing more is owed, Rs 50,000 was withheld). Nothing stored on
# the payment separates them, so a person declares which it is.
#
# ⚠️ `Project Payments.tds` IS EMPTY ON AN APPROVED PAYMENT. That is an INVARIANT -- the owner's
# rule, 2026-08-12 -- and NOT a description of the table. Measured that day: 39 approved rows carry
# a TDS figure, every one of them RESIDUE from a fulfilment that was undone by a hand write outside
# the document lifecycle (33 have a `Version` row reading `Approved -> Paid` and no row for the way
# back; all 39 had their `utr` and `payment_date` cleared and their `tds` missed).
#
# THE CONSEQUENCE IS A RULE ABOUT THIS MODULE: **nothing here reads `tds`.** It is an OUTPUT of the
# deduction path and never an input. A signature that accepted a stored value would be designing for
# a state the business says cannot exist, and would enshrine those 39 rows as if they were records.
#
# Get the intent wrong in the PART PAYMENT direction and this feature creates an approved payment
# that will never be paid, inflating what the PO thinks it still owes, forever. That is worse than
# the dead end it replaces, which is why the intent is REQUIRED, never defaulted, and never inferred.
INTENT_PART_PAYMENT = "part_payment"
INTENT_DEDUCTION = "deduction"
VALID_INTENTS = frozenset({INTENT_PART_PAYMENT, INTENT_DEDUCTION})

# Statutory TDS rates common on this ledger, as PERCENTAGES of the record. Used ONLY to raise a
# warning beside the reviewer's choice.
#
# ⚠️ A HINT, NEVER A RULE. A part payment can land on 2.00% by coincidence and a TDS deduction can
# land anywhere once more than one rate applies. This list exists so a reviewer about to create a
# phantom balance is asked to look twice -- it must never gate, default or pre-select anything.
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


# ---------------------------------------------------------------------------------------------
# The deduction path -- writing the TDS instead of routing it away (slice TD)
# ---------------------------------------------------------------------------------------------

# The ledger a deduction may be recorded on. Owner ruling T-R2, 2026-08-12.
#
# ⚠️ THIS IS THE PAYMENT'S PARENT (`Project Payments.document_type`), NOT THE LEDGER IT LIVES IN.
# `target_doctype` is "Project Payments"; THIS is "Service Requests" or "Procurement Orders". Two
# similarly-named things one argument apart -- gate on the wrong one and every ledger passes.
SERVICE_DOCTYPE = "Service Requests"

# The rate band a shortfall must fall in to be recordable as TDS here. Owner ruling T-R1.
#
# MEASURED ON THE LIVE LEDGER, 2026-08-12: of 671 Paid payments carrying a TDS figure, **505 sit at
# exactly 1.00% and 60 at exactly 2.00%**; this band captures 584 of them. Widening it to 0.5-2.5%
# admits TWO more rows, which is why it is tight -- and tightness keeps out a separate cluster of
# ~81 rows near 0.1% whose nature is unexplained and which must never be auto-written as tax.
#
# ⚠️ TDS IS COMPUTED ON `amount` DIRECTLY, NOT ON A PRE-GST BASE. I checked, because the opposite
# would have mattered enormously: dividing by 1.18 turns those clean 1.00 / 2.00 figures into
# 1.18 / 2.36, and a band built on that assumption would have missed almost every real deduction
# while every test stayed green.
TDS_BAND_MIN_PCT = Decimal("0.95")
TDS_BAND_MAX_PCT = Decimal("2.05")

REFUSAL_NOT_SERVICE = "not_service"
REFUSAL_RATE_OUT_OF_BAND = "rate_out_of_band"


@dataclass(frozen=True)
class DeductionEligibility:
    """Whether this shortfall may be recorded as TDS here, and what the figure would be."""

    eligible: bool
    refusal: str = ""

    tds: Decimal = Decimal("0")
    """The deduction to write. ALWAYS `record - bank`; never read from the payment."""

    implied_pct: Decimal = Decimal("0")


def deduction_eligibility(
    record_amount,
    bank_amount,
    target_doctype: str,
    record_status: str,
    document_type: str,
) -> DeductionEligibility:
    """Whether this transfer's shortfall may be written onto the payment as TDS.

    ⚠️ IT LAYERS ON `partial_eligibility` RATHER THAN REPEATING IT. The SHAPE conditions are
    identical for both answers to the dialog's question -- a Project Payment, `Approved`, the record
    strictly larger, the gap beyond the settle window, both amounts positive -- and a second copy is
    exactly how the two branches come to disagree about the same row. This adds TWO conditions to
    that shared answer and nothing else.

    ⚠️ THERE IS NO `stored_tds` PARAMETER AND THERE MUST NEVER BE ONE. `Project Payments.tds` is
    empty on an approved payment by rule; the rows that carry one are residue from an un-fulfil that
    bypassed the document lifecycle (see the note above `INTENT_PART_PAYMENT`). Accepting the stored
    value would design for a state the business says cannot exist, and refusing on it would block
    16% of the approved population for a reason invisible on the screen where the decision is made.
    **The figure is derived from the transfer, every time.** `Project Payments` carries
    `track_changes: 1`, so replacing residue is audited with its user and timestamp -- more of a
    trail than the hand write that created it ever left.

    ⚠️ IT IS NARROWER THAN `looks_like_tds`, ON PURPOSE. That predicate asks "does this LOOK like a
    deduction?" (1 / 2 / 5 / 10%) and warns a reviewer before they choose a part payment. This one
    asks "may we RECORD that deduction here?". A 5% gap therefore still warns and still cannot be
    written, and the screen says so -- which is more useful than either silence or a live button
    that refuses.
    """
    shape = partial_eligibility(record_amount, bank_amount, target_doctype, record_status)
    if not shape.eligible:
        return DeductionEligibility(False, shape.refusal)

    if (document_type or "").strip() != SERVICE_DOCTYPE:
        return DeductionEligibility(False, REFUSAL_NOT_SERVICE)

    if not (TDS_BAND_MIN_PCT <= shape.implied_pct <= TDS_BAND_MAX_PCT):
        return DeductionEligibility(False, REFUSAL_RATE_OUT_OF_BAND)

    # `shape.remainder` IS the gap, which IS the deduction. Taken from the shared computation rather
    # than recomputed, so the two branches can never differ about the same subtraction.
    return DeductionEligibility(
        eligible=True, tds=shape.remainder, implied_pct=shape.implied_pct
    )


def looks_like_tds(implied_pct) -> bool:
    """Whether the shortfall sits on a common statutory TDS rate.

    ⚠️ IT WARNS. IT NEVER DECIDES, AND NOTHING MAY MAKE IT DECIDE. The two cases this distinguishes
    are genuinely indistinguishable in the data (see `INTENT_PART_PAYMENT`), so this is a prompt to
    look twice, shown BESIDE the reviewer's choice. Wiring it to a default, a pre-selection or a
    refusal would convert a hint into a guess about money -- and the wrong guess is the one that
    creates a payment nobody will ever pay.

    A FALSE here means only "not on a common rate". It is not evidence that this IS a part payment,
    which is why the screen asks the question either way.
    """
    pct = to_decimal(implied_pct)
    return any(abs(pct - hint) <= TDS_HINT_NEARNESS_PCT for hint in TDS_RATE_HINTS)
