# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for `settlement.py` -- what counts as money that has left the bank.

The defect this guards against is SILENT: miss one of the ~36 sites and the system under-reports
money it has already spent, with nothing on screen looking wrong. These tests pin the two
properties that make the audit safe -- the settled set contains BOTH statuses, and it does not
overlap the pending set.

Run:  env/bin/python -m unittest nirmaan_stack.services.test_settlement -v
"""

import unittest

from nirmaan_stack.services.settlement import (
    PENDING_STATUSES,
    SETTLED_STATUSES,
    STATUS_APPROVED,
    STATUS_CEO_PENDING,
    STATUS_PAID,
    STATUS_RECONCILIATION_PENDING,
    STATUS_REJECTED,
    STATUS_REQUESTED,
    STATUS_SEQUENCE,
    any_settled,
    is_pending,
    is_settled,
    is_settlement_transition,
    settled_filter,
    status_label,
)


class TestTheSettledSet(unittest.TestCase):
    def test_BOTH_statuses_are_settled(self):
        """The whole point. `Paid` alone was the old, now-wrong answer."""
        self.assertTrue(is_settled(STATUS_RECONCILIATION_PENDING))
        self.assertTrue(is_settled(STATUS_PAID))
        self.assertEqual(len(SETTLED_STATUSES), 2)

    def test_nothing_before_the_money_moves_is_settled(self):
        for status in (STATUS_REQUESTED, STATUS_CEO_PENDING, STATUS_APPROVED, STATUS_REJECTED):
            with self.subTest(status=status):
                self.assertFalse(is_settled(status))

    def test_blank_and_unknown_are_not_settled(self):
        for status in (None, "", "   ", "Scheduled", "Created"):
            with self.subTest(status=status):
                self.assertFalse(is_settled(status))

    def test_whitespace_is_tolerated(self):
        """`Project Payments.status` is a free-text `Data` field."""
        self.assertTrue(is_settled("  Paid  "))
        self.assertTrue(is_settled(" Reconciliation Pending"))


class TestTheTwoSetsDoNotOverlap(unittest.TestCase):
    def test_settled_and_pending_are_DISJOINT(self):
        """⚠️ If `Reconciliation Pending` ever joins `get_total_pending`, that money is counted
        twice -- once as paid and once as outstanding."""
        self.assertEqual(set(SETTLED_STATUSES) & set(PENDING_STATUSES), set())

    def test_reconciliation_pending_is_NOT_pending(self):
        self.assertFalse(is_pending(STATUS_RECONCILIATION_PENDING))

    def test_pending_set_matches_finance_get_total_pending(self):
        self.assertEqual(
            set(PENDING_STATUSES),
            {STATUS_REQUESTED, STATUS_CEO_PENDING, STATUS_APPROVED, STATUS_REJECTED},
        )


class TestTransitions(unittest.TestCase):
    def test_the_money_out_event_is_approved_to_reconciliation_pending(self):
        self.assertTrue(is_settlement_transition(STATUS_APPROVED, STATUS_RECONCILIATION_PENDING))

    def test_reconciling_moves_NO_money_and_must_not_retrigger(self):
        """⚠️ `Reconciliation Pending -> Paid` is a bookkeeping confirmation. Re-running
        `amount_paid` or the CEO-hold gap on it would recompute for no reason; worse, a hook
        written as "became Paid" would fire HERE and not at the real money-out event."""
        self.assertFalse(is_settlement_transition(STATUS_RECONCILIATION_PENDING, STATUS_PAID))

    def test_moving_BACK_off_settled_is_also_a_transition(self):
        """A settled row reverting has to LOWER the parent's paid total."""
        self.assertTrue(is_settlement_transition(STATUS_PAID, STATUS_REJECTED))
        self.assertTrue(is_settlement_transition(STATUS_RECONCILIATION_PENDING, STATUS_APPROVED))

    def test_approvals_are_not_settlement_transitions(self):
        self.assertFalse(is_settlement_transition(STATUS_REQUESTED, STATUS_CEO_PENDING))
        self.assertFalse(is_settlement_transition(STATUS_CEO_PENDING, STATUS_APPROVED))

    def test_a_new_record_created_directly_settled(self):
        """The PO-adjustment path mints rows straight at `Paid`."""
        self.assertTrue(is_settlement_transition(None, STATUS_PAID))


class TestHelpers(unittest.TestCase):
    def test_settled_filter_shape(self):
        self.assertEqual(
            settled_filter(),
            ["status", "in", [STATUS_RECONCILIATION_PENDING, STATUS_PAID]],
        )
        self.assertEqual(settled_filter("payment_status")[0], "payment_status")

    def test_labels_are_the_owners_words(self):
        self.assertEqual(status_label(STATUS_REQUESTED), "Payment Pending Approval")
        self.assertEqual(status_label(STATUS_CEO_PENDING), "Payment Pending CEO Approval")
        self.assertEqual(status_label(STATUS_APPROVED), "Payment need to paid")
        self.assertEqual(
            status_label(STATUS_RECONCILIATION_PENDING), "Payment Done / Reconciliation Pending"
        )
        self.assertEqual(status_label(STATUS_PAID), "Payment Done / Reconciliation Done")

    def test_unknown_label_passes_through_rather_than_blanking(self):
        self.assertEqual(status_label("Scheduled"), "Scheduled")
        self.assertEqual(status_label(None), "")

    def test_sequence_is_the_lifecycle_in_order(self):
        self.assertEqual(
            STATUS_SEQUENCE,
            (
                STATUS_REQUESTED,
                STATUS_CEO_PENDING,
                STATUS_APPROVED,
                STATUS_RECONCILIATION_PENDING,
                STATUS_PAID,
            ),
        )
        self.assertEqual(STATUS_SEQUENCE[-1], STATUS_PAID, "Paid is terminal")

    def test_any_settled(self):
        self.assertTrue(any_settled([STATUS_REQUESTED, STATUS_PAID]))
        self.assertFalse(any_settled([STATUS_REQUESTED, STATUS_APPROVED]))
        self.assertFalse(any_settled([]))


class TestPurity(unittest.TestCase):
    def test_module_imports_no_frappe(self):
        import nirmaan_stack.services.settlement as mod

        self.assertFalse(hasattr(mod, "frappe"))


if __name__ == "__main__":
    unittest.main()
