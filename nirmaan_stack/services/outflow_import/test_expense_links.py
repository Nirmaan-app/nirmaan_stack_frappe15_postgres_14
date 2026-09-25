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
    amount_below_links_refusal,
    bulk_id_of,
    delete_while_linked_refusal,
    derive_expense_status,
    latest_line_in_range,
    lines_fit,
    one_line_fits,
    paid_while_short_refusal,
    remaining_balance,
)
from nirmaan_stack.services.outflow_import.ledgers import PAID, RECONCILIATION_PENDING

_LINE_DATE = date(2026, 8, 18)


def _links(total, latest=_LINE_DATE):
    return ExpenseLinks(linked_total=Decimal(str(total)), latest_line_date=latest)


class TestOneLineFits(unittest.TestCase):
    """Decide's one-line rule (#1299): whole amount on a fresh expense, what is left once it has lines."""

    def _linked(self, total, count):
        return ExpenseLinks(linked_total=Decimal(str(total)), latest_line_date=None, line_count=count)

    def test_a_fresh_expense_takes_a_line_only_within_five_rupees_of_its_whole_amount(self):
        fresh = self._linked(0, 0)
        self.assertTrue(one_line_fits("1000", fresh, "1005"))
        self.assertTrue(one_line_fits("1000", fresh, "995"))
        self.assertFalse(one_line_fits("1000", fresh, "900"))
        self.assertFalse(one_line_fits("1000", fresh, "1005.01"))

    def test_a_part_linked_expense_takes_a_line_that_fits_or_fills_what_is_left(self):
        part = self._linked(6000, 3)  # 4,000 left
        self.assertTrue(one_line_fits("10000", part, "1500"))
        self.assertTrue(one_line_fits("10000", part, "4000"))
        self.assertTrue(one_line_fits("10000", part, "4005"))
        self.assertFalse(one_line_fits("10000", part, "4005.01"))


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


class TestAmountBelowLinksRefusal(unittest.TestCase):
    """RULE 1 (#1302): the amount may not sit below what the bank lines already moved."""

    def _linked(self, total, count=3):
        return ExpenseLinks(linked_total=Decimal(str(total)), latest_line_date=None, line_count=count)

    def test_an_amount_above_the_linked_total_is_fine(self):
        self.assertIsNone(amount_below_links_refusal("NPE-1", "160113", self._linked("100000")))

    def test_an_amount_equal_to_the_linked_total_is_fine(self):
        self.assertIsNone(amount_below_links_refusal("NPE-1", "100000", self._linked("100000")))

    def test_an_amount_under_by_exactly_the_tolerance_is_fine(self):
        short = Decimal("100000") - AMOUNT_TOLERANCE
        self.assertIsNone(amount_below_links_refusal("NPE-1", short, self._linked("100000")))

    def test_an_amount_under_by_a_paisa_more_is_refused(self):
        short = Decimal("100000") - AMOUNT_TOLERANCE - Decimal("0.01")
        self.assertIsNotNone(amount_below_links_refusal("NPE-1", short, self._linked("100000")))

    def test_the_refusal_names_the_expense_the_linked_total_and_the_line_count(self):
        message = amount_below_links_refusal("NPE-1", "50000", self._linked("160113", count=25))

        self.assertIn("NPE-1", message)
        self.assertIn("1,60,113", message)
        self.assertIn("25 bank lines", message)
        self.assertIn("Unreconcile", message)


class TestPaidWhileShortRefusal(unittest.TestCase):
    """RULE 2 (#1302, Q12): Paid by hand is refused while the lines fall short."""

    def _linked(self, total, count=3):
        return ExpenseLinks(linked_total=Decimal(str(total)), latest_line_date=None, line_count=count)

    def test_a_fully_linked_expense_may_be_paid(self):
        self.assertIsNone(paid_while_short_refusal("NPE-1", "160113", self._linked("160113")))

    def test_short_by_exactly_the_tolerance_may_be_paid(self):
        """The same edge `derive_expense_status` calls Paid -- the two can never disagree."""
        short = Decimal("160113") - AMOUNT_TOLERANCE
        self.assertIsNone(paid_while_short_refusal("NPE-1", "160113", self._linked(short)))

    def test_a_part_linked_expense_may_not_be_paid(self):
        self.assertIsNotNone(paid_while_short_refusal("NPE-1", "160113", self._linked("100000")))

    def test_the_refusal_names_what_is_linked_and_what_is_left(self):
        message = paid_while_short_refusal("NPE-1", "160113", self._linked("100000", count=20))

        self.assertIn("NPE-1", message)
        self.assertIn("1,00,000", message)   # linked
        self.assertIn("60,113", message)     # left
        self.assertIn("20 bank lines", message)


class TestDeleteWhileLinkedRefusal(unittest.TestCase):
    """RULE 3 (#1302): live slips block the delete and point at Unreconcile."""

    def test_an_expense_with_no_live_slips_may_be_deleted(self):
        self.assertIsNone(
            delete_while_linked_refusal("NPE-1", ExpenseLinks(Decimal("0"), None, 0))
        )

    def test_one_live_slip_blocks_it_and_reads_as_one_line(self):
        message = delete_while_linked_refusal(
            "NPE-1", ExpenseLinks(Decimal("21480"), _LINE_DATE, 1)
        )

        self.assertIn("1 bank line ", message)
        self.assertIn("is linked", message)
        self.assertIn("Unreconcile", message)

    def test_many_live_slips_block_it_and_read_as_many_lines(self):
        message = delete_while_linked_refusal(
            "NPE-1", ExpenseLinks(Decimal("160113"), _LINE_DATE, 33)
        )

        self.assertIn("33 bank lines", message)
        self.assertIn("are linked", message)


if __name__ == "__main__":
    unittest.main()


class TestLatestLineInRange(unittest.TestCase):
    """How a part-reconciled record answers a date range: by its newest line, all or nothing."""

    def test_no_range_is_all_time_even_with_no_date(self):
        self.assertTrue(latest_line_in_range(_links(100)))
        self.assertTrue(latest_line_in_range(_links(100, latest=None)))

    def test_a_range_leaves_out_a_record_with_no_date(self):
        self.assertFalse(latest_line_in_range(_links(100, latest=None), date(2026, 8, 1), date(2026, 8, 31)))

    def test_both_edges_are_inclusive(self):
        self.assertTrue(latest_line_in_range(_links(100), date(2026, 8, 18), date(2026, 8, 18)))

    def test_before_and_after_the_range_are_out(self):
        self.assertFalse(latest_line_in_range(_links(100), date(2026, 8, 19), date(2026, 8, 31)))
        self.assertFalse(latest_line_in_range(_links(100), date(2026, 8, 1), date(2026, 8, 17)))

    def test_iso_strings_are_read_as_dates(self):
        self.assertTrue(latest_line_in_range(_links(100), "2026-08-01", "2026-08-31"))

    def test_one_open_end(self):
        self.assertTrue(latest_line_in_range(_links(100), from_date=date(2026, 8, 1)))
        self.assertFalse(latest_line_in_range(_links(100), to_date=date(2026, 8, 1)))
