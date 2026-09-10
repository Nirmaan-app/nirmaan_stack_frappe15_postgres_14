# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Tests for the partial-settlement eligibility gate.

The amounts are shaped after the case that motivated the slice: one approved payment covered by two
bank transfers, which is why every "eligible" fixture is a record STRICTLY larger than the transfer
by more than the settle window.

⚠️ THE SHARPEST TEST IN HERE IS `TestTheRankingNeverReachesTheMatcher`'s cousin at the bottom --
`test_nothing_in_the_matching_chain_imports_this`. The whole write safety of this feature is "the
+-Rs 5 settle window gates the write", and a partial is by definition outside that window. It is
allowed to exist only because a human opens the door on one specific row; the moment the matcher can
reach this module, that sentence stops being true and nothing else would notice.
"""

import unittest
from decimal import Decimal

from nirmaan_stack.services.outflow_import.amounts import AMOUNT_TOLERANCE
from nirmaan_stack.services.outflow_import import partial_settle
from nirmaan_stack.services.outflow_import.partial_settle import (
    INTENT_PART_PAYMENT,
    REFUSAL_NOT_APPROVED,
    REFUSAL_NOT_A_PAYMENT,
    REFUSAL_NOT_POSITIVE,
    REFUSAL_NOT_SHORT,
    REFUSAL_WITHIN_WINDOW,
    VALID_INTENTS,
    looks_like_tds,
    partial_eligibility,
)

PAYMENT = "Project Payments"


def eligible(record="500000", bank="200000", doctype=PAYMENT, status="Approved"):
    return partial_eligibility(record, bank, doctype, status)


class TestTheHappyShape(unittest.TestCase):
    def test_a_five_lakh_payment_covered_by_two_lakh_splits(self):
        verdict = eligible()
        self.assertTrue(verdict.eligible)
        self.assertEqual(verdict.refusal, "")
        self.assertEqual(verdict.keep, Decimal("200000"))
        self.assertEqual(verdict.remainder, Decimal("300000"))

    def test_the_halves_sum_to_the_record_exactly(self):
        """⚠️ THE INVARIANT `payment_split` EXISTS TO PROTECT, asserted before it is ever called.

        `services.finance.get_total_pending` derives "how much may still be requested against this
        PO" from these rows. A split that lost a rupee would widen that ceiling silently.
        """
        for record, bank in (
            ("500000", "200000"),
            ("18678.69", "12000.34"),
            ("100000.01", "99000"),
            ("7.50", "1.25"),
        ):
            with self.subTest(record=record, bank=bank):
                verdict = partial_eligibility(record, bank, PAYMENT, "Approved")
                self.assertTrue(verdict.eligible)
                self.assertEqual(verdict.keep + verdict.remainder, Decimal(record))

    def test_the_kept_amount_is_the_bank_figure_and_nothing_else(self):
        """⚠️ THERE IS NO ROUNDING HERE AND THERE MUST NEVER BE. The reviewer types no amount --
        the bank already decided it -- so the only correct kept value is the one that moved."""
        verdict = partial_eligibility("18678.69", "12000.34", PAYMENT, "Approved")
        self.assertEqual(verdict.keep, Decimal("12000.34"))

    def test_the_implied_percentage_describes_the_shortfall(self):
        verdict = partial_eligibility("500000", "490000", PAYMENT, "Approved")
        self.assertEqual(verdict.implied_pct, Decimal("2"))


class TestTheGate(unittest.TestCase):
    def test_an_expense_is_refused_by_name(self):
        """Ruling R6: neither expense doctype has split machinery, `split_from`, or PO terms."""
        for doctype in ("Project Expenses", "Non Project Expenses"):
            with self.subTest(doctype=doctype):
                verdict = eligible(doctype=doctype)
                self.assertFalse(verdict.eligible)
                self.assertEqual(verdict.refusal, REFUSAL_NOT_A_PAYMENT)

    def test_only_an_approved_payment_may_be_split(self):
        """⚠️ READ FROM `ledgers`, NEVER RESTATED. Two copies of the settleable-status map is a
        defect this feature has already shipped once."""
        for status in ("Requested", "CEO Pending", "Paid", "Rejected", ""):
            with self.subTest(status=status):
                verdict = eligible(status=status)
                self.assertFalse(verdict.eligible)
                self.assertEqual(verdict.refusal, REFUSAL_NOT_APPROVED)

    def test_an_overpayment_is_a_different_problem_and_is_refused(self):
        """More money left the bank than the record claims. Carving the record up to match it
        would partition a payment against money it never covered."""
        verdict = eligible(record="200000", bank="500000")
        self.assertFalse(verdict.eligible)
        self.assertEqual(verdict.refusal, REFUSAL_NOT_SHORT)

    def test_an_exact_match_is_refused_because_it_is_an_ordinary_settle(self):
        verdict = eligible(record="200000", bank="200000")
        self.assertFalse(verdict.eligible)
        self.assertEqual(verdict.refusal, REFUSAL_NOT_SHORT)

    def test_a_gap_inside_the_settle_window_is_refused(self):
        """The ordinary settle already handles this and rewrites the record to the bank's figure
        (slice X1). Splitting here would mint a sub-Rs 5 payment nobody will ever chase."""
        verdict = partial_eligibility("200005", "200000", PAYMENT, "Approved")
        self.assertFalse(verdict.eligible)
        self.assertEqual(verdict.refusal, REFUSAL_WITHIN_WINDOW)

    def test_the_window_boundary_is_exclusive_on_the_split_side(self):
        """⚠️ EXACTLY THE TOLERANCE BELONGS TO THE ORDINARY SETTLE, which is INCLUSIVE at its
        boundary (`amounts_match`). A split must start strictly beyond it, or both paths would
        claim the same gap and the reviewer would be offered a choice the server refuses."""
        window = AMOUNT_TOLERANCE
        at_boundary = partial_eligibility(Decimal("200000") + window, "200000", PAYMENT, "Approved")
        self.assertFalse(at_boundary.eligible)
        self.assertEqual(at_boundary.refusal, REFUSAL_WITHIN_WINDOW)

        just_beyond = partial_eligibility(
            Decimal("200000") + window + Decimal("0.01"), "200000", PAYMENT, "Approved"
        )
        self.assertTrue(just_beyond.eligible)

    def test_a_refund_cannot_be_partially_settled(self):
        """127 negative payments exist live -- a credit raised after a negative-rate amendment.
        Splitting one is meaningless from either direction."""
        for record, bank in (("-50000", "10000"), ("50000", "-10000"), ("0", "10000")):
            with self.subTest(record=record, bank=bank):
                verdict = partial_eligibility(record, bank, PAYMENT, "Approved")
                self.assertFalse(verdict.eligible)
                self.assertEqual(verdict.refusal, REFUSAL_NOT_POSITIVE)

    def test_every_refusal_names_itself(self):
        """⚠️ A BARE `False` WOULD LEAVE THREE CALLERS TO RE-DERIVE WHY -- the endpoint's guard, the
        screen's offer and this suite -- which is three chances to disagree about one rule."""
        for verdict in (
            eligible(doctype="Project Expenses"),
            eligible(status="Paid"),
            eligible(record="1", bank="500000"),
            partial_eligibility("200001", "200000", PAYMENT, "Approved"),
            eligible(record="-5"),
        ):
            self.assertFalse(verdict.eligible)
            self.assertTrue(verdict.refusal, "a refusal must say which one it is")

    def test_a_refusal_carries_no_amounts(self):
        """So a caller that ignores `eligible` cannot quietly split zero rupees."""
        verdict = eligible(status="Paid")
        self.assertEqual(verdict.keep, Decimal("0"))
        self.assertEqual(verdict.remainder, Decimal("0"))


