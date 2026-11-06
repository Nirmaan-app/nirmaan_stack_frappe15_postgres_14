# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Sorting a card statement's credits (#1567, spec #1565, ADR-0039 decision 4). Pure.

    devenv.sh unit nirmaan_stack.services.outflow_import.test_card_credits
"""

import unittest
from datetime import date
from decimal import Decimal
from pathlib import Path

from nirmaan_stack.services.outflow_import.card_credits import (
    CARD_PAYMENT,
    CASHBACK,
    REFUND,
    REFUNDED_SPEND,
    SPEND,
    UNPAIRED_CREDIT,
    sort_card_lines,
)
from nirmaan_stack.services.outflow_import.card_statement import CardLine, merchant_key, read_card_statement

FIXTURE = Path(__file__).parent / "tests" / "fixtures" / "icici_card_statement.txt"

_serno = iter(range(30000000000, 39999999999))


def _line(day: int, details: str, amount: str, credit: bool = False, serno: str | None = None) -> CardLine:
    return CardLine(
        date=date(2026, 9, day),
        serno=serno or str(next(_serno)),
        details=details,
        amount=Decimal(amount),
        is_credit=credit,
        merchant_key=merchant_key(details),
    )


class TestTheFixtureStatement(unittest.TestCase):
    """The 2026-10-01 statement's 7 credits: 6 skipped by rule, the MakeMyTrip ₹801.50 left open."""

    @classmethod
    def setUpClass(cls):
        cls.statement = read_card_statement(FIXTURE.read_text(encoding="utf-8"))
        cls.sorted = sort_card_lines(cls.statement.lines)

    def _kind(self, serno):
        return self.sorted[serno].kind

    def test_payments_into_the_card(self):
        """CHANGED AT #1624: the "Autodebit Payment Recd." credit (14200624627) is an auto-debit now, below."""
        for serno in ("14194111379", "14194563678", "14194569955", "14200195290"):
            with self.subTest(serno=serno):
                self.assertEqual(self._kind(serno), CARD_PAYMENT)

    def test_the_banks_auto_debit_paying_the_card_is_an_internal_transfer(self):
        """#1624: ICICI Current Account to ICICI Credit Card, on the card the statement lists it under."""
        from nirmaan_stack.services.outflow_import.card_credits import CARD_AUTO_DEBIT

        self.assertEqual(self._kind("14200624627"), CARD_AUTO_DEBIT)
        self.assertTrue(self.sorted["14200624627"].internal)
        self.assertFalse(self.sorted["14200624627"].skipped)

    def test_each_line_knows_the_last_four_of_the_card_it_is_listed_under(self):
        by_serno = {line.serno: line for line in self.statement.lines}
        self.assertEqual(by_serno["14200624627"].card_last_four, "1111")
        self.assertEqual(by_serno["14092030373"].card_last_four, "2222")

    def test_cashback(self):
        self.assertEqual(self._kind("14144135412"), CASHBACK)

    def test_the_makemytrip_801_50_credit_is_unpaired(self):
        self.assertEqual(self._kind("14261832070"), UNPAIRED_CREDIT)
        self.assertIsNone(self.sorted["14261832070"].partner)

    def test_five_credits_skipped_one_internal_one_open(self):
        """CHANGED AT #1624: the auto-debit payment is an Internal Transfer now, not a skip."""
        credits = [self.sorted[line.serno] for line in self.statement.credits]
        self.assertEqual(sum(1 for s in credits if s.skipped), 5)
        self.assertEqual(sum(1 for s in credits if s.internal), 1)
        self.assertEqual([s.kind for s in credits if not s.skipped and not s.internal], [UNPAIRED_CREDIT])

    def test_every_spend_stays_a_spend_the_two_identical_ones_too(self):
        for line in self.statement.spends:
            with self.subTest(serno=line.serno):
                self.assertEqual(self._kind(line.serno), SPEND)
                self.assertFalse(self.sorted[line.serno].skipped)
        identical = [line for line in self.statement.spends if line.amount == Decimal("5293.22")]
        self.assertEqual(len(identical), 2)

    def test_every_line_is_sorted(self):
        self.assertEqual(set(self.sorted), {line.serno for line in self.statement.lines})


