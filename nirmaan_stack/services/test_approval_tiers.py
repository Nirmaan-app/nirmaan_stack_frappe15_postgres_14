# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for `approval_tiers.py` -- how many signatures an amount needs.

This rule decides whether money moves with two signatures, one, or none, and it REPLACES three
thresholds that currently disagree. It is one comparison chain, which is exactly why it needs
pinning: the edges are owner rulings that read as arbitrary, and the refund case is the kind of
thing a later reader "simplifies" into a loosening.

Run:  env/bin/python -m unittest nirmaan_stack.services.test_approval_tiers -v
"""

import unittest

from nirmaan_stack.services.approval_tiers import (
    TIER_L2_ABOVE_EXPENSES,
    STATUS_APPROVED,
    STATUS_CEO_PENDING,
    STATUS_REQUESTED,
    TIER_AUTO,
    TIER_AUTO_APPROVE_BELOW,
    TIER_L1,
    TIER_L1_L2,
    TIER_L2_ABOVE,
    initial_status,
    is_auto_approved,
    needs_ceo,
    required_tier,
    status_after_l1,
)


class TestThresholds(unittest.TestCase):
    def test_the_two_numbers_are_the_owners(self):
        self.assertEqual(TIER_AUTO_APPROVE_BELOW, 15000.0)
        self.assertEqual(TIER_L2_ABOVE, 50000.0)

    def test_the_bands_do_not_overlap_or_leave_a_gap(self):
        self.assertLess(TIER_AUTO_APPROVE_BELOW, TIER_L2_ABOVE)


class TestBands(unittest.TestCase):
    def test_well_inside_each_band(self):
        self.assertEqual(required_tier(1), TIER_AUTO)
        self.assertEqual(required_tier(9_999), TIER_AUTO)
        self.assertEqual(required_tier(50_000), TIER_L1)
        self.assertEqual(required_tier(1_00_000), TIER_L1_L2)

    def test_lower_edge_is_EXCLUSIVE(self):
        """"Below 15000" -- so 14,999.99 auto-approves and 15,000 exactly does NOT.

        ⚠️ This REVERSES the expense ruling of 2026-09-04, which made exactly the limit
        auto-approve (`<= 10000`). Anything written against "exactly the limit auto-approves"
        is stale.
        """
        self.assertEqual(required_tier(14_999.99), TIER_AUTO)
        self.assertEqual(required_tier(15_000), TIER_L1)
        self.assertEqual(required_tier(15_000.01), TIER_L1)

    def test_upper_edge_is_INCLUSIVE(self):
        """"15000 to 50000" is L1, "Above 50000" is L1+L2 -- so 50,000 exactly stops at L1."""
        self.assertEqual(required_tier(49_999.99), TIER_L1)
        self.assertEqual(required_tier(50_000), TIER_L1)
        self.assertEqual(required_tier(50_000.01), TIER_L1_L2)


class TestRefundsAndJunk(unittest.TestCase):
    def test_the_sign_ONLY_blocks_auto_approval(self):
        """Owner ruling 2026-09-15. A refund is never auto-approved, and is otherwise
        banded by its SIZE like any other amount -- which is precisely what the old
        `0 < amount` guard did on both ledgers before this module existed."""
        for amount in (-1, -500, -14_999, -50_000):
            with self.subTest(amount=amount):
                self.assertEqual(required_tier(amount), TIER_L1)
                self.assertFalse(is_auto_approved(amount))

    def test_a_LARGE_refund_still_needs_both_gates(self):
        """Banded by magnitude, so the CEO edge applies to a reversal too."""
        for amount in (-50_000.01, -60_000, -5_00_000):
            with self.subTest(amount=amount):
                self.assertEqual(required_tier(amount), TIER_L1_L2)

    def test_a_refund_is_NEVER_auto_approved(self):
        """The one property the sign carries. -Rs 500 is 'below 15,000' on a plain reading
        of the number, and must still not skip approval."""
        for amount in (-1, -500, -14_999, -60_000):
            with self.subTest(amount=amount):
                self.assertFalse(is_auto_approved(amount))

    def test_zero_is_not_auto_approved(self):
        self.assertEqual(required_tier(0), TIER_L1)
        self.assertFalse(is_auto_approved(0))

    def test_unreadable_amounts_are_not_auto_approved(self):
        """`_as_number` yields 0.0, so they land in the non-positive branch -- L1, and
        never auto. Not-auto is the property that matters; guessing a tier wrong costs a
        signature, guessing auto wrong lets money out unreviewed."""
        for amount in (None, "", "abc", "12,000", object()):
            with self.subTest(amount=amount):
                self.assertEqual(required_tier(amount), TIER_L1)
                self.assertFalse(is_auto_approved(amount))


class TestNumericStrings(unittest.TestCase):
    def test_a_numeric_STRING_is_banded_by_VALUE_not_by_characters(self):
        """⚠️ `Project Expenses.amount` is a `Data`/varchar column.

        A raw string compare puts "9000" above "50000" and would route a Rs 9,000 expense to
        the CEO. The coercion is what stops that.
        """
        self.assertEqual(required_tier("9000"), TIER_AUTO)
        self.assertEqual(required_tier("50000"), TIER_L1)
        self.assertEqual(required_tier("60000"), TIER_L1_L2)
        # The string and the number must agree, which is the whole point.
        self.assertEqual(required_tier("9000"), required_tier(9000))


class TestStatuses(unittest.TestCase):
    def test_initial_status_is_approved_only_for_the_auto_band(self):
        self.assertEqual(initial_status(5_000), STATUS_APPROVED)
        self.assertEqual(initial_status(15_000), STATUS_REQUESTED)
        self.assertEqual(initial_status(60_000), STATUS_REQUESTED)
        self.assertEqual(initial_status(-100), STATUS_REQUESTED)
        self.assertEqual(initial_status(-60_000), STATUS_REQUESTED)

    def test_L1_FINISHES_the_middle_band_and_FORWARDS_the_top(self):
        """The behaviour change for payments: ~912/yr stop reaching the CEO."""
        self.assertEqual(status_after_l1(15_000), STATUS_APPROVED)
        self.assertEqual(status_after_l1(50_000), STATUS_APPROVED)
        self.assertEqual(status_after_l1(50_000.01), STATUS_CEO_PENDING)
        # A small refund is FINISHED by L1; a large one still forwards.
        self.assertEqual(status_after_l1(-100), STATUS_APPROVED)
        self.assertEqual(status_after_l1(-60_000), STATUS_CEO_PENDING)

    def test_predicates_agree_with_required_tier(self):
        for amount in (-5, 0, 1, 14_999, 15_000, 50_000, 50_001, 9_99_999):
            with self.subTest(amount=amount):
                tier = required_tier(amount)
                self.assertEqual(is_auto_approved(amount), tier == TIER_AUTO)
                self.assertEqual(needs_ceo(amount), tier == TIER_L1_L2)


class TestPurity(unittest.TestCase):
    def test_module_imports_no_frappe(self):
        """It must stay callable from a plain unittest with no bench and no site."""
        import nirmaan_stack.services.approval_tiers as mod

        self.assertFalse(hasattr(mod, "frappe"))


if __name__ == "__main__":
    unittest.main()


class TestSharedCeoLine(unittest.TestCase):
    """All three ledgers band IDENTICALLY (owner, 16 Sep 2026).

    ⚠️ THIS CLASS INVERTS THE 15 Sep PINS, which asserted the CEO lines DIFFERED
    (payments 50,000, both expense ledgers 30,000). The band that moved is
    30,000-50,000: an expense there used to need the CEO and now FINISHES AT L1.
    The old assertions are kept in inverted form rather than deleted, so a silent
    revert to 30,000 fails here instead of passing unnoticed.

    The threshold stays a PARAMETER even though both values coincide -- that is
    what lets the lines part again without touching a call site.
    """

    def test_both_lines_are_50k_and_pinned(self):
        self.assertEqual(TIER_L2_ABOVE, 50000.0)
        self.assertEqual(TIER_L2_ABOVE_EXPENSES, 50000.0)
        self.assertEqual(TIER_L2_ABOVE, TIER_L2_ABOVE_EXPENSES)

    def test_40k_finishes_at_l1_on_every_ledger(self):
        """40,000 is the amount that MOVED -- it used to split the two ledgers."""
        self.assertEqual(required_tier(40_000), TIER_L1)
        self.assertEqual(required_tier(40_000, TIER_L2_ABOVE_EXPENSES), TIER_L1)
        self.assertEqual(status_after_l1(40_000), STATUS_APPROVED)
        self.assertEqual(
            status_after_l1(40_000, TIER_L2_ABOVE_EXPENSES), STATUS_APPROVED
        )

    def test_60k_still_needs_the_ceo_on_every_ledger(self):
        for l2_above in (TIER_L2_ABOVE, TIER_L2_ABOVE_EXPENSES):
            self.assertEqual(required_tier(60_000, l2_above), TIER_L1_L2)
            self.assertEqual(status_after_l1(60_000, l2_above), STATUS_CEO_PENDING)

    def test_the_auto_band_is_identical_on_both(self):
        for amount in (0.01, 1, 14_999, 14_999.99):
            self.assertEqual(required_tier(amount), TIER_AUTO)
            self.assertEqual(required_tier(amount, TIER_L2_ABOVE_EXPENSES), TIER_AUTO)


class TestRaiserLevel(unittest.TestCase):
    """A step the raiser already holds is not asked again (owner, 2026-09-21)."""

    def test_the_owners_table(self):
        from nirmaan_stack.services.approval_tiers import RAISER_CEO, RAISER_L1, initial_status_for_raiser

        cases = [
            # amount, level,      expected
            (5_000, None, "Approved"), (5_000, RAISER_L1, "Approved"), (5_000, RAISER_CEO, "Approved"),
            (30_000, None, "Requested"), (30_000, RAISER_L1, "Approved"), (30_000, RAISER_CEO, "Approved"),
            (80_000, None, "Requested"), (80_000, RAISER_L1, "CEO Pending"), (80_000, RAISER_CEO, "Approved"),
        ]
        for amount, level, expected in cases:
            with self.subTest(amount=amount, level=level):
                self.assertEqual(initial_status_for_raiser(amount, 50000.0, level), expected)

    def test_no_level_is_exactly_initial_status(self):
        from nirmaan_stack.services.approval_tiers import initial_status, initial_status_for_raiser

        for amount in (-60_000, -5, 0, 5_000, 15_000, 50_000, 50_001, "9000", None):
            with self.subTest(amount=amount):
                self.assertEqual(initial_status_for_raiser(amount, 50000.0, None), initial_status(amount, 50000.0))

    def test_which_steps_the_raiser_stands_in_for(self):
        from nirmaan_stack.services.approval_tiers import RAISER_CEO, RAISER_L1, steps_cleared_by_raiser

        self.assertEqual(steps_cleared_by_raiser(5_000, 50000.0, RAISER_CEO), (False, False))  # auto: no one
        self.assertEqual(steps_cleared_by_raiser(30_000, 50000.0, None), (False, False))
        self.assertEqual(steps_cleared_by_raiser(30_000, 50000.0, RAISER_L1), (True, False))
        self.assertEqual(steps_cleared_by_raiser(30_000, 50000.0, RAISER_CEO), (True, False))  # no CEO step existed
        self.assertEqual(steps_cleared_by_raiser(80_000, 50000.0, RAISER_L1), (True, False))
        self.assertEqual(steps_cleared_by_raiser(80_000, 50000.0, RAISER_CEO), (True, True))

    def test_an_unknown_level_changes_nothing(self):
        from nirmaan_stack.services.approval_tiers import initial_status_for_raiser, steps_cleared_by_raiser

        self.assertEqual(initial_status_for_raiser(80_000, 50000.0, "accountant"), "Requested")
        self.assertEqual(steps_cleared_by_raiser(80_000, 50000.0, "accountant"), (False, False))
