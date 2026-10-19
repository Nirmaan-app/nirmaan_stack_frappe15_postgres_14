# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The cashflow CEO Hold rule (`services/ceo_hold/rules`). Pure: no site, no DB."""

import unittest

from nirmaan_stack.services.ceo_hold.rules import over_cashflow_limit, watches_cashflow_gap


class TestTheCashflowHoldRule(unittest.TestCase):
    def test_a_project_with_a_positive_limit_is_watched_until_it_is_completed(self):
        self.assertTrue(watches_cashflow_gap("WIP", 5000))
        self.assertFalse(watches_cashflow_gap("Completed", 5000))
        self.assertFalse(watches_cashflow_gap("WIP", 0))
        self.assertFalse(watches_cashflow_gap("WIP", None))

    def test_a_watched_project_is_over_only_when_its_gap_exceeds_the_limit(self):
        self.assertTrue(over_cashflow_limit("WIP", 5000, 5000.01))
        self.assertFalse(over_cashflow_limit("WIP", 5000, 5000))
        self.assertFalse(over_cashflow_limit("WIP", 5000, 100))

    def test_an_unwatched_project_is_never_over(self):
        self.assertFalse(over_cashflow_limit("Completed", 5000, 99999))
        self.assertFalse(over_cashflow_limit("WIP", 0, 99999))