class TestRefundPairs(unittest.TestCase):
    def test_a_refund_pairs_with_the_spend_of_the_same_merchant_and_amount_and_each_names_the_other(self):
        spend = _line(2, "MAKEMYTRIP INDIA PVT NEW DELHI IN", "11935.00")
        refund = _line(9, "MAKEMYTRIP(INDIA) P Gurgaon IN", "11935.00", credit=True)
        result = sort_card_lines([spend, _line(3, "ZOMATO LIMITED Gurugram IN", "11935.00"), refund])
        self.assertEqual(result[refund.serno].kind, REFUND)
        self.assertEqual(result[refund.serno].partner, spend)
        self.assertEqual(result[spend.serno].kind, REFUNDED_SPEND)
        self.assertEqual(result[spend.serno].partner, refund)
        self.assertTrue(result[spend.serno].skipped and result[refund.serno].skipped)

    def test_one_credit_cancels_only_the_latest_spend_before_it(self):
        first = _line(2, "MAKEMYTRIP INDIA PVT NEW DELHI IN", "5293.22")
        second = _line(4, "MAKEMYTRIP INDIA PVT NEW DELHI IN", "5293.22")
        after = _line(12, "MAKEMYTRIP INDIA PVT NEW DELHI IN", "5293.22")
        refund = _line(10, "MAKEMYTRIP(INDIA) P Gurgaon IN", "5293.22", credit=True)
        result = sort_card_lines([first, second, refund, after])
        self.assertEqual(result[refund.serno].partner, second)
        self.assertEqual(result[second.serno].kind, REFUNDED_SPEND)
        self.assertEqual(result[first.serno].kind, SPEND)
        self.assertEqual(result[after.serno].kind, SPEND)

    def test_two_identical_spends_with_one_credit_leave_one_spend_open(self):
        one = _line(5, "SWIGGY BANGALORE IN", "420.00")
        two = _line(5, "SWIGGY BANGALORE IN", "420.00")
        refund = _line(6, "SWIGGY BANGALORE IN", "420.00", credit=True)
        result = sort_card_lines([one, two, refund])
        kinds = sorted(result[line.serno].kind for line in (one, two))
        self.assertEqual(kinds, sorted([SPEND, REFUNDED_SPEND]))
        # The latest before it: the later of the two as printed.
        self.assertEqual(result[refund.serno].partner, two)

    def test_on_a_same_day_tie_a_spend_printed_after_the_credit_is_not_its_partner(self):
        before = _line(5, "SWIGGY BANGALORE IN", "420.00")
        refund = _line(5, "SWIGGY BANGALORE IN", "420.00", credit=True)
        after = _line(5, "SWIGGY BANGALORE IN", "420.00")
        result = sort_card_lines([before, refund, after])
        self.assertEqual(result[refund.serno].partner, before)
        self.assertEqual(result[after.serno].kind, SPEND)

    def test_a_same_day_spend_printed_only_after_the_credit_leaves_it_open(self):
        refund = _line(5, "SWIGGY BANGALORE IN", "420.00", credit=True)
        after = _line(5, "SWIGGY BANGALORE IN", "420.00")
        result = sort_card_lines([refund, after])
        self.assertEqual(result[refund.serno].kind, UNPAIRED_CREDIT)
        self.assertEqual(result[after.serno].kind, SPEND)

    def test_two_credits_cancel_two_spends(self):
        one = _line(5, "SWIGGY BANGALORE IN", "420.00")
        two = _line(7, "SWIGGY BANGALORE IN", "420.00")
        first_refund = _line(6, "SWIGGY BANGALORE IN", "420.00", credit=True)
        second_refund = _line(8, "SWIGGY BANGALORE IN", "420.00", credit=True)
        result = sort_card_lines([one, two, first_refund, second_refund])
        self.assertEqual(result[first_refund.serno].partner, one)
        self.assertEqual(result[second_refund.serno].partner, two)

    def test_a_credit_with_no_spend_before_it_stays_open(self):
        refund = _line(3, "SWIGGY BANGALORE IN", "420.00", credit=True)
        later = _line(5, "SWIGGY BANGALORE IN", "420.00")
        result = sort_card_lines([refund, later])
        self.assertEqual(result[refund.serno].kind, UNPAIRED_CREDIT)
        self.assertEqual(result[later.serno].kind, SPEND)

    def test_a_different_amount_or_merchant_does_not_pair(self):
        spend = _line(2, "SWIGGY BANGALORE IN", "420.00")
        partial = _line(4, "SWIGGY BANGALORE IN", "419.99", credit=True)
        other = _line(4, "ZOMATO LIMITED Gurugram IN", "420.00", credit=True)
        result = sort_card_lines([spend, partial, other])
        self.assertEqual(result[partial.serno].kind, UNPAIRED_CREDIT)
        self.assertEqual(result[other.serno].kind, UNPAIRED_CREDIT)
        self.assertEqual(result[spend.serno].kind, SPEND)

    def test_a_payment_or_cashback_never_pairs_with_a_spend(self):
        spend = _line(2, "UPI Payment Received", "167.00")
        payment = _line(4, "UPI Payment Received", "167.00", credit=True)
        result = sort_card_lines([spend, payment])
        self.assertEqual(result[payment.serno].kind, CARD_PAYMENT)
        self.assertEqual(result[spend.serno].kind, SPEND)


class TestPaymentAndCashbackWording(unittest.TestCase):
    def test_the_payment_received_forms(self):
        # "Autodebit Payment Recd." left this list at #1624: it is the bank's auto-debit (`TestTheAutoDebitWords`).
        for details in (
            "UPI Payment Received",
            "Auto Dr.Retn-Insuff. fund",
            "BBPS Payment received",
            "NEFT PAYMENT RECEIVED",
            "Infinity Payment Received, Thank You",
        ):
            with self.subTest(details=details):
                line = _line(5, details, "100.00", credit=True)
                self.assertEqual(sort_card_lines([line])[line.serno].kind, CARD_PAYMENT)

    def test_cashback_forms(self):
        for details in ("transaction cashback", "CASHBACK CREDIT", "Cash Back on Amazon"):
            with self.subTest(details=details):
                line = _line(5, details, "10.00", credit=True)
                self.assertEqual(sort_card_lines([line])[line.serno].kind, CASHBACK)


if __name__ == "__main__":
    unittest.main()


class TestTheAutoDebitWords(unittest.TestCase):
    """#1624: only the bank's auto-debit payment is internal; every other payment credit stays a card payment."""

    def test_only_autodebit_payment_recd_is_an_auto_debit(self):
        from nirmaan_stack.services.outflow_import.card_credits import CARD_AUTO_DEBIT

        sorted_ = sort_card_lines([
            _line(20, "Autodebit Payment Recd.", "1000.00", credit=True, serno="1"),
            _line(21, "UPI Payment Received", "500.00", credit=True, serno="2"),
            _line(22, "Auto Dr.Retn-Insuff. fund", "0.00", credit=True, serno="3"),
            _line(23, "Payment Received", "200.00", credit=True, serno="4"),
        ])
        self.assertEqual(
            [sorted_[s].kind for s in "1234"], [CARD_AUTO_DEBIT, CARD_PAYMENT, CARD_PAYMENT, CARD_PAYMENT]
        )
