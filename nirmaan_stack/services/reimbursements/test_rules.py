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


class TestClaimFollowsExpense(unittest.TestCase):
    """ADR-0040: only the expense's endings move the claim, and only from the status it can be in."""

    def test_paid_and_rejected_move_an_approved_claim(self):
        from nirmaan_stack.services.reimbursements.expense_link import claim_status_for

        self.assertEqual(claim_status_for("Paid", "Reconciliation Pending", "Approved"), "Paid")
        self.assertEqual(claim_status_for("Paid", "Approved", "Approved"), "Paid")
        self.assertEqual(claim_status_for("Rejected", "CEO Pending", "Approved"), "Rejected")

    def test_the_waiting_statuses_leave_the_claim_approved(self):
        from nirmaan_stack.services.reimbursements.expense_link import claim_status_for

        for new, old in (("CEO Pending", None), ("Approved", "CEO Pending"), ("Reconciliation Pending", "Approved")):
            with self.subTest(new):
                self.assertIsNone(claim_status_for(new, old, "Approved"))

    def test_an_undone_match_puts_a_paid_claim_back(self):
        from nirmaan_stack.services.reimbursements.expense_link import claim_status_for

        self.assertEqual(claim_status_for("Reconciliation Pending", "Paid", "Paid"), "Approved")
        self.assertEqual(claim_status_for("Approved", "Paid", "Paid"), "Approved")

    def test_no_change_and_the_wrong_claim_status_do_nothing(self):
        from nirmaan_stack.services.reimbursements.expense_link import claim_status_for

        self.assertIsNone(claim_status_for("Paid", "Paid", "Approved"))
        self.assertIsNone(claim_status_for("Paid", "Approved", "Rejected"))
        self.assertIsNone(claim_status_for("Rejected", "CEO Pending", "Paid"))


class TestRejectedIsFinal(unittest.TestCase):
    def test_a_rejected_expense_cannot_move_to_any_other_status(self):
        from nirmaan_stack.services.reimbursements.expense_link import revival_problem

        for new in ("Requested", "CEO Pending", "Approved", "Reconciliation Pending", "Paid"):
            with self.subTest(new):
                self.assertIn("raise a new reimbursement", revival_problem("Rejected", new) or "")
        self.assertIsNone(revival_problem("Rejected", "Rejected"))
        self.assertIsNone(revival_problem("Approved", "Rejected"))
        self.assertIsNone(revival_problem("CEO Pending", "Approved"))


class TestReceiptsLink(unittest.TestCase):
    """Code review finding 7: a local-disk receipts path is never copied onto the expense."""

    def test_a_cloud_url_is_copied_and_a_local_path_is_not(self):
        from nirmaan_stack.services.reimbursements.convert import receipts_link

        cloud = "/api/method/frappe_gcp_attachment.controller.generate_file?key=attachments/x.pdf"
        self.assertEqual(receipts_link(cloud), cloud)
        for local in ("/private/files/REIMB-26-00001-receipts.pdf", "/files/r.pdf"):
            with self.subTest(local):
                self.assertIsNone(receipts_link(local))
        self.assertIsNone(receipts_link(None))
        self.assertIsNone(receipts_link(""))


class TestLinkProblem(unittest.TestCase):
    """Only the approval step sets `reimbursement`; it never changes; one expense per claim."""

    def test_rules(self):
        from nirmaan_stack.services.reimbursements.expense_link import link_problem

        self.assertIsNone(link_problem(True, None, None, False))                  # an ordinary expense
        self.assertIsNone(link_problem(True, None, "REIMB-1", True))              # the approval step
        self.assertIsNotNone(link_problem(True, None, "REIMB-1", False))           # typed in / duplicated
        self.assertIsNotNone(link_problem(True, None, "REIMB-1", True, "abc123")) # a second expense
        self.assertIsNone(link_problem(False, "REIMB-1", "REIMB-1", False))       # unchanged on edit
        self.assertIsNotNone(link_problem(False, "REIMB-1", "REIMB-2", False))    # changed
        self.assertIsNotNone(link_problem(False, "REIMB-1", None, False))         # removed
        self.assertIsNotNone(link_problem(False, None, "REIMB-1", False))         # added later


class TestDescribe(unittest.TestCase):
    def test_the_claim_in_one_line(self):
        from frappe import _dict

        from nirmaan_stack.services.reimbursements.convert import approver_note, describe, role_label

        claim = _dict(name="REIMB-26-00012", reimbursement_type="Travel", title=" Cab to site ",
                      description="Slab\ninspection   visit", claimant_name="A Person",
                      claimant_role="Nirmaan Project Manager Profile", owner="a@x.com")
        self.assertEqual(
            describe(claim),
            "Travel · Cab to site · Slab inspection visit · Claimant: A Person (Project Manager) · [REIMB-26-00012]",
        )
        self.assertEqual(role_label("Nirmaan HR Lead Profile"), "HR Lead")
        self.assertEqual(len(approver_note("x" * 300)), 140)


if __name__ == "__main__":
    unittest.main()
