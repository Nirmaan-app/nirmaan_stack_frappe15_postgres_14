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
    derive_expense_status,
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


if __name__ == "__main__":
    unittest.main()
