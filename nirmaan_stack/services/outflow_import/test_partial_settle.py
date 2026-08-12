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
from nirmaan_stack.services.outflow_import.partial_settle import (
    INTENT_DEDUCTION,
    INTENT_PART_PAYMENT,
    REFUSAL_NOT_APPROVED,
    REFUSAL_NOT_A_PAYMENT,
    REFUSAL_NOT_POSITIVE,
    REFUSAL_NOT_SERVICE,
    REFUSAL_NOT_SHORT,
    REFUSAL_RATE_OUT_OF_BAND,
    REFUSAL_WITHIN_WINDOW,
    VALID_INTENTS,
    deduction_eligibility,
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
    def test_there_are_exactly_two_intents_and_neither_is_a_default(self):
        """⚠️ THE ABSENCE OF A DEFAULT IS THE PRODUCT. The two cases are indistinguishable in the
        data, so a default is the system guessing -- and the wrong guess creates an approved
        payment that will never be paid, inflating the PO's pending allocation forever."""
        self.assertEqual(VALID_INTENTS, {INTENT_PART_PAYMENT, INTENT_DEDUCTION})
        self.assertNotIn("", VALID_INTENTS)
        self.assertNotIn(None, VALID_INTENTS)


class TestTheDeductionGate(unittest.TestCase):
    """`deduction_eligibility` -- may this shortfall be recorded as TDS instead of split?

    The amounts are the shape the live ledger actually shows: a Service Request payment with a
    shortfall of exactly 1% or 2% of the record. Measured 2026-08-12 over 671 Paid payments carrying
    a TDS figure: 505 at exactly 1.00%, 60 at exactly 2.00%.
    """

    def _d(self, record="100000", bank="99000", doctype=PAYMENT, status="Approved",
           parent="Service Requests"):
        return deduction_eligibility(record, bank, doctype, status, parent)

    def test_a_one_percent_shortfall_on_a_service_payment_is_recordable(self):
        verdict = self._d()
        self.assertTrue(verdict.eligible)
        self.assertEqual(verdict.tds, Decimal("1000"))
        self.assertEqual(verdict.implied_pct, Decimal("1"))

    def test_a_two_percent_shortfall_is_recordable(self):
        verdict = self._d(record="200000", bank="196000")
        self.assertTrue(verdict.eligible)
        self.assertEqual(verdict.tds, Decimal("4000"))

    def test_the_tds_is_the_gap_and_the_two_reconcile_exactly(self):
        """⚠️ THE ARITHMETIC IS FORCED, WHICH IS WHY NO AMOUNT IS EVER TYPED. `bank = amount - tds`
        is the relation the whole ledger reads; deriving the figure is what keeps it true."""
        for record, bank in (("100000", "99000"), ("715757", "701441.86"), ("41050", "40639.5")):
            with self.subTest(record=record):
                verdict = self._d(record=record, bank=bank)
                self.assertTrue(verdict.eligible, f"{record}/{bank} should be in band")
                self.assertEqual(Decimal(record) - verdict.tds, Decimal(bank))

    def test_a_procurement_order_payment_is_refused(self):
        """Owner ruling T-R2. Measured cost: 5 of 584 in-band historical rows."""
        verdict = self._d(parent="Procurement Orders")
        self.assertFalse(verdict.eligible)
        self.assertEqual(verdict.refusal, REFUSAL_NOT_SERVICE)

    def test_a_missing_parent_doctype_is_refused_rather_than_assumed(self):
        for parent in ("", "   ", None):
            with self.subTest(parent=parent):
                verdict = self._d(parent=parent)
                self.assertFalse(verdict.eligible)
                self.assertEqual(verdict.refusal, REFUSAL_NOT_SERVICE)

    def test_a_rate_outside_the_band_is_refused(self):
        # 40% -- an ordinary part payment.
        self.assertEqual(self._d(record="100000", bank="60000").refusal, REFUSAL_RATE_OUT_OF_BAND)
        # 5% and 10% -- real TDS rates, but not recordable HERE (they go to the payments screen).
        self.assertEqual(self._d(record="100000", bank="95000").refusal, REFUSAL_RATE_OUT_OF_BAND)
        self.assertEqual(self._d(record="100000", bank="90000").refusal, REFUSAL_RATE_OUT_OF_BAND)
        # 0.1% -- the unexplained cluster of ~81 rows. It must never be auto-written as tax.
        self.assertEqual(self._d(record="100000", bank="99900").refusal, REFUSAL_RATE_OUT_OF_BAND)

    def test_the_band_edges_are_inclusive(self):
        self.assertTrue(self._d(record="100000", bank="99050").eligible)   # 0.95%
        self.assertTrue(self._d(record="100000", bank="97950").eligible)   # 2.05%
        self.assertFalse(self._d(record="100000", bank="99060").eligible)  # 0.94%
        self.assertFalse(self._d(record="100000", bank="97940").eligible)  # 2.06%

    def test_it_inherits_every_shape_refusal_rather_than_restating_them(self):
        """⚠️ ONE COPY OF THE SHARED HALF. If these ever start disagreeing with
        `partial_eligibility`, the dialog can offer one answer on a row the other refuses."""
        cases = (
            (dict(doctype="Project Expenses"), REFUSAL_NOT_A_PAYMENT),
            (dict(status="Paid"), REFUSAL_NOT_APPROVED),
            (dict(record="99000", bank="100000"), REFUSAL_NOT_SHORT),
            (dict(record="100002", bank="100000"), REFUSAL_WITHIN_WINDOW),
            (dict(record="-100000", bank="99000"), REFUSAL_NOT_POSITIVE),
        )
        for kwargs, expected in cases:
            with self.subTest(**kwargs):
                self.assertEqual(self._d(**kwargs).refusal, expected)

    def test_the_shape_is_checked_before_the_service_rule(self):
        """A Paid PO payment must report that it is Paid, not that it is a PO -- the reviewer can
        act on one of those and not the other."""
        verdict = self._d(status="Paid", parent="Procurement Orders")
        self.assertEqual(verdict.refusal, REFUSAL_NOT_APPROVED)

    def test_a_refusal_carries_no_figure(self):
        """So a caller that ignores `eligible` cannot write a zero TDS."""
        verdict = self._d(parent="Procurement Orders")
        self.assertEqual(verdict.tds, Decimal("0"))

    def test_it_reads_nothing_from_the_payment_itself(self):
        """⚠️ THE INVARIANT, ENFORCED AT THE SIGNATURE. `Project Payments.tds` is empty on an
        approved payment by rule, and the 39 rows that carry one are residue from an un-fulfil that
        bypassed the document lifecycle. A `stored_tds` parameter would design for a state the
        business says cannot exist -- so the function must not have one to accept.
        """
        import inspect

        params = set(inspect.signature(deduction_eligibility).parameters)
        self.assertEqual(
            params,
            {"record_amount", "bank_amount", "target_doctype", "record_status", "document_type"},
        )


class TestTheTwoTdsPredicatesAreDifferentQuestions(unittest.TestCase):
    """⚠️ `looks_like_tds` AND THE BAND MUST NOT BE MERGED.

    One asks "does this LOOK like a deduction?" and warns before a part payment is chosen. The other
    asks "may we RECORD it here?" and gates a button. They deliberately disagree at 5% and 10%,
    which are real TDS rates that this path does not write.
    """

    def test_five_and_ten_percent_warn_but_are_not_recordable(self):
        for bank, pct in (("95000", "5"), ("90000", "10")):
            with self.subTest(pct=pct):
                verdict = deduction_eligibility(
                    "100000", bank, PAYMENT, "Approved", "Service Requests"
                )
                self.assertTrue(looks_like_tds(pct), "it still LOOKS like a deduction")
                self.assertFalse(verdict.eligible, "but it is not written here")
                self.assertEqual(verdict.refusal, REFUSAL_RATE_OUT_OF_BAND)

    def test_one_and_two_percent_both_warn_and_are_recordable(self):
        for bank, pct in (("99000", "1"), ("98000", "2")):
            with self.subTest(pct=pct):
                self.assertTrue(looks_like_tds(pct))
                self.assertTrue(
                    deduction_eligibility(
                        "100000", bank, PAYMENT, "Approved", "Service Requests"
                    ).eligible
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
