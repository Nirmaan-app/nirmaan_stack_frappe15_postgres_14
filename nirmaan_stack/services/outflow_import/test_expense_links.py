# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for the "is this expense fully linked" decision (ADR-0027, #1296).

Pure: no bench, no database. The aggregate that feeds it is pinned against the live site in
`api/outflow_import/test_expenses.py`.
"""

import unittest
from datetime import date
from decimal import Decimal

from nirmaan_stack.services.outflow_import.amounts import AMOUNT_TOLERANCE
from nirmaan_stack.services.outflow_import.expense_links import (
    ExpenseLinks,
    bulk_id_of,
    derive_expense_status,
    lines_fit,
    remaining_balance,
)
from nirmaan_stack.services.outflow_import.ledgers import PAID, RECONCILIATION_PENDING

_LINE_DATE = date(2026, 8, 18)


def _links(total, latest=_LINE_DATE):
    return ExpenseLinks(linked_total=Decimal(str(total)), latest_line_date=latest)


class TestDeriveExpenseStatus(unittest.TestCase):
    def test_a_fully_linked_expense_is_paid_on_the_latest_line_date(self):
        verdict = derive_expense_status("160113", _links("160113"))

        self.assertEqual(verdict.status, PAID)
        self.assertEqual(verdict.payment_date, _LINE_DATE)

    def test_a_short_expense_is_reconciliation_pending_with_no_date(self):
        verdict = derive_expense_status("160113", _links("100000"))

        self.assertEqual(verdict.status, RECONCILIATION_PENDING)
        self.assertIsNone(verdict.payment_date)

    def test_nothing_linked_is_reconciliation_pending(self):
        verdict = derive_expense_status("500", ExpenseLinks(Decimal("0"), None))

        self.assertEqual(verdict.status, RECONCILIATION_PENDING)
        self.assertIsNone(verdict.payment_date)

    def test_short_by_exactly_the_tolerance_is_paid(self):
        """Inclusive at the edge, like `amounts_match`."""
        verdict = derive_expense_status("1000", _links(Decimal("1000") - AMOUNT_TOLERANCE))

        self.assertEqual(verdict.status, PAID)

    def test_short_by_a_paisa_more_than_the_tolerance_is_pending(self):
        short = Decimal("1000") - AMOUNT_TOLERANCE - Decimal("0.01")

        self.assertEqual(derive_expense_status("1000", _links(short)).status, RECONCILIATION_PENDING)

    def test_a_data_column_string_amount_is_read_as_money(self):
        """`Project Expenses.amount` is a Data field holding a bare numeric string."""
        self.assertEqual(derive_expense_status("18678.69", _links("18678.69")).status, PAID)


class TestRemainingBalance(unittest.TestCase):
    def test_nothing_linked_leaves_the_whole_amount(self):
        self.assertEqual(remaining_balance("5000", Decimal("0")), Decimal("5000"))

    def test_it_subtracts_the_linked_total(self):
        self.assertEqual(remaining_balance("5000", Decimal("1905")), Decimal("3095"))


class TestLinesFit(unittest.TestCase):
    """#1298: many lines are measured against what is LEFT, one-sided, with the ₹5 leeway."""

    def test_lines_below_what_is_left_fit(self):
        self.assertTrue(lines_fit("21480", "10000"))

    def test_lines_exactly_filling_what_is_left_fit(self):
        self.assertTrue(lines_fit("21480", "21480"))

    def test_lines_over_by_exactly_the_tolerance_fit(self):
        self.assertTrue(lines_fit("1000", Decimal("1000") + AMOUNT_TOLERANCE))

    def test_lines_over_by_a_paisa_more_are_refused(self):
        self.assertFalse(lines_fit("1000", Decimal("1000") + AMOUNT_TOLERANCE + Decimal("0.01")))


class TestBulkIdOf(unittest.TestCase):
    def test_every_line_of_one_run_names_it(self):
        texts = [
            "MMT/IMPS/623018455120/BULD76992401/Anil Kumar R/ICIC0000001",
            "MMT/IMPS/623018455131/BULD76992401/Priya S/HDFC0000002",
        ]
        self.assertEqual(bulk_id_of(texts), "BULD76992401")

    def test_a_truncated_repeat_of_the_id_is_ignored(self):
        text = "RTGS/ICICR42026030500502311/UTIB0000468/67453750/BULD67453750  /TARANGFIRESOLUTI/BULD67"
        self.assertEqual(bulk_id_of([text]), "BULD67453750")

    def test_lines_from_two_runs_name_none(self):
        self.assertIsNone(bulk_id_of(["x/BULD111/y", "x/BULD222/y"]))

    def test_a_line_without_an_id_names_none(self):
        self.assertIsNone(bulk_id_of(["x/BULD111/y", "Sample Project materials"]))

    def test_no_lines_name_none(self):
        self.assertIsNone(bulk_id_of([]))


if __name__ == "__main__":
    unittest.main()
