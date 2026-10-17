# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Pure: when a Payment cheque's payments may be approved, and to what (#1480, spec #1477, ADR-0035).

One cheque is one decision: its payments are approved together, only once every line names a payment
and the lines add up to the cheque amount within ₹5, and the cheque amount picks L1 or the CEO.

No database. Run with `devenv.sh unit nirmaan_stack.services.cheques.test_approval_rules`.
"""

import unittest

from nirmaan_stack.services.cheques import approval_rules
from nirmaan_stack.services.cheques.approval_rules import ApprovalLine


def _line(payment, amount, record="PO/267/00103/26-27"):
    return ApprovalLine(payment=payment, record=record, amount=amount)


class TestApprovalNeedsEveryLineAndTheWholeAmount(unittest.TestCase):
    def problem(self, amount, *lines):
        return approval_rules.approval_problem(cheque_no="000751", amount=amount, lines=list(lines))

    def test_lines_naming_payments_that_add_up_may_be_approved(self):
        self.assertIsNone(self.problem(68400, _line("PAY-1", 28400), _line("PAY-2", 22000), _line("PAY-3", 18000)))

    def test_a_line_with_no_payment_yet_is_named(self):
        problem = self.problem(50000, _line("PAY-1", 20000), _line(None, 30000, record="PO/267/00115/26-27"))
        self.assertIn("Line 2 of cheque 000751 has no payment yet", problem)
        self.assertIn("PO/267/00115/26-27", problem)
        self.assertIn("₹30,000", problem)

    def test_lines_within_five_rupees_of_the_cheque_may_be_approved(self):
        self.assertIsNone(self.problem(50005, _line("PAY-1", 50000)))
        self.assertIsNone(self.problem(49995, _line("PAY-1", 50000)))

    def test_lines_more_than_five_rupees_off_are_refused_with_both_figures(self):
        problem = self.problem(50006, _line("PAY-1", 20000), _line("PAY-2", 30000))
        self.assertIn("₹50,000", problem)
        self.assertIn("₹50,006", problem)
        self.assertIn("within ₹5", problem)
        self.assertIsNotNone(self.problem(49994, _line("PAY-1", 50000)))

    def test_a_cheque_with_no_lines_is_refused(self):
        self.assertIn("no lines", self.problem(1000))

    def test_lakhs_are_grouped_the_indian_way(self):
        problem = self.problem(1250000, _line("PAY-1", 1000000))
        self.assertIn("₹12,50,000", problem)
        self.assertIn("₹10,00,000", problem)


class TestAllPaymentsAtOneStep(unittest.TestCase):
    def test_every_payment_at_the_step_passes(self):
        self.assertIsNone(approval_rules.decision_step_problem([("PAY-1", "Requested"), ("PAY-2", "Requested")], expected="Requested"))

    def test_a_payment_at_another_step_is_named_with_its_status(self):
        problem = approval_rules.decision_step_problem(
            [("PAY-1", "CEO Pending"), ("PAY-2", "Approved")], expected="CEO Pending"
        )
        self.assertIn("PAY-2", problem)
        self.assertIn("Approved", problem)
        self.assertIn("CEO Pending", problem)
        self.assertNotIn("PAY-1", problem)


class TestTheGuardOnALoneApproval(unittest.TestCase):
    """The payment's own save refuses an approval of one cheque payment that is not its cheque's."""

    def test_an_approval_is_a_move_out_of_a_waiting_step_into_the_next(self):
        self.assertTrue(approval_rules.is_approval("Requested", "CEO Pending"))
        self.assertTrue(approval_rules.is_approval("Requested", "Approved"))
        self.assertTrue(approval_rules.is_approval("CEO Pending", "Approved"))
        self.assertFalse(approval_rules.is_approval("Approved", "Reconciliation Pending"))
        self.assertFalse(approval_rules.is_approval("Reconciliation Pending", "Approved"))  # Revert to Approved
        self.assertFalse(approval_rules.is_approval("Paid", "Approved"))  # Unreconcile
        self.assertFalse(approval_rules.is_approval("Requested", "Rejected"))
        self.assertFalse(approval_rules.is_approval("Requested", "Requested"))
        self.assertFalse(approval_rules.is_approval(None, "Approved"))  # a new payment, born approved

    def test_approving_one_payment_of_three_is_refused(self):
        problem = approval_rules.lone_approval_problem(
            cheque_no="000751", payment_lines=3, deciding=False, from_status="Requested", to_status="CEO Pending",
            cheque_amount=68400,
        )
        self.assertIn("cheque 000751", problem)
        self.assertIn("all 3", problem)

    def test_the_cheque_decision_itself_passes(self):
        self.assertIsNone(approval_rules.lone_approval_problem(
            cheque_no="000751", payment_lines=3, deciding=True, from_status="Requested", to_status="CEO Pending",
            cheque_amount=68400,
        ))

    def test_a_one_line_cheque_may_be_approved_at_its_cheque_s_tier(self):
        self.assertIsNone(approval_rules.lone_approval_problem(
            cheque_no="000751", payment_lines=1, deciding=False, from_status="Requested", to_status="Approved",
            cheque_amount=20000,
        ))

    def test_skipping_the_ceo_a_cheque_amount_needs_is_refused(self):
        problem = approval_rules.lone_approval_problem(
            cheque_no="000751", payment_lines=1, deciding=False, from_status="Requested", to_status="Approved",
            cheque_amount=60000,
        )
        self.assertIn("CEO", problem)
        self.assertIn("₹60,000", problem)

    def test_a_ceo_approval_lands_at_approved(self):
        self.assertIsNone(approval_rules.lone_approval_problem(
            cheque_no="000751", payment_lines=1, deciding=False, from_status="CEO Pending", to_status="Approved",
            cheque_amount=60000,
        ))


if __name__ == "__main__":
    unittest.main()
