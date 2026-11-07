# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Bill check's verdict (#1639, spec #1637, GLOSSARY *Bill check*): pure, no database.

    devenv.sh unit nirmaan_stack.services.expense_bills.test_bill_check
"""

import unittest
from datetime import date
from decimal import Decimal

from nirmaan_stack.services.expense_bills.bill_check import (
    MATCHED,
    MISMATCHED,
    NOT_CHECKED,
    NOT_READ,
    BillRead,
    ReadFailed,
    check_bill,
)


class TestBillCheck(unittest.TestCase):
    def test_a_total_exactly_one_rupee_off_is_matched_and_fills_number_date_and_total(self):
        read = BillRead(total=Decimal("1181.00"), invoice_no="INV-77", invoice_date=date(2026, 10, 30))

        verdict = check_bill(read, line_amount=Decimal("1180.00"))

        self.assertEqual(verdict.result, MATCHED)
        self.assertEqual(verdict.invoice_no, "INV-77")
        self.assertEqual(verdict.invoice_date, date(2026, 10, 30))
        self.assertEqual(verdict.total, Decimal("1181.00"))
        self.assertTrue(verdict.auto_approves)

    def test_a_total_one_paisa_over_the_rupee_is_mismatched_and_fills_nothing(self):
        read = BillRead(total=Decimal("1181.01"), invoice_no="INV-77", invoice_date=date(2026, 10, 30))

        verdict = check_bill(read, line_amount=Decimal("1180.00"))

        self.assertEqual(verdict.result, MISMATCHED)
        self.assertEqual(verdict.reason, "The bill's total is ₹1,181.01; the statement line is ₹1,180.00.")
        self.assertEqual((verdict.invoice_no, verdict.invoice_date, verdict.total), ("", None, None))
        self.assertFalse(verdict.auto_approves)

    def test_a_total_below_the_line_by_more_than_a_rupee_is_mismatched(self):
        verdict = check_bill(BillRead(total=Decimal("500")), line_amount=Decimal("1180"))

        self.assertEqual(verdict.result, MISMATCHED)

    def test_a_credit_note_against_a_spend_is_mismatched(self):
        # A credit note reads as a negative total; the wallet or card paid out the line amount.
        verdict = check_bill(BillRead(total=Decimal("-1180.00"), invoice_no="CN-3"), line_amount=Decimal("1180.00"))

        self.assertEqual(verdict.result, MISMATCHED)
        self.assertEqual(verdict.invoice_no, "")

    def test_no_total_read_is_not_read_with_its_reason_and_fills_nothing(self):
        verdict = check_bill(BillRead(total=None, invoice_no="INV-9"), line_amount=Decimal("1180"))

        self.assertEqual(verdict.result, NOT_READ)
        self.assertEqual(verdict.reason, "No total was read on the bill.")
        self.assertEqual((verdict.invoice_no, verdict.total), ("", None))

    def test_a_reader_error_timeout_or_reading_switched_off_is_not_read_with_that_reason(self):
        for reason in (
            "The reader failed (ConnectionError).",
            "The reader timed out.",
            "Reading is switched off in Document AI Settings.",
        ):
            with self.subTest(reason=reason):
                verdict = check_bill(ReadFailed(reason), line_amount=Decimal("1180"))

                self.assertEqual((verdict.result, verdict.reason), (NOT_READ, reason))
                self.assertIsNone(verdict.total)

    def test_several_bills_are_not_checked_with_the_line_amount_as_total_and_no_number_or_date(self):
        read = BillRead(total=Decimal("1180"), invoice_no="INV-1", invoice_date=date(2026, 10, 30))

        verdict = check_bill(read, line_amount=Decimal("2360"), bill_count=2)

        self.assertEqual(verdict.result, NOT_CHECKED)
        self.assertEqual(verdict.reason, "The spend carries 2 bills; its total is taken as the line amount.")
        self.assertEqual((verdict.invoice_no, verdict.invoice_date, verdict.total), ("", None, Decimal("2360")))


if __name__ == "__main__":
    unittest.main()
