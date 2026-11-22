# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Cashbook statement line dated before 1 Apr 2026 is left out of the plan and counted (#1707, spec #1711).

Owner decisions (#1707): the date is a fixed constant shared with the #1649 marker patch; a line before it is never
stored; Cashbook only; the count is shown on the preview and kept on the import.

Run: DEVENV unit nirmaan_stack.services.outflow_import.test_cashbook_cutoff
"""

import unittest
from datetime import date
from decimal import Decimal

from nirmaan_stack.services.outflow_import.cashbook import (
    ACTION_CREATE,
    ACTION_INTERNAL,
    ACTION_SKIP,
    SKIP_PAIRED_REFUND,
)
from nirmaan_stack.services.outflow_import.cashbook_cutoff import CASHBOOK_FROM_DATE, before_cutoff_note
from nirmaan_stack.services.outflow_import.test_cashbook import _plan, _row, _sightings

MARCH_31 = date(2026, 3, 31)
APRIL_1 = date(2026, 4, 1)


class TestTheCutoffDate(unittest.TestCase):
    def test_the_cutoff_is_1_apr_2026_the_date_the_marker_patch_uses(self):
        from nirmaan_stack.patches.v3_0 import mark_this_year_cashbook_expenses as patch

        self.assertEqual(CASHBOOK_FROM_DATE, date(2026, 4, 1))
        self.assertEqual(patch.FROM_DATE, "2026-04-01")


class TestLinesBeforeTheCutoff(unittest.TestCase):
    def test_a_statement_on_both_sides_creates_only_the_lines_from_1_apr_2026(self):
        plan = _plan(
            [
                _row(1, "OBO-MAR", added_on=MARCH_31),
                _row(2, "OBO-APR", added_on=APRIL_1),
                _row(3, "OBO-AUG", added_on=date(2026, 8, 1)),
            ]
        )
        self.assertEqual([row.transfer_id for row in plan.creating], ["OBO-APR", "OBO-AUG"])
        self.assertEqual(plan.before_cutoff, 1)

    def test_an_earlier_line_is_not_planned_at_all(self):
        """Not stored (owner decision 2): no skip line carries it, so nothing is staged for it."""
        plan = _plan([_row(1, "OBO-MAR", added_on=MARCH_31), _row(2, "OBO-AUG")])
        self.assertNotIn("OBO-MAR", [row.transfer_id for row in plan.rows])
        self.assertNotIn("OBO-MAR", [line.row.transfer_id for line in plan.split.kept])

    def test_a_statement_of_only_earlier_lines_plans_nothing_and_counts_them(self):
        plan = _plan([_row(1, "OBO-A", added_on=MARCH_31), _row(2, "OBO-B", added_on=date(2025, 12, 1))])
        self.assertEqual(plan.rows, ())
        self.assertEqual(plan.before_cutoff, 2)

    def test_every_kind_of_earlier_line_is_left_out_not_skipped(self):
        """A failed spend, a refund, a wallet credit and a top-up are left out like a spend: the date is asked first."""
        plan = _plan(
            [
                _row(1, "OBO-FAIL", status="FAILED", added_on=MARCH_31),
                _row(2, "REF-OBO-X", kind="Refund to Wallet", amount="0", credit="50", status="REFUNDED",
                     added_on=MARCH_31),
                _row(3, "PTM-1", kind="Wallet Credit", amount="0", credit="900", added_on=MARCH_31),
                _row(4, "OBO-TOPUP", kind="VA → Wallet", amount="0", credit="1000", added_on=MARCH_31),
            ]
        )
        self.assertEqual(plan.rows, ())
        self.assertEqual(plan.before_cutoff, 4)

    def test_an_earlier_line_already_imported_is_counted_by_its_date_not_as_a_repeat(self):
        already = _sightings(("OBO-MAR", "100", MARCH_31, "OFI-1", "SUCCESS"))
        plan = _plan([_row(1, "OBO-MAR", added_on=MARCH_31)], already=already)
        self.assertEqual((plan.before_cutoff, plan.split.repeats_not_saved), (1, 0))

    def test_a_line_with_no_date_is_left_out_and_counted_as_undated(self):
        """Owner, 2026-11-18: a line not shown to be on or after the cutoff is left out like an earlier one."""
        plan = _plan([_row(1, "OBO-NODATE", added_on=None), _row(2, "OBO-MAR", added_on=MARCH_31), _row(3, "OBO-NEW")])
        self.assertEqual([row.transfer_id for row in plan.rows], ["OBO-NEW"])
        self.assertEqual((plan.before_cutoff, plan.undated), (2, 1))


class TestLinesFromTheCutoffAreDecidedAsBefore(unittest.TestCase):
    def test_refund_pairing_collect_payment_and_wallet_credit_are_unchanged(self):
        plan = _plan(
            [
                _row(1, "OBO-OLD", added_on=MARCH_31),
                _row(2, "OBO-SPEND", amount="300"),
                _row(3, "REF-OBO-SPEND", kind="Refund to Wallet", amount="0", credit="300", status="REFUNDED"),
                _row(4, "OBO-COLLECT", kind="Collect Payment", amount="80"),
                _row(5, "PTM-9", kind="Wallet Credit", amount="0", credit="900"),
                _row(6, "OBO-TOPUP", kind="VA → Wallet", amount="0", credit="1000"),
            ]
        )
        by_id = {row.transfer_id: row for row in plan.rows}
        self.assertEqual(by_id["REF-OBO-SPEND"].action, ACTION_SKIP)
        self.assertEqual(by_id["REF-OBO-SPEND"].reason, SKIP_PAIRED_REFUND.format(partner="OBO-SPEND"))
        self.assertEqual(by_id["OBO-SPEND"].partner, "REF-OBO-SPEND")
        self.assertEqual(by_id["OBO-COLLECT"].action, ACTION_CREATE)
        self.assertEqual(by_id["PTM-9"].action, ACTION_CREATE)  # #1720
        self.assertEqual(by_id["OBO-TOPUP"].action, ACTION_INTERNAL)
        self.assertEqual(plan.before_cutoff, 1)
        self.assertEqual(plan.total_value, Decimal("80"))


class TestTheNote(unittest.TestCase):
    def test_the_note_names_the_count_and_the_date(self):
        self.assertEqual(before_cutoff_note(1), "1 line before 1 Apr 2026 left out")
        self.assertEqual(before_cutoff_note(14), "14 lines before 1 Apr 2026 left out")

    def test_the_note_names_undated_lines_when_there_are_any(self):
        self.assertEqual(before_cutoff_note(3, undated=1), "3 lines before 1 Apr 2026 or with no date left out")

    def test_no_note_when_nothing_was_left_out(self):
        self.assertEqual(before_cutoff_note(0), "")


if __name__ == "__main__":
    unittest.main()
