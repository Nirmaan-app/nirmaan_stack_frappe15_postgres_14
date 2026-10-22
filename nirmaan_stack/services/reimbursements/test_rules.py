# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Reimbursement rules that need no database. The cases are shared with the frontend twin (F1)."""

import json
import os
import unittest

from nirmaan_stack.services.reimbursements.receipts import is_mergeable
from nirmaan_stack.services.reimbursements.rules import (
    DESCRIPTION_REQUIRED_ABOVE,
    HR_APPROVAL_LIMIT,
    STATUSES,
    TYPES,
    claim_problem,
    decide_problem,
    delete_problem,
    description_required,
    edit_problem,
    rejection_problem,
    reviewer_for,
)

with open(os.path.join(os.path.dirname(__file__), "reimbursement_rules_cases.json")) as f:
    CASES = json.load(f)


class TestSharedCases(unittest.TestCase):
    def test_the_limit_and_statuses_match_the_cases(self):
        self.assertEqual(HR_APPROVAL_LIMIT, CASES["hr_approval_limit"])
        self.assertEqual(DESCRIPTION_REQUIRED_ABOVE, CASES["description_required_above"])
        self.assertEqual(list(STATUSES), CASES["statuses"])
        self.assertEqual(list(TYPES), CASES["types"])

    def test_description_required(self):
        for case in CASES["description_required"]:
            with self.subTest(case["name"]):
                self.assertEqual(description_required(case["amount"]), case["required"])

    def test_reviewer(self):
        for case in CASES["reviewer"]:
            with self.subTest(case["name"]):
                self.assertEqual(reviewer_for(case["amount"], claimant_is_hr=case["claimant_is_hr"]), case["reviewer"])

    def test_decide(self):
        for case in CASES["decide"]:
            with self.subTest(case["name"]):
                problem = decide_problem(
                    case["status"], case["amount"], claimant_is_hr=case["claimant_is_hr"],
                    decider_is_admin=case["decider_is_admin"], decider_is_hr=case["decider_is_hr"],
                )
                self.assertEqual(problem is None, case["allowed"], problem)

    def test_mergeable(self):
        for case in CASES["mergeable"]:
            with self.subTest(case["file_name"]):
                self.assertEqual(is_mergeable(case["file_name"]), case["mergeable"])

    def test_edit(self):
        for case in CASES["edit"]:
            with self.subTest(case["name"]):
                problem = edit_problem(case["status"], is_claimant=case["is_claimant"])
                self.assertEqual(problem is None, case["allowed"], problem)

    def test_delete(self):
        for case in CASES["delete"]:
            with self.subTest(case["name"]):
                problem = delete_problem(case["status"], is_claimant=case["is_claimant"])
                self.assertEqual(problem is None, case["allowed"], problem)


class TestRefusalsSayWhy(unittest.TestCase):
    def test_hr_above_the_limit_is_told_admin_decides(self):
        problem = decide_problem("Pending Approval", 2500, claimant_is_hr=False,
                                 decider_is_admin=False, decider_is_hr=True) or ""
        self.assertIn("Admin", problem)
        self.assertIn("2,000", problem)

    def test_a_decided_claim_names_its_status(self):
        self.assertIn("Approved", edit_problem("Approved", is_claimant=True) or "")
        self.assertIn("Approved", delete_problem("Approved", is_claimant=True) or "")


T = "Travel"


class TestClaimProblem(unittest.TestCase):
    def test_a_claim_needs_one_of_the_three_types(self):
        for kind in (None, "", "Hotel", "travel"):
            with self.subTest(kind):
                self.assertIn("type", claim_problem("Cab", 100, 1, reimbursement_type=kind) or "")
        for kind in ("Travel", "Food", "Others"):
            with self.subTest(kind):
                self.assertIsNone(claim_problem("Cab", 100, 1, reimbursement_type=kind))

    def test_a_complete_claim_has_no_problem(self):
        self.assertIsNone(claim_problem("Cab to site", 1450, 1, reimbursement_type=T))

    def test_a_blank_title_is_refused(self):
        self.assertEqual(claim_problem("   ", 1450, 1, reimbursement_type=T), "Enter a title.")

    def test_zero_negative_and_non_numbers_are_refused(self):
        for amount in (0, -10, "abc", None):
            with self.subTest(amount):
                self.assertIsNotNone(claim_problem("Cab", amount, 1, reimbursement_type=T))

    def test_a_claim_above_2000_needs_a_description(self):
        self.assertIn("description", claim_problem("Flight", 2000.01, 1, reimbursement_type=T) or "")
        self.assertIn("description", claim_problem("Flight", 9000, 1, "   ", T) or "")
        self.assertIsNone(claim_problem("Flight", 9000, 1, "Client visit, Pune", T))
        self.assertIsNone(claim_problem("Cab", 2000, 1, reimbursement_type=T))

    def test_a_claim_needs_a_receipt(self):
        self.assertEqual(claim_problem("Cab", 100, 0, reimbursement_type=T), "Attach at least one receipt.")

    def test_a_rejection_needs_a_reason(self):
        self.assertIsNotNone(rejection_problem("  "))
        self.assertIsNone(rejection_problem("Receipt unreadable"))


if __name__ == "__main__":
    unittest.main()
