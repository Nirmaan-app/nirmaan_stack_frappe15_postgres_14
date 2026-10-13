# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The refund link rule (#1399): pure, no DB.

    devenv.sh unit nirmaan_stack.services.test_refund_links
"""

import unittest
from decimal import Decimal

from nirmaan_stack.services.refund_links import plan_refund_links


def D(value):
    return Decimal(str(value))


class PlanRefundLinksTests(unittest.TestCase):
    def test_a_refund_larger_than_the_balance_links_up_to_the_balance(self):
        # PO/005/00107/26-27: ₹28,886 refunded, ₹25,488 overpaid.
        plan = plan_refund_links(-25488, [("VRF-1", 28886)])
        self.assertEqual(plan.links, {"VRF-1": D("25488.00")})
        self.assertEqual(plan.over_balance, D("3398.00"))

    def test_a_refund_smaller_than_the_balance_links_whole(self):
        plan = plan_refund_links(-25488, [("VRF-1", 10000)])
        self.assertEqual(plan.links, {"VRF-1": D("10000.00")})
        self.assertEqual(plan.over_balance, D("0.00"))

    def test_refunds_settle_in_the_order_given(self):
        plan = plan_refund_links(-1500, [("old", 1000), ("new", 1000), ("newest", 300)])
        self.assertEqual(plan.links, {"old": D("1000.00"), "new": D("500.00")})
        self.assertEqual(plan.over_balance, D("800.00"))

    def test_no_negative_balance_links_nothing(self):
        for balance in (0, 250, None):
            plan = plan_refund_links(balance, [("VRF-1", 400)])
            self.assertEqual(plan.links, {})
            self.assertEqual(plan.over_balance, D("400.00"))

    def test_paise_are_kept(self):
        plan = plan_refund_links(-1000.52, [("VRF-1", 2000)])
        self.assertEqual(plan.links, {"VRF-1": D("1000.52")})
        self.assertEqual(plan.over_balance, D("999.48"))

    def test_no_refunds_no_links(self):
        plan = plan_refund_links(-500, [])
        self.assertEqual((plan.links, plan.over_balance), ({}, D("0.00")))
