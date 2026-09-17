# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for `wo_vendor_limit.py` -- the Rs 15 lakh per-vendor, per-financial-year WO cap.

Run:  bench --site localhost run-tests --module nirmaan_stack.services.test_wo_vendor_limit
"""

import unittest
from datetime import date

from nirmaan_stack.services.wo_vendor_limit import (
    WO_VENDOR_FY_LIMIT,
    exceeds_limit,
    financial_year_bounds,
)


class TestLimit(unittest.TestCase):
    def test_the_number_is_the_owners(self):
        self.assertEqual(WO_VENDOR_FY_LIMIT, 1_500_000.0)

    def test_exactly_the_limit_is_allowed(self):
        self.assertFalse(exceeds_limit(1_500_000))
        self.assertFalse(exceeds_limit(1_000_000, 500_000))

    def test_one_rupee_over_is_refused(self):
        self.assertTrue(exceeds_limit(1_500_001))
        self.assertTrue(exceeds_limit(1_000_000, 500_001))

    def test_the_new_wo_alone_can_push_over(self):
        self.assertFalse(exceeds_limit(1_400_000))
        self.assertTrue(exceeds_limit(1_400_000, 200_000))

    def test_blank_values_read_as_zero(self):
        self.assertFalse(exceeds_limit(None, None))


class TestFinancialYear(unittest.TestCase):
    def test_april_first_starts_the_year(self):
        self.assertEqual(financial_year_bounds(date(2026, 4, 1)), (date(2026, 4, 1), date(2027, 4, 1)))

    def test_march_belongs_to_the_previous_start_year(self):
        self.assertEqual(financial_year_bounds(date(2027, 3, 31)), (date(2026, 4, 1), date(2027, 4, 1)))

    def test_january_belongs_to_the_previous_start_year(self):
        self.assertEqual(financial_year_bounds(date(2026, 1, 15)), (date(2025, 4, 1), date(2026, 4, 1)))

    def test_mid_year(self):
        self.assertEqual(financial_year_bounds(date(2026, 9, 16)), (date(2026, 4, 1), date(2027, 4, 1)))


if __name__ == "__main__":
    unittest.main()
