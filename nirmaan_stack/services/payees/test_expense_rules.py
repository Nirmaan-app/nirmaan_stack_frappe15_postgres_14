# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Expense payee rules (spec #1420 ticket #1429, ADR-0033). Run with `devenv.sh unit`."""

import unittest

from nirmaan_stack.services.payees.expense_rules import (
    NOT_ASKED,
    OPTIONAL,
    PAYEE_RULES,
    REQUIRED,
    VENDOR_PAYEE_INACTIVE_PROBLEM,
    follow_vendor,
    paid_expense_problem,
    request_payee,
    vendor_payee_problem,
)
from nirmaan_stack.services.payees.test_rules import load_shared_cases

TYPE = "Labour Advance"


def verdict(rule, payee=None, vendor=None, vendor_payee=None):
    return request_payee(rule, expense_type=TYPE, payee=payee, vendor=vendor, vendor_payee=vendor_payee)


class TestRequestPayee(unittest.TestCase):
    def test_required_with_no_payee_is_refused_naming_the_type(self):
        v = verdict(REQUIRED)
        self.assertIsNone(v.payee)
        self.assertIn(TYPE, v.problem)

    def test_required_with_a_payee_keeps_it(self):
        self.assertEqual(verdict(REQUIRED, payee="PYE-0001"), (("PYE-0001", None)))

    def test_optional_may_be_left_blank(self):
        self.assertEqual(verdict(OPTIONAL), (None, None))

    def test_not_asked_ignores_a_payee_sent(self):
        self.assertEqual(verdict(NOT_ASKED, payee="PYE-0001"), (None, None))

    def test_a_blank_rule_is_not_asked(self):
        self.assertEqual(verdict(None, payee="PYE-0001"), (None, None))

    def test_a_vendor_fills_in_its_own_payee(self):
        self.assertEqual(verdict(OPTIONAL, vendor="VEN-1", vendor_payee="PYE-0007"), ("PYE-0007", None))
        self.assertEqual(verdict(REQUIRED, vendor="VEN-1", vendor_payee="PYE-0007"), ("PYE-0007", None))

    def test_the_vendors_own_payee_sent_back_is_accepted(self):
        self.assertEqual(
            verdict(REQUIRED, payee="PYE-0007", vendor="VEN-1", vendor_payee="PYE-0007"), ("PYE-0007", None)
        )

    def test_a_payee_other_than_the_vendors_is_refused(self):
        v = verdict(OPTIONAL, payee="PYE-0001", vendor="VEN-1", vendor_payee="PYE-0007")
        self.assertIsNone(v.payee)
        self.assertIn("PYE-0007", v.problem)
        self.assertIn("Others (No Vendor)", v.problem)

    def test_a_payee_on_a_vendor_with_no_bank_account_is_refused(self):
        v = verdict(OPTIONAL, payee="PYE-0001", vendor="VEN-1")
        self.assertIn("VEN-1", v.problem)

    def test_required_with_a_vendor_that_has_no_bank_account_is_refused(self):
        v = verdict(REQUIRED, vendor="VEN-1")
        self.assertIn("VEN-1", v.problem)

    def test_optional_with_a_vendor_that_has_no_bank_account_has_no_payee(self):
        self.assertEqual(verdict(OPTIONAL, vendor="VEN-1"), (None, None))

    def test_not_asked_with_a_vendor_carries_the_vendors_payee(self):
        """The raiser isn't asked, but the accountant must see who to pay: the vendor's account."""
        self.assertEqual(verdict(NOT_ASKED, vendor="VEN-1", vendor_payee="PYE-0007"), ("PYE-0007", None))

    def test_not_asked_with_a_vendor_still_ignores_a_payee_sent(self):
        self.assertEqual(verdict(NOT_ASKED, payee="PYE-0001", vendor="VEN-1", vendor_payee="PYE-0007"),
                         ("PYE-0007", None))
        self.assertEqual(verdict(NOT_ASKED, payee="PYE-0001", vendor="VEN-1"), (None, None))


class TestFollowVendor(unittest.TestCase):
    """A record naming a vendor (an Expense Request, a Project Expense) is paid into its Payee."""

    def test_a_blank_payee_is_filled_in_from_the_vendor(self):
        self.assertEqual(follow_vendor(vendor="VEN-1", payee=None, vendor_payee="PYE-0007"), ("PYE-0007", None))

    def test_the_vendors_own_payee_is_kept(self):
        self.assertEqual(follow_vendor(vendor="VEN-1", payee="PYE-0007", vendor_payee="PYE-0007"),
                         ("PYE-0007", None))

    def test_another_payee_is_refused(self):
        v = follow_vendor(vendor="VEN-1", payee="PYE-0001", vendor_payee="PYE-0007")
        self.assertIsNone(v.payee)
        self.assertIn("VEN-1 is paid into payee PYE-0007", v.problem)

    def test_a_vendor_with_no_payee_takes_none(self):
        self.assertEqual(follow_vendor(vendor="VEN-1", payee=None, vendor_payee=None), (None, None))
        self.assertIn("no bank account", follow_vendor(vendor="VEN-1", payee="PYE-0001", vendor_payee=None).problem)


class TestPaidExpenseProblem(unittest.TestCase):
    def test_an_expense_keeps_its_payee_once_money_has_left_approved(self):
        for status in ("Reconciliation Pending", "Paid"):
            with self.subTest(status=status):
                self.assertIn("already paid", paid_expense_problem("NPE-1", status))

    def test_before_that_it_can_change(self):
        for status in ("Requested", "CEO Pending", "Approved"):
            with self.subTest(status=status):
                self.assertIsNone(paid_expense_problem("NPE-1", status))


#: Shared with the frontend's `utils/payees/expensePayee.test.ts` (F1): one set of cases, two twins.
SHARED = load_shared_cases()


class TestVendorPayeeProblem(unittest.TestCase):
    def test_a_vendor_whose_payee_is_inactive_is_refused(self):
        self.assertEqual(vendor_payee_problem("Inactive"), VENDOR_PAYEE_INACTIVE_PROBLEM)

    def test_an_active_payee_or_none_is_not_this_rules_call(self):
        self.assertIsNone(vendor_payee_problem("Active"))
        self.assertIsNone(vendor_payee_problem(None))


class TestSharedCases(unittest.TestCase):
    """The request dialog blocks sending exactly when the server would refuse
    (`utils/payees/expensePayee.whoGetsPaidProblem`)."""

    def test_the_rules_are_the_ones_the_screens_offer(self):
        self.assertEqual(list(PAYEE_RULES), SHARED["payee_rules"])

    def test_the_inactive_vendor_payee_refusal_is_worded_as_the_screens_say_it(self):
        self.assertEqual(VENDOR_PAYEE_INACTIVE_PROBLEM, SHARED["vendor_payee_inactive_problem"])

    def test_requests(self):
        for case in SHARED["requests"]:
            with self.subTest(case["name"]):
                v = verdict(case["rule"], payee=case["payee"], vendor=case["vendor"],
                            vendor_payee=case["vendor_payee"])
                self.assertEqual(v.problem is not None, case["refused"])