class TestTheTdsHint(unittest.TestCase):
    def test_common_statutory_rates_are_flagged(self):
        for pct in ("1", "2", "5", "10", "2.00", "1.99", "10.04"):
            with self.subTest(pct=pct):
                self.assertTrue(looks_like_tds(pct))

    def test_an_ordinary_part_payment_fraction_is_not(self):
        for pct in ("40", "60", "33.33", "0", "3", "7.5", "15"):
            with self.subTest(pct=pct):
                self.assertFalse(looks_like_tds(pct))

    def test_it_is_computed_from_the_verdict_the_gate_produced(self):
        """The 2% shape end to end: Rs 5,00,000 approved, Rs 4,90,000 moved."""
        verdict = partial_eligibility("500000", "490000", PAYMENT, "Approved")
        self.assertTrue(verdict.eligible, "the shape permits a split")
        self.assertTrue(
            looks_like_tds(verdict.implied_pct),
            "and the reviewer is warned that it looks like a deduction",
        )

    def test_the_hint_does_not_gate_anything(self):
        """⚠️ THE LOAD-BEARING HALF. A TDS-shaped gap is still ELIGIBLE -- the reviewer may
        genuinely have made a 2% part payment. The hint asks them to look twice; wiring it to a
        refusal would convert a warning into a guess about money."""
        verdict = partial_eligibility("500000", "490000", PAYMENT, "Approved")
        self.assertTrue(verdict.eligible)
        self.assertEqual(verdict.refusal, "")


