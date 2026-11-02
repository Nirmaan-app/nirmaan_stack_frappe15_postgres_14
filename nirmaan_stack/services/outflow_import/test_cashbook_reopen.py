# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Re-opening lines an earlier Cashbook import wrongly skipped as own balances (#1596, spec #1585 "Re-opening old
wrong skips", user stories 46-48).

Seam 3, the pure plan step. An earlier import staged each Collect payment, refund and wallet credit as a skip with
the own-balances reason; a refund or wallet credit was staged with amount 0 (no Credit read then). The statement
carrying the same line again re-opens THAT earlier line under the new rules instead of staging a second one.

Run: DEVENV unit nirmaan_stack.services.outflow_import.test_cashbook_reopen
"""

import unittest
from datetime import date
from decimal import Decimal

from nirmaan_stack.services.outflow_import.cashbook import (
    ACTION_OPEN,
    ACTION_SKIP,
    SKIP_NOT_A_SPEND,
)
from nirmaan_stack.services.outflow_import.cashbook_reopen import EarlierWrongSkip
from nirmaan_stack.services.outflow_import.skip_kinds import SKIP_KIND_CASHBOOK_REFUND_PAIR
from nirmaan_stack.services.outflow_import.test_cashbook import _plan as _plain_plan, _row, _sightings

DAY = date(2026, 8, 1)
OLD = "OIB-OLD"
COLLECT, REFUND, CREDIT_ADJ, WALLET_CREDIT = "Collect Payment", "Refund to Wallet", "Credit Adjustment", "Wallet Credit"


def _old(line, transfer_id, amount, kind=""):
    """An earlier staged copy skipped as own balances, as the import reads it back (`row_kind` blank: the old
    import never stored it)."""
    return EarlierWrongSkip(
        line=line, batch=OLD, transfer_id=transfer_id, amount=Decimal(amount), added_on_date=DAY, row_kind=kind
    )


def _old_sightings(*entries):
    """The earlier batch's lines as `already_imported` holds them: `(transfer_id, stored amount, status)`."""
    return _sightings(*((tid, amount, DAY, OLD, status) for tid, amount, status in entries))


def _plan(rows, already=None, wrong_skips=()):
    from nirmaan_stack.services.outflow_import.cashbook import plan_statement
    from nirmaan_stack.services.outflow_import.project_match import build_project_index
    from nirmaan_stack.services.outflow_import.test_cashbook import ALIASES, PROJECTS, RULES

    return plan_statement(
        rows,
        build_project_index(PROJECTS, aliases=ALIASES),
        RULES,
        already_imported=already,
        wrong_skips=wrong_skips,
    )


class TestWronglySkippedLinesComeBack(unittest.TestCase):
    def test_a_collect_payment_is_reopened_open_and_highlighted_not_dropped_as_a_repeat(self):
        rows = [_row(transfer_id="OBO-CP", amount="480", kind=COLLECT)]
        plan = _plan(rows, _old_sightings(("OBO-CP", "480", "SUCCESS")), [_old("ROW-1", "OBO-CP", "480")])

        [line] = plan.rows
        self.assertEqual((line.action, line.reason), (ACTION_OPEN, "Shop-requested payment, check it."))
        self.assertEqual(line.reopens.line, "ROW-1")
        self.assertEqual(plan.split.repeats_not_saved, 0)
        self.assertEqual(plan.reopening, (line,))

    def test_a_refund_staged_earlier_with_amount_0_is_reopened_for_its_credit(self):
        rows = [_row(transfer_id="REF-OBO-GONE", amount="0", credit="640", kind=REFUND, status="REFUNDED")]
        plan = _plan(rows, _old_sightings(("REF-OBO-GONE", "0", "REFUNDED")), [_old("ROW-2", "REF-OBO-GONE", "0")])

        [line] = plan.rows
        self.assertEqual((line.action, line.amount, line.direction), (ACTION_OPEN, Decimal("640"), "Credit"))
        self.assertIn("its spend OBO-GONE is not on this statement", line.reason)
        self.assertEqual(line.reopens.line, "ROW-2")

    def test_a_wallet_credit_is_reopened_open(self):
        rows = [_row(transfer_id="PTM-1", amount="0", credit="9000", kind=WALLET_CREDIT)]
        plan = _plan(rows, _old_sightings(("PTM-1", "0", "SUCCESS")), [_old("ROW-3", "PTM-1", "0")])

        [line] = plan.rows
        self.assertEqual((line.action, line.amount), (ACTION_OPEN, Decimal("9000")))
        self.assertTrue(line.reason.startswith("Wallet credit:"))
        self.assertEqual(line.reopens.line, "ROW-3")

    def test_a_collect_payment_and_its_full_refund_both_reopen_as_a_pair(self):
        rows = [
            _row(number=1, transfer_id="OBO-CP", amount="350", kind=COLLECT),
            _row(number=2, transfer_id="REF-OBO-CP", amount="0", credit="350", kind=REFUND, status="REFUNDED"),
        ]
        plan = _plan(
            rows,
            _old_sightings(("OBO-CP", "350", "SUCCESS"), ("REF-OBO-CP", "0", "REFUNDED")),
            [_old("ROW-4", "OBO-CP", "350"), _old("ROW-5", "REF-OBO-CP", "0")],
        )

        spend, refund = plan.rows
        for line in (spend, refund):
            self.assertEqual((line.action, line.skip_kind), (ACTION_SKIP, SKIP_KIND_CASHBOOK_REFUND_PAIR))
        self.assertEqual((spend.reopens.line, refund.reopens.line), ("ROW-4", "ROW-5"))
        self.assertEqual(plan.pairs, ((refund, spend),))

    def test_a_refund_whose_spend_was_recorded_earlier_reopens_open(self):
        """The spend is an exact repeat (its Expense exists), so the refund cannot pair and stays to be decided."""
        rows = [
            _row(number=1, transfer_id="OBO-SP", amount="2600"),
            _row(number=2, transfer_id="REF-OBO-SP", amount="0", credit="2600", kind=CREDIT_ADJ, status="REFUNDED"),
        ]
        plan = _plan(
            rows,
            _old_sightings(("OBO-SP", "2600", "SUCCESS"), ("REF-OBO-SP", "0", "REFUNDED")),
            [_old("ROW-6", "REF-OBO-SP", "0")],
        )

        [refund] = plan.rows
        self.assertEqual((refund.transfer_id, refund.action), ("REF-OBO-SP", ACTION_OPEN))
        self.assertEqual(refund.reopens.line, "ROW-6")
        self.assertEqual(plan.split.repeats_not_saved, 1)


