# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for `amounts.py` -- when two amounts are the same money (slice V4a).

The rule is one constant and one comparison, which is exactly why it needs pinning: it governs
whether money moves, it is applied in four places, and it was WRONG in production for a day. Exact
matching found nothing on real data -- 31.4% of payments carry paise while the bank sends whole
rupees -- and the three approved payments in the owner's first import were 0.31, 0.68 and 0.90 away
from the transfers that paid them.
"""

import unittest
from decimal import Decimal

from nirmaan_stack.services.outflow_import.amounts import (
    AMOUNT_TOLERANCE,
    TIER1_TOLERANCE,
    amount_difference,
    amounts_match,
    to_decimal,
    tolerance_bounds,
)


class TestTheTolerance(unittest.TestCase):
    def test_the_settle_window_is_five_rupees(self):
        """Owner ruling 2026-08-07, widened from Re 1 when tier 2 arrived. This is the window that
        governs what may be WRITTEN, and therefore everything the screen may offer."""
        self.assertEqual(AMOUNT_TOLERANCE, Decimal("5"))

    def test_the_tier_one_window_is_one_rupee(self):
        """Re 1 is exactly the width of the phenomenon: rounding a paise amount to the whole rupee
        cannot move it a full one. Tier 1 keeps it because account + IFSC is a second strong axis."""
        self.assertEqual(TIER1_TOLERANCE, Decimal("1"))

    def test_the_tier_window_is_never_wider_than_the_settle_window(self):
        """⚠️ THE RELATION, NOT THE TWO NUMBERS. A tier wider than the settle window would let the
        matcher propose a record the confirm then refuses -- which is the one failure the whole
        single-owner discipline in this module exists to prevent. Tighten or widen either value and
        this still has to hold."""
        self.assertLessEqual(TIER1_TOLERANCE, AMOUNT_TOLERANCE)

    def test_the_three_real_cases_all_match_in_both_windows(self):
        """The measured failures that occasioned the rule. If any of these stops matching, the
        matcher has gone back to finding nothing on live data."""
        for bank, payment in (
            ("18679.00", "18678.69"),
            ("21925.00", "21924.10"),
            ("36963.00", "36962.32"),
        ):
            self.assertTrue(amounts_match(bank, payment), f"{bank} vs {payment}")
            # Sub-rupee rounding is what tier 1 is FOR, so the strict window has to cover it too --
            # otherwise the nearly-certain tier would be the one that finds nothing.
            self.assertTrue(
                amounts_match(bank, payment, TIER1_TOLERANCE), f"tier 1: {bank} vs {payment}"
            )

    def test_a_tds_deduction_never_matches_in_either_window(self):
        """⚠️ THE LOAD-BEARING NEGATIVE. TDS is thousands. If either window ever reached it, the
        import would settle a payment for materially less than it was approved for, silently.
        This is the deferred Q11 case and it must stay deferred."""
        self.assertFalse(amounts_match("98000", "100000"))
        self.assertFalse(amounts_match("701442", "715757"))
        self.assertFalse(amounts_match("98000", "100000", TIER1_TOLERANCE))

    def test_the_boundary_is_inclusive(self):
        """Stated so the rule can be said out loud without an exception: "within five rupees" means
        a difference of exactly five rupees counts."""
        self.assertTrue(amounts_match("5000", "4995"))
        self.assertTrue(amounts_match("4995", "5000"))

    def test_just_outside_does_not_match(self):
        self.assertFalse(amounts_match("5000", "4994.99"))

    def test_the_tier_one_window_refuses_what_the_settle_window_accepts(self):
        """The two windows have to be genuinely different or tier 1 is not a tier. A Rs 4 gap is
        settleable but is NOT evidence of a rounding, so tier 1 declines it and the row falls
        through to tier 2 -- where the project named in the remark has to corroborate it."""
        self.assertTrue(amounts_match("5000", "4996"))
        self.assertFalse(amounts_match("5000", "4996", TIER1_TOLERANCE))

    def test_it_is_symmetric(self):
        # A pool query compares one way and the settle guard the other; an asymmetric rule would
        # offer a record the confirm then refuses.
        self.assertEqual(amounts_match("100", "100.5"), amounts_match("100.5", "100"))
        self.assertEqual(amounts_match("100", "105"), amounts_match("105", "100"))

    def test_identical_amounts_match(self):
        self.assertTrue(amounts_match("5000", "5000"))
        self.assertTrue(amounts_match(Decimal("0"), Decimal("0")))


class TestDecimalCoercion(unittest.TestCase):
    def test_a_float_does_not_reintroduce_binary_error(self):
        """⚠️ `Decimal(0.1)` is 0.1000000000000000055511151231257827. Going through `str` is what
        keeps a paise comparison honest -- and paise is the entire subject of this module."""
        self.assertEqual(to_decimal(0.1), Decimal("0.1"))
        self.assertEqual(to_decimal(18678.69), Decimal("18678.69"))

    def test_it_reads_the_data_column_string_form(self):
        # `Project Expenses.amount` is a Data column holding bare numeric strings.
        self.assertEqual(to_decimal("2935"), Decimal("2935"))
        self.assertEqual(to_decimal("351.72"), Decimal("351.72"))

    def test_blank_and_none_are_zero_rather_than_an_exception(self):
        # These reach the comparison from a nullable column; raising would abort a settlement over
        # a missing figure instead of refusing it on the amount.
        self.assertEqual(to_decimal(None), Decimal("0"))
        self.assertEqual(to_decimal(""), Decimal("0"))
        self.assertEqual(to_decimal("not a number"), Decimal("0"))

    def test_the_difference_is_signed(self):
        self.assertEqual(amount_difference("18679", "18678.69"), Decimal("0.31"))
        self.assertEqual(amount_difference("18678.69", "18679"), Decimal("-0.31"))


class TestToleranceBounds(unittest.TestCase):
    def test_the_window_is_the_tolerance_either_side(self):
        low, high = tolerance_bounds("5000")
        self.assertEqual(low, Decimal("4995"))
        self.assertEqual(high, Decimal("5005"))

    def test_the_bounds_default_to_the_settle_window_not_the_tier_window(self):
        """⚠️ THE POOL MUST BE THE WIDER OF THE TWO. It is queried once and then filtered in memory
        by whichever tier is running; a pool built at the TIER window would hide every tier 2
        candidate before the matcher ever saw it."""
        self.assertEqual(tolerance_bounds("5000"), tolerance_bounds("5000", AMOUNT_TOLERANCE))

    def test_the_sql_bounds_agree_with_the_python_comparison(self):
        """⚠️ THE ONE THAT KEEPS THE FOUR CALL SITES HONEST. The SQL pool query cannot call
        `amounts_match` -- the comparison happens in the database -- so it takes these bounds
        instead. If the two ever disagreed, the pool would offer records the guard refuses, or hide
        records it would have accepted."""
        for bank in ("5000", "18679", "0.5", "999999.99"):
            low, high = tolerance_bounds(bank)
            for candidate in (low, high, low - Decimal("0.01"), high + Decimal("0.01"),
                              to_decimal(bank)):
                in_window = low <= candidate <= high
                self.assertEqual(
                    in_window,
                    amounts_match(candidate, bank),
                    f"SQL window and amounts_match disagree on {candidate} vs {bank}",
                )


class TestPurity(unittest.TestCase):
    def test_it_imports_neither_frappe_nor_anything_from_this_package(self):
        import inspect

        from nirmaan_stack.services.outflow_import import amounts

        for line in inspect.getsource(amounts).splitlines():
            stripped = line.strip()
            if stripped.startswith(("import ", "from ")):
                self.assertNotIn("frappe", stripped)
                self.assertNotIn("nirmaan_stack", stripped)


class TestThereIsExactlyOneCopyOfTheNumber(unittest.TestCase):
    def test_no_other_module_in_the_package_hardcodes_a_tolerance(self):
        """The number governs matching AND settling. A second copy would drift the moment the owner
        changed it -- and the symptom is a screen offering a record the confirm then refuses."""
        import pathlib

        package = pathlib.Path(
            inspect_dir := __file__
        ).parent
        offenders = []
        for path in package.glob("*.py"):
            if path.name in ("amounts.py", "test_amounts.py"):
                continue
            source = path.read_text()
            for marker in ("AMOUNT_TOLERANCE =", "TOLERANCE = Decimal"):
                if marker in source:
                    offenders.append(f"{path.name}: {marker}")
        self.assertEqual(offenders, [], f"tolerance redefined outside amounts.py: {offenders}")


if __name__ == "__main__":
    unittest.main()
