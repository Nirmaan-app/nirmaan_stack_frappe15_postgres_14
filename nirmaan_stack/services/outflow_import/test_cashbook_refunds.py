# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Wallet refunds pair with their spend, and wallet credits stay open (#1594, spec #1585, ADR-0015
Amendment B decision 7). GLOSSARY: *Paired wallet refund*, *Unpaired wallet refund*, *Wallet credit*.

Seam 3, the pure plan step: `plan_statement` on the real-file fixture (`cashbook_statement.xlsx`) and on
hand-built lines for the edges the fixture does not carry.

Run: DEVENV unit nirmaan_stack.services.outflow_import.test_cashbook_refunds
"""

import unittest
from datetime import date
from decimal import Decimal
from pathlib import Path

from nirmaan_stack.services.outflow_import.cashbook import (
    ACTION_CREATE,
    ACTION_OPEN,
    ACTION_SKIP,
    OPEN_UNPAIRED_REFUND_NOT_HERE,
    OPEN_UNPAIRED_REFUND_PART,
    OPEN_WALLET_CREDIT,
    SKIP_NOT_A_SPEND,
    SKIP_NOT_SUCCESSFUL,
    SKIP_PAIRED_REFUND,
    SKIP_PAIRED_SPEND,
)
from nirmaan_stack.services.outflow_import.parser import DIRECTION_CREDIT, parse_statement
from nirmaan_stack.services.outflow_import.skip_kinds import (
    SKIP_KIND_CASHBOOK_INTERNAL,
    SKIP_KIND_CASHBOOK_REFUND_PAIR,
)
from nirmaan_stack.services.outflow_import.test_cashbook import _plan, _row, _sightings

STATEMENT = Path(__file__).parent / "tests" / "fixtures" / "cashbook_statement.xlsx"

COLLECT_FULL = "OBO9000000000003CPFULL"  # Collect payment ₹350, refunded in full
PART_SPEND = "OBO9000000000004PARTSP"  # Wallet spend ₹17,446, ₹11,248 refunded
ADJUSTED_SPEND = "OBO9000000000005ADJFUL"  # Wallet spend ₹2,600, a full Credit Adjustment
EARLIER_REFUND = "REF-OBO9000000000008EARLYR"  # ₹640, its spend is not on the statement
WALLET_CREDIT = "PTM9000000006"  # ₹9,000 site scrap amount


def _fixture_plan():
    return _plan(parse_statement(STATEMENT.read_bytes(), source="Cashbook").rows)


def _by_id(plan, transfer_id):
    (row,) = [r for r in plan.rows if r.transfer_id == transfer_id]
    return row


class TestTheFixturesRefundPairs(unittest.TestCase):
    def setUp(self):
        self.plan = _fixture_plan()

    def test_the_refund_to_wallet_pairs_with_its_collect_payment_each_naming_the_other(self):
        refund, spend = _by_id(self.plan, "REF-" + COLLECT_FULL), _by_id(self.plan, COLLECT_FULL)
        for line in (refund, spend):
            self.assertEqual((line.action, line.skip_kind), (ACTION_SKIP, SKIP_KIND_CASHBOOK_REFUND_PAIR))
        self.assertEqual(refund.reason, SKIP_PAIRED_REFUND.format(partner=COLLECT_FULL))
        self.assertEqual(spend.reason, SKIP_PAIRED_SPEND.format(partner="REF-" + COLLECT_FULL))
        self.assertEqual((refund.partner, spend.partner), (COLLECT_FULL, "REF-" + COLLECT_FULL))

    def test_the_full_credit_adjustment_pairs_with_its_wallet_spend_and_the_spend_creates_nothing(self):
        refund, spend = _by_id(self.plan, "REF-" + ADJUSTED_SPEND), _by_id(self.plan, ADJUSTED_SPEND)
        self.assertEqual(refund.skip_kind, SKIP_KIND_CASHBOOK_REFUND_PAIR)
        self.assertEqual(spend.skip_kind, SKIP_KIND_CASHBOOK_REFUND_PAIR)
        self.assertIn(ADJUSTED_SPEND, refund.reason)
        self.assertIn("REF-" + ADJUSTED_SPEND, spend.reason)
        self.assertNotIn(ADJUSTED_SPEND, [r.transfer_id for r in self.plan.creating])

    def test_the_plan_lists_each_pair_refund_first(self):
        self.assertEqual(
            [(refund.transfer_id, spend.transfer_id) for refund, spend in self.plan.pairs],
            [("REF-" + COLLECT_FULL, COLLECT_FULL), ("REF-" + ADJUSTED_SPEND, ADJUSTED_SPEND)],
        )

    def test_a_paired_refund_carries_its_credit_as_money_in(self):
        refund = _by_id(self.plan, "REF-" + ADJUSTED_SPEND)
        self.assertEqual((refund.amount, refund.direction), (Decimal("2600"), DIRECTION_CREDIT))


class TestTheFixturesOpenLines(unittest.TestCase):
    def setUp(self):
        self.plan = _fixture_plan()

    def test_the_part_refund_is_an_open_line_and_its_spend_still_creates(self):
        refund = _by_id(self.plan, "REF-" + PART_SPEND)
        self.assertEqual((refund.action, refund.skip_kind), (ACTION_OPEN, None))
        self.assertEqual((refund.amount, refund.direction), (Decimal("11248"), DIRECTION_CREDIT))
        self.assertEqual(
            refund.reason,
            OPEN_UNPAIRED_REFUND_PART.format(refund="₹11,248", spend_amount="₹17,446", spend=PART_SPEND),
        )
        self.assertEqual(_by_id(self.plan, PART_SPEND).action, ACTION_CREATE)

    def test_a_refund_whose_spend_is_not_on_the_statement_is_an_open_line(self):
        refund = _by_id(self.plan, EARLIER_REFUND)
        self.assertEqual((refund.action, refund.amount), (ACTION_OPEN, Decimal("640")))
        self.assertEqual(refund.reason, OPEN_UNPAIRED_REFUND_NOT_HERE.format(spend="OBO9000000000008EARLYR"))

    def test_the_wallet_credit_is_an_open_line_with_its_credit_amount(self):
        credit = _by_id(self.plan, WALLET_CREDIT)
        self.assertEqual((credit.action, credit.skip_kind, credit.reason), (ACTION_OPEN, None, OPEN_WALLET_CREDIT))
        self.assertEqual((credit.amount, credit.direction), (Decimal("9000"), DIRECTION_CREDIT))

    def test_the_open_lines_are_the_two_unpaired_refunds_and_the_wallet_credit(self):
        # The unpaired Collect payments are open lines too (#1595, `test_cashbook_collect`); here only money in.
        self.assertEqual(
            [r.transfer_id for r in self.plan.opening if r.row_kind != "Collect Payment"],
            ["REF-" + PART_SPEND, WALLET_CREDIT, EARLIER_REFUND],
        )
        self.assertFalse(set(self.plan.opening) & set(self.plan.skipping))

    def test_internal_movements_are_still_skipped_as_own_balances(self):
        for transfer_id in ("BUSINESS_USER-520011-0", "VALOAD-5905490", "BUSINESS_USER-900007-1"):
            line = _by_id(self.plan, transfer_id)
            with self.subTest(transfer_id=transfer_id):
                self.assertEqual(
                    (line.action, line.reason, line.skip_kind),
                    (ACTION_SKIP, SKIP_NOT_A_SPEND, SKIP_KIND_CASHBOOK_INTERNAL),
                )

    def test_an_unpaired_collect_payment_is_an_open_line(self):
        """#1595: open and highlighted, while the one refunded in full is paired (above)."""
        line = _by_id(self.plan, "OBO9000000000002CPNONE")
        self.assertEqual((line.action, line.reason), (ACTION_OPEN, "Shop-requested payment, check it."))


