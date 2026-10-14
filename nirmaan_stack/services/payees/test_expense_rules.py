# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Expense payee rules (spec #1420 ticket #1429, ADR-0033). Run with `devenv.sh unit`."""

import unittest

from nirmaan_stack.services.payees.expense_rules import (
    NOT_ASKED,
    OPTIONAL,
    REQUIRED,
    paid_expense_problem,
    request_payee,
)

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

    def test_not_asked_ignores_the_vendor_too(self):
        self.assertEqual(verdict(NOT_ASKED, payee="PYE-0001", vendor="VEN-1", vendor_payee="PYE-0007"), (None, None))


class TestPaidExpenseProblem(unittest.TestCase):
    def test_an_expense_keeps_its_payee_once_money_has_left_approved(self):
        for status in ("Reconciliation Pending", "Paid"):
            with self.subTest(status=status):
                self.assertIn("already paid", paid_expense_problem("NPE-1", status))

    def test_before_that_it_can_change(self):
        for status in ("Requested", "CEO Pending", "Approved"):
            with self.subTest(status=status):
                self.assertIsNone(paid_expense_problem("NPE-1", status))
