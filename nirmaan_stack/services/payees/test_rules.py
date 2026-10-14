# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Payee rules that need no database (spec #1420, ADR-0033). Run with `devenv.sh unit`."""

import json
import os
import unittest

from nirmaan_stack.services.payees.rules import (
    ACTIVE,
    INACTIVE,
    PAID_STATUSES,
    details_problem,
    duplicate_problem,
    inactive_pick_problem,
    locked_change_problem,
    parse_details,
    pick_problem,
    status_change_problem,
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


class TestLockedChangeProblem(unittest.TestCase):
    """A paid Payee's account number and IFSC never change; its holder name may (#1423)."""

    before = parse_details("Kaveri Ductfab", "50200061234567", "HDFC0000195")

    def test_a_new_account_number_or_ifsc_is_refused_and_says_why(self):
        for after in (parse_details("Kaveri Ductfab", "50200061234568", "HDFC0000195"),
                      parse_details("Kaveri Ductfab", "50200061234567", "HDFC0000196")):
            with self.subTest(after=after):
                problem = locked_change_problem("PYE-0412", self.before, after)
                self.assertIn("PYE-0412", problem)
                self.assertIn("locked", problem)
                self.assertIn("new payee", problem)

    def test_a_holder_name_fix_is_not_a_locked_change(self):
        after = parse_details("Kaveri Ductfab Systems Pvt. Ltd.", "5020 0061-234567", "hdfc0000195")
        self.assertIsNone(locked_change_problem("PYE-0412", self.before, after))


class TestStatusChangeProblem(unittest.TestCase):
    def test_active_and_inactive_swap_freely(self):
        self.assertIsNone(status_change_problem("PYE-1", ACTIVE, INACTIVE))
        self.assertIsNone(status_change_problem("PYE-1", INACTIVE, ACTIVE))

    def test_the_status_it_already_has_is_refused_naming_it(self):
        self.assertEqual(status_change_problem("PYE-1", INACTIVE, INACTIVE), "PYE-1 is already Inactive.")

    def test_an_unknown_status_is_refused(self):
        self.assertIn("Active or Inactive", status_change_problem("PYE-1", ACTIVE, "Closed"))


class TestInactivePickProblem(unittest.TestCase):
    def test_it_names_the_payee_and_what_to_do_instead(self):
        problem = inactive_pick_problem("PYE-0212")
        self.assertIn("PYE-0212 is Inactive", problem)
        self.assertIn("active payee", problem)


class TestPickProblem(unittest.TestCase):
    """One predicate for "can this Payee be newly picked": the screens' and every save's."""

    def test_an_active_payee_can_be_picked(self):
        self.assertIsNone(pick_problem("PYE-0212", ACTIVE))

    def test_an_inactive_payee_cannot(self):
        self.assertEqual(pick_problem("PYE-0212", INACTIVE), inactive_pick_problem("PYE-0212"))

    def test_a_payee_that_does_not_exist_cannot(self):
        self.assertIn("does not exist", pick_problem("PYE-9999", None))


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