class TestOtherSkipsStay(unittest.TestCase):
    def test_a_real_internal_movement_skipped_as_own_balances_stays_an_exact_repeat(self):
        rows = [_row(transfer_id="BUSINESS_USER-1", amount="0", credit="10000", kind="VA → Wallet")]
        plan = _plan(rows, _old_sightings(("BUSINESS_USER-1", "0", "SUCCESS")), [_old("ROW-7", "BUSINESS_USER-1", "0")])

        self.assertEqual((plan.rows, plan.split.repeats_not_saved), ((), 1))

    def test_a_collect_payment_skipped_for_another_reason_stays_an_exact_repeat(self):
        rows = [_row(transfer_id="OBO-CP", amount="480", kind=COLLECT)]
        plan = _plan(rows, _old_sightings(("OBO-CP", "480", "SUCCESS")))

        self.assertEqual((plan.rows, plan.split.repeats_not_saved), ((), 1))

    def test_a_wallet_credit_skipped_for_another_reason_is_not_staged_a_second_time(self):
        """Its earlier copy holds amount 0, its Credit now: still the same line, so an exact repeat."""
        rows = [_row(transfer_id="PTM-1", amount="0", credit="9000", kind=WALLET_CREDIT)]
        plan = _plan(rows, _old_sightings(("PTM-1", "0", "SUCCESS")))

        self.assertEqual((plan.rows, plan.split.repeats_not_saved), ((), 1))

    def test_a_line_the_new_rules_skip_is_not_reopened(self):
        rows = [_row(transfer_id="OBO-CP", amount="480", kind=COLLECT, status="FAILED")]
        plan = _plan(rows, _old_sightings(("OBO-CP", "480", "FAILED")), [_old("ROW-8", "OBO-CP", "480")])

        self.assertEqual((plan.rows, plan.split.repeats_not_saved), ((), 1))

    def test_an_earlier_copy_of_another_kind_is_not_claimed(self):
        """A copy staged by the new import knows its Type; a different one is a different line."""
        rows = [_row(transfer_id="PTM-1", amount="0", credit="9000", kind=WALLET_CREDIT)]
        plan = _plan(rows, wrong_skips=[_old("ROW-9", "PTM-1", "0", kind="VA → Wallet")])

        [line] = plan.rows
        self.assertIsNone(line.reopens)

    def test_one_earlier_copy_is_reopened_once(self):
        rows = [
            _row(number=1, transfer_id="PTM-1", amount="0", credit="9000", kind=WALLET_CREDIT),
            _row(number=2, transfer_id="PTM-1", amount="0", credit="9000", kind=WALLET_CREDIT, status="PENDING"),
        ]
        plan = _plan(rows, wrong_skips=[_old("ROW-10", "PTM-1", "0")])

        self.assertEqual([line.reopens.line if line.reopens else None for line in plan.rows][:1], ["ROW-10"])
        self.assertEqual(len(plan.reopening), 1)

    def test_a_statement_with_no_earlier_wrong_skips_plans_as_before(self):
        rows = [_row(transfer_id="OBO-CP", amount="480", kind=COLLECT)]
        self.assertEqual(_plan(rows).rows, _plain_plan(rows).rows)
        self.assertEqual(SKIP_NOT_A_SPEND, "Moves money between our own balances, not a spend")


if __name__ == "__main__":
    unittest.main()