class TestThePairingRule(unittest.TestCase):
    def _spend(self, transfer_id="OBO1", amount="500", **kw):
        return _row(1, transfer_id, amount, remarks="Hotel", **kw)

    def _refund(self, spend_id="OBO1", credit="500", number=2, kind="Refund to Wallet", **kw):
        return _row(number, "REF-" + spend_id, "0", kind=kind, status="REFUNDED", credit=credit, **kw)

    def test_a_refund_of_a_different_amount_does_not_pair(self):
        plan = _plan([self._spend(amount="500"), self._refund(credit="499.99")])
        self.assertEqual([r.action for r in plan.rows], [ACTION_CREATE, ACTION_OPEN])

    def test_paise_must_agree_exactly(self):
        plan = _plan([self._spend(amount="1825.40"), self._refund(credit="1825.40", kind="Credit Adjustment")])
        self.assertEqual([r.skip_kind for r in plan.rows], [SKIP_KIND_CASHBOOK_REFUND_PAIR] * 2)

    def test_one_spend_pairs_with_one_refund_only(self):
        second = self._refund(number=3, added_on=date(2026, 8, 2))  # a different date: not a repeat of the first
        plan = _plan([self._spend(), self._refund(number=2), second])
        self.assertEqual([r.action for r in plan.rows], [ACTION_SKIP, ACTION_SKIP, ACTION_OPEN])

    def test_a_spend_already_imported_earlier_leaves_its_refund_open(self):
        """The spend is on the file but is an exact repeat: its Expense already exists, so skipping the refund
        would leave that Expense standing for money that came back."""
        already = _sightings(("OBO1", "500", date(2026, 8, 1), "OFI-26-00007", "SUCCESS"))
        plan = _plan([self._spend(), self._refund()], already=already)
        self.assertEqual([(r.transfer_id, r.action) for r in plan.rows], [("REF-OBO1", ACTION_OPEN)])

    def test_a_spend_that_failed_does_not_pair(self):
        plan = _plan([self._spend(status="FAILED"), self._refund()])
        self.assertEqual([r.action for r in plan.rows], [ACTION_SKIP, ACTION_OPEN])
        self.assertEqual(plan.rows[0].reason, SKIP_NOT_SUCCESSFUL)

    def test_a_refund_names_its_spend_only_through_ref(self):
        plan = _plan([self._spend(), _row(2, "OBO1-R", "0", kind="Refund to Wallet", status="REFUNDED", credit="500")])
        self.assertEqual([r.action for r in plan.rows], [ACTION_CREATE, ACTION_OPEN])

    def test_a_wallet_credit_never_pairs(self):
        plan = _plan([self._spend(), _row(2, "REF-OBO1", "0", kind="Wallet Credit", credit="500")])
        self.assertEqual([r.action for r in plan.rows], [ACTION_CREATE, ACTION_OPEN])

    def test_a_refund_with_no_credit_is_skipped_rather_than_opened(self):
        row = _plan([self._refund(credit="0")]).rows[0]
        self.assertEqual(row.action, ACTION_SKIP)

    def test_an_open_refund_is_kept_out_of_the_creating_total(self):
        plan = _plan([self._spend(amount="500"), self._refund(credit="200")])
        self.assertEqual(plan.total_value, Decimal("500"))


class TestAnOpenLineIsDedupedOnItsCredit(unittest.TestCase):
    def test_a_wallet_credit_staged_before_is_an_exact_repeat(self):
        """A staged open line stores its Credit as its amount, so a re-upload finds it by that figure."""
        credit = _row(1, "PTM1", "0", kind="Wallet Credit", credit="9000")
        already = _sightings(("PTM1", "9000", date(2026, 8, 1), "OFI-26-00007", "SUCCESS"))
        plan = _plan([credit], already=already)
        self.assertEqual((plan.rows, plan.split.repeats_not_saved), ((), 1))


if __name__ == "__main__":
    unittest.main()
