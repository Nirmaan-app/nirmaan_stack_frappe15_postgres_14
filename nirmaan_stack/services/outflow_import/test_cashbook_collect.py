# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Cashbook plan's rule for a Collect payment (#1595, spec #1585 "Planning (pure module)").

Seam 3, the pure plan step. Run: DEVENV unit nirmaan_stack.services.outflow_import.test_cashbook_collect
"""

import unittest

from nirmaan_stack.services.outflow_import.cashbook import (
    ACTION_CREATE,
    ACTION_OPEN,
    ACTION_SKIP,
    SKIP_NOT_SUCCESSFUL,
    plan_statement,
)
from nirmaan_stack.services.outflow_import.cashbook_collect import is_collect_payment_line
from nirmaan_stack.services.outflow_import.test_cashbook import ALIASES, PROJECTS, RULES, TELUS, _row
from nirmaan_stack.services.outflow_import.project_match import build_project_index

COLLECT = "Collect Payment"


def _plan(*rows):
    return plan_statement(list(rows), build_project_index(PROJECTS, aliases=ALIASES), RULES)


class TestACollectPaymentIsDecidedByAPerson(unittest.TestCase):
    def test_a_successful_collect_payment_is_an_open_line_highlighted_for_checking(self):
        [line] = _plan(_row(kind=COLLECT, remarks="Collect request approved")).rows
        self.assertEqual(line.action, ACTION_OPEN)
        self.assertEqual(line.reason, "Shop-requested payment, check it.")
        self.assertIsNone(line.skip_kind)

    def test_it_is_never_created_and_never_skipped_as_own_balances(self):
        plan = _plan(_row(kind=COLLECT), _row(number=2, transfer_id="OBO2"))
        self.assertEqual([r.action for r in plan.rows], [ACTION_OPEN, ACTION_CREATE])
        self.assertEqual([r.transfer_id for r in plan.creating], ["OBO2"])
        self.assertEqual([r.transfer_id for r in plan.opening], ["OBO1"])
        self.assertEqual(plan.skipping, ())

    def test_it_carries_the_placement_a_wallet_spend_would_get(self):
        [line] = _plan(_row(kind=COLLECT, remarks="Courier charges Telus GIFT City")).rows
        self.assertEqual((line.ledger, line.project, line.expense_type),
                         ("Project Expenses", TELUS, "Material Transportation Charges"))

    def test_a_collect_payment_that_did_not_succeed_is_skipped_as_a_wallet_failure(self):
        [line] = _plan(_row(kind=COLLECT, status="FAILED")).rows
        self.assertEqual((line.action, line.reason), (ACTION_SKIP, SKIP_NOT_SUCCESSFUL))


class TestWhichLineIsACollectPayment(unittest.TestCase):
    """The main table gives an open Collect payment two choices only (spec #1585 "Open Cashbook lines"), by the
    statement Type the import stored on the line (`row_kind`)."""

    def test_a_cashbook_line_of_type_collect_payment_is_one(self):
        self.assertTrue(is_collect_payment_line(" Cashbook ", " Collect Payment "))

    def test_any_other_type_or_source_is_not(self):
        for source, kind in (("Cashbook", "Wallet Spend"), ("Cashbook", None), ("Cashfree", COLLECT), (None, COLLECT)):
            with self.subTest(source=source, kind=kind):
                self.assertFalse(is_collect_payment_line(source, kind))


if __name__ == "__main__":
    unittest.main()