class TestTheIntentVocabulary(unittest.TestCase):
    def test_there_is_exactly_one_intent_and_it_is_not_a_default(self):
        """⚠️ THE ABSENCE OF A DEFAULT IS STILL THE PRODUCT. There is one legal value now, and the
        allowlist survives because it is what makes a missing or garbage intent THROW on a
        money-out endpoint -- not because there is a choice left to police."""
        self.assertEqual(VALID_INTENTS, {INTENT_PART_PAYMENT})
        self.assertNotIn("", VALID_INTENTS)
        self.assertNotIn(None, VALID_INTENTS)

    def test_the_deduction_answer_is_gone_and_this_pin_keeps_it_gone(self):
        """⚠️ INVERTED FROM THE OLD TWO-INTENT ASSERTION, NOT DELETED -- a deleted pin checks
        nothing. Slice TD let a reviewer record a shortfall as TDS from a statement; SR tax is now
        withheld ONCE, at approval, by `services/payment_tds.py`, which nets
        `Project Payments.amount`. A second mechanism here would withhold twice against an
        `amount_due` that already subtracts the first, with the OPPOSITE storage convention.

        This fails the moment any of that surface comes back.
        """
        self.assertNotIn("deduction", VALID_INTENTS)
        for name in (
            "INTENT_DEDUCTION",
            "deduction_eligibility",
            "DeductionEligibility",
            "SERVICE_DOCTYPE",
            "TDS_BAND_MIN_PCT",
            "TDS_BAND_MAX_PCT",
            "REFUSAL_NOT_SERVICE",
            "REFUSAL_RATE_OUT_OF_BAND",
        ):
            with self.subTest(name=name):
                self.assertFalse(
                    hasattr(partial_settle, name),
                    f"{name} is back; the import must not record tax",
                )


class TestTheMatcherCannotReachThis(unittest.TestCase):
    """⚠️ OWNER RULING R3, ENFORCED STRUCTURALLY RATHER THAN PROMISED.

    A partial settlement sits OUTSIDE the settle window that gates every other write in this
    feature. It is safe only because it cannot happen without a person opening it on one row. If any
    module in the matching chain could import this, "the window gates the write" would stop being
    true and no other test would go red.

    Modelled on `test_similarity`'s identical guard, and for the mirror-image reason: that one keeps
    a RANKING out of the matcher, this one keeps a WIDENING out of it.
    """

    CHAIN = ("matcher", "disambiguate", "status", "stacks", "claims", "candidates")

    def test_nothing_in_the_matching_chain_imports_this(self):
        import importlib
        import inspect

        for module_name in self.CHAIN:
            with self.subTest(module=module_name):
                module = importlib.import_module(
                    f"nirmaan_stack.services.outflow_import.{module_name}"
                )
                source = inspect.getsource(module)
                self.assertNotIn(
                    "partial_settle",
                    source,
                    f"{module_name} must not be able to widen what may be settled",
                )


if __name__ == "__main__":
    unittest.main()
