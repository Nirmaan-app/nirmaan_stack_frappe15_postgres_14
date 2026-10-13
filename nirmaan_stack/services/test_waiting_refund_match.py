# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Which waiting Vendor Refunds one bank credit line may be matched to (#1401, ADR-0032).

Pure module -- no site, no DB.

The owner's rule (2026-10-13): the refunds chosen for one credit line must add up EXACTLY (to the paisa)
to the line. There is no partial allocation for credit lines. Every refund must still be waiting for its
bank line, and all of them must be one vendor's.
"""

import unittest

from nirmaan_stack.services.vendor_refunds import MATCHABLE_STATUSES, waiting_match_problem


def _refund(name="VRF-1", amount="1000.00", status="Reconciliation Pending", vendor="V-1"):
    return {"name": name, "amount": amount, "status": status, "vendor": vendor}


class TestMatchingALineToWaitingRefunds(unittest.TestCase):
    def test_one_waiting_refund_of_the_line_amount_matches(self):
        self.assertIsNone(waiting_match_problem([_refund()], "1000"))

    def test_a_split_across_several_waiting_refunds_matches_when_they_add_up_to_the_line(self):
        refunds = [_refund("VRF-1", "600.40"), _refund("VRF-2", "399.60")]
        self.assertIsNone(waiting_match_problem(refunds, "1000.00"))

    def test_refunds_short_of_the_line_do_not_match(self):
        problem = waiting_match_problem([_refund("VRF-1", "600")], "1000")
        self.assertIn("600.00", problem)
        self.assertIn("1000.00", problem)

    def test_refunds_more_than_the_line_do_not_match(self):
        refunds = [_refund("VRF-1", "600"), _refund("VRF-2", "400.01")]
        self.assertIn("1000.01", waiting_match_problem(refunds, "1000"))

    def test_nothing_chosen_does_not_match(self):
        self.assertIn("at least one", waiting_match_problem([], "1000"))

    def test_the_same_refund_twice_does_not_match(self):
        refunds = [_refund("VRF-1", "500"), _refund("VRF-1", "500")]
        self.assertIn("VRF-1 is chosen twice", waiting_match_problem(refunds, "1000"))

    def test_a_refund_that_is_not_waiting_does_not_match(self):
        for status in ("Received", "Cancelled"):
            with self.subTest(status=status):
                problem = waiting_match_problem([_refund(status=status)], "1000")
                self.assertIn(f"VRF-1 is {status}", problem)

    def test_refunds_of_two_vendors_do_not_match_one_line(self):
        refunds = [_refund("VRF-1", "500", vendor="V-1"), _refund("VRF-2", "500", vendor="V-2")]
        self.assertIn("different vendors", waiting_match_problem(refunds, "1000"))

    def test_only_a_waiting_refund_is_matchable(self):
        self.assertEqual(MATCHABLE_STATUSES, ("Reconciliation Pending",))
