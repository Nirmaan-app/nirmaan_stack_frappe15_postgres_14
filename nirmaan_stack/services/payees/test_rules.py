# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Payee rules that need no database (spec #1420, ADR-0033). Run with `devenv.sh unit`."""

import json
import os
import unittest

from nirmaan_stack.services.payees.rules import (
    PAID_STATUSES,
    details_problem,
    duplicate_problem,
    parse_details,
)
from nirmaan_stack.services.settlement import SETTLED_STATUSES


class TestParseDetails(unittest.TestCase):
    def test_account_number_is_kept_without_spaces_or_dashes(self):
        details = parse_details("  Kaveri Ductfab  Systems ", " 0050 2000-6123 4567 ", " hdfc0000195 ")
        self.assertEqual(details.account_name, "Kaveri Ductfab Systems")
        self.assertEqual(details.account_number, "0050200061234567")
        self.assertEqual(details.ifsc, "HDFC0000195")

    def test_leading_zeros_spaces_and_dashes_do_not_change_the_comparable_account(self):
        typed = [parse_details("A", n, "HDFC0000195").normalized_account for n in
                 ("0050200061234567", "50200061234567", "5020 0061-234567", "000 5020006 1234567")]
        self.assertEqual(set(typed), {"50200061234567"})

    def test_a_letter_in_the_account_number_is_upper_cased(self):
        self.assertEqual(parse_details("A", "be1212", "SBIN0003435").account_number, "BE1212")


class TestDetailsProblem(unittest.TestCase):
    def problem(self, name="Ramesh Kumar", number="36147100982211", ifsc="SBIN0003435"):
        return details_problem(parse_details(name, number, ifsc))

    def test_complete_details_have_no_problem(self):
        self.assertIsNone(self.problem())

    def test_each_field_is_required(self):
        self.assertIn("holder name", self.problem(name="  "))
        self.assertIn("account number", self.problem(number=" - "))
        self.assertIn("IFSC", self.problem(ifsc=""))

    def test_an_ifsc_must_look_like_one(self):
        self.assertIn("11 characters", self.problem(ifsc="SBIN003435"))
        self.assertIn("11 characters", self.problem(ifsc="SBIN1003435"))

    def test_an_account_number_holds_only_letters_and_digits(self):
        self.assertIn("letters and digits", self.problem(number="3614/7100"))

    def test_an_all_zero_account_number_is_refused(self):
        self.assertIn("account number", self.problem(number="0000"))


class TestDuplicateProblem(unittest.TestCase):
    def test_names_the_existing_payee_and_its_holder(self):
        message = duplicate_problem("PYE-0412", "Kaveri Ductfab Systems Pvt. Ltd.")
        self.assertIn("PYE-0412", message)
        self.assertIn("Kaveri Ductfab Systems Pvt. Ltd.", message)


if __name__ == "__main__":
    unittest.main()


class TestPaidMeansOneThing(unittest.TestCase):
    def test_paid_is_the_settled_set(self):
        self.assertEqual(PAID_STATUSES, SETTLED_STATUSES)
        self.assertEqual(set(PAID_STATUSES), {"Reconciliation Pending", "Paid"})


def load_shared_cases() -> dict:
    """`payee_rules_cases.json`: the cases the server's rules and the screens' twins both run (F1)."""
    with open(os.path.join(os.path.dirname(__file__), "payee_rules_cases.json")) as f:
        return json.load(f)


#: Shared with the frontend's `utils/payees/payeeForm.test.ts` (F1): one set of cases, two twins.
SHARED = load_shared_cases()


class TestSharedCases(unittest.TestCase):
    """The screens block early with these same verdicts and words (`utils/payees/payeeForm.ts`)."""

    def test_details(self):
        for case in SHARED["details"]:
            with self.subTest(case["name"]):
                details = parse_details(case["account_name"], case["account_number"], case["ifsc"])
                self.assertEqual(details_problem(details), case["problem"])

    def test_accounts(self):
        for case in SHARED["accounts"]:
            with self.subTest(case["typed"]):
                details = parse_details("A", case["typed"], "HDFC0000195")
                self.assertEqual((details.account_number, details.normalized_account),
                                 (case["clean"], case["normalized"]))
