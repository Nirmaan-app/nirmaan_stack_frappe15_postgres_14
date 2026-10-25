# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Credit Card Statement reader, the pure half of the card import (#1566, spec #1565, ADR-0037).

    devenv.sh unit nirmaan_stack.services.outflow_import.test_card_statement

The fixture is the text `pypdf` extracts from the 2026-10-01 ICICI corporate card statement, pages 1-2,
with the holder, the address, the card and account numbers replaced by obvious fakes. The company stays
Stratos Infra Technologies, so the company check passes. The real PDF never enters the repo.
"""

import unittest
from datetime import date
from decimal import Decimal
from pathlib import Path

from nirmaan_stack.services.outflow_import.card_pdf import statement_text
from nirmaan_stack.services.outflow_import.tests.card_pdf_builder import pdf_from_text
from nirmaan_stack.services.outflow_import.card_statement import (
    CardStatementError,
    merchant_key,
    read_card_statement,
)

FIXTURE = Path(__file__).parent / "tests" / "fixtures" / "icici_card_statement.txt"


def _text() -> str:
    return FIXTURE.read_text(encoding="utf-8")


class TestReadingTheStatement(unittest.TestCase):
    """The 2026-10-01 layout: header, the summary totals and every line, as printed."""

    @classmethod
    def setUpClass(cls):
        cls.statement = read_card_statement(_text())

    def test_the_holder_and_company_are_read_from_the_address_block(self):
        self.assertEqual(self.statement.holder, "ARJUN TESTHOLDER")
        self.assertEqual(self.statement.company, "STRATOS INFRA TECHNOLOGIES PVT LTD")

    def test_the_statement_date_and_billing_period(self):
        self.assertEqual(self.statement.statement_date, date(2026, 10, 1))
        self.assertEqual(self.statement.period_from, date(2026, 9, 2))
        self.assertEqual(self.statement.period_to, date(2026, 10, 1))

    def test_the_five_summary_totals(self):
        totals = self.statement.totals
        self.assertEqual(totals.previous_balance, Decimal("224166.02"))
        self.assertEqual(totals.purchases, Decimal("137584.99"))
        self.assertEqual(totals.cash_advances, Decimal("0.00"))
        self.assertEqual(totals.payments, Decimal("276821.73"))
        self.assertEqual(totals.total_due, Decimal("84929.28"))

    def test_47_lines_40_spends_and_7_credits(self):
        lines = self.statement.lines
        self.assertEqual(len(lines), 47)
        self.assertEqual(sum(1 for line in lines if not line.is_credit), 40)
        self.assertEqual(sum(1 for line in lines if line.is_credit), 7)
        self.assertEqual(self.statement.spends_total, Decimal("137584.99"))
        self.assertEqual(self.statement.credits_total, Decimal("276821.73"))

    def test_a_line_carries_its_date_serno_details_amount_and_merchant_key(self):
        first = self.statement.lines[0]
        self.assertEqual(first.date, date(2026, 9, 11))
        self.assertEqual(first.serno, "14144135412")
        self.assertEqual(first.details, "transaction cashback")
        self.assertEqual(first.amount, Decimal("1854.21"))
        self.assertTrue(first.is_credit)
        spend = next(line for line in self.statement.lines if line.serno == "14099237561")
        self.assertEqual(spend.details, "MAKEMYTRIP INDIA PVT NEW DELHI IN")
        self.assertEqual(spend.amount, Decimal("11935.00"))
        self.assertFalse(spend.is_credit)
        self.assertEqual(spend.merchant_key, "MAKEMYTRIP")

    def test_a_zero_credit_is_still_a_line(self):
        retn = next(line for line in self.statement.lines if line.serno == "14194111379")
        self.assertEqual(retn.details, "Auto Dr.Retn-Insuff. fund")
        self.assertEqual(retn.amount, Decimal("0.00"))
        self.assertTrue(retn.is_credit)

    def test_a_line_dated_before_the_period_is_kept_as_printed(self):
        early = next(line for line in self.statement.lines if line.serno == "14092030373")
        self.assertEqual(early.date, date(2026, 9, 1))

    def test_a_line_out_of_date_order_is_kept_where_it_is_printed(self):
        sernos = [line.serno for line in self.statement.lines]
        refund = sernos.index("14261832070")
        self.assertEqual(self.statement.lines[refund].date, date(2026, 9, 21))
        self.assertEqual(self.statement.lines[refund - 1].date, date(2026, 9, 27))
        self.assertTrue(self.statement.lines[refund].is_credit)
        self.assertEqual(self.statement.lines[refund].amount, Decimal("801.50"))

    def test_an_international_line_is_read(self):
        linkedin = next(line for line in self.statement.lines if line.serno == "14268489039")
        self.assertEqual(linkedin.details, "IND*LINKEDIN (PGSI) WWW.LINKEDIN. IN")
        self.assertEqual(linkedin.amount, Decimal("1694.07"))
        self.assertEqual(linkedin.merchant_key, "IND LINKEDIN PGSI")

    def test_every_serno_is_eleven_digits_and_unique(self):
        sernos = [line.serno for line in self.statement.lines]
        self.assertEqual(len(set(sernos)), 47)
        self.assertTrue(all(len(serno) == 11 and serno.isdigit() for serno in sernos))


class TestMerchantKey(unittest.TestCase):
    """The cleaned merchant name: one key for one merchant across the bank's own spellings."""

    def test_the_three_makemytrip_spellings_are_one_merchant(self):
        keys = {
            merchant_key("MAKEMYTRIP(INDIA) P Gurgaon IN"),
            merchant_key("MAKEMYTRIP INDIA PVT NEW DELHI IN"),
            merchant_key("makemytrip Gurgaon IN"),
        }
        self.assertEqual(keys, {"MAKEMYTRIP"})

    def test_company_suffixes_and_the_city_are_dropped(self):
        self.assertEqual(merchant_key("BLINK COMMERCE PVT LTD BANGALORE IN"), "BLINK COMMERCE")
        self.assertEqual(merchant_key("ZOMATO LIMITED Gurugram IN"), "ZOMATO")
        self.assertEqual(merchant_key("Swiggy Limited Bangalore IN"), "SWIGGY")
        self.assertEqual(merchant_key("MALABAR EXPRESS KITCHE KOCHI IN"), "MALABAR EXPRESS KITCHE")

    def test_a_line_with_no_country_code_keeps_every_word(self):
        self.assertEqual(merchant_key("UPI Payment Received"), "UPI PAYMENT RECEIVED")
        self.assertEqual(merchant_key("Autodebit Payment Recd."), "AUTODEBIT PAYMENT RECD")

    def test_a_suffix_alone_is_never_stripped_to_nothing(self):
        self.assertEqual(merchant_key("LIMITED Pune IN"), "LIMITED")


def _replace(text: str, old: str, new: str) -> str:
    assert old in text, old
    return text.replace(old, new)


class TestRefusals(unittest.TestCase):
    """Every refusal happens in the reader, before anything is saved."""

    def assertRefused(self, text: str, *fragments: str):
        with self.assertRaises(CardStatementError) as caught:
            read_card_statement(text)
        for fragment in fragments:
            self.assertIn(fragment, str(caught.exception))

    def test_a_statement_of_another_company_is_refused(self):
        text = _replace(_text(), "STRATOS INFRA TECHNOLOGIES PVT LTD\nFLAT", "ACME TRADERS PVT LTD\nFLAT")
        self.assertRefused(text, "ACME TRADERS PVT LTD", "Stratos Infra Technologies")

    def test_private_limited_is_the_same_company_as_pvt_ltd(self):
        text = _replace(
            _text(),
            "STRATOS INFRA TECHNOLOGIES PVT LTD\nFLAT",
            "Stratos Infra Technologies Private Limited\nFLAT",
        )
        self.assertEqual(read_card_statement(text).company, "Stratos Infra Technologies Private Limited")

    def test_a_missing_line_fails_the_totals_gate_showing_both_figures(self):
        text = _replace(_text(), "11/09/2026 14152002790 PATEL NOVELTY AND GIFT BANGALORE IN 0 320.00\n", "")
        self.assertRefused(text, "₹1,37,264.99", "₹1,37,584.99", "Purchases / Charges")

    def test_a_missing_credit_fails_the_totals_gate_showing_both_figures(self):
        text = _replace(_text(), "19/09/2026 14194563678 UPI Payment Received 0 167.00 CR\n", "")
        self.assertRefused(text, "₹2,76,654.73", "₹2,76,821.73", "Payments / Credits")

    def test_a_non_zero_cash_advance_is_refused_with_its_own_message(self):
        text = _replace(
            _text(), "Á2,24,166.02 Á1,37,584.99 Á0.00 Á2,76,821.73", "Á2,24,166.02 Á1,37,584.99 Á500.00 Á2,76,821.73"
        )
        self.assertRefused(text, "Cash Advances", "₹500")

    def test_text_that_is_not_a_card_statement_is_refused(self):
        self.assertRefused("Hello, this is not a statement.", "ICICI credit card statement")

    def test_a_statement_with_no_lines_is_refused(self):
        lines = [line for line in _text().splitlines() if not line[:2].isdigit() or "/" not in line[:3]]
        self.assertRefused("\n".join(lines), "no transaction lines")


class TestReadingThePdf(unittest.TestCase):
    """The thin wrapper that turns the uploaded bytes into the reader's text."""

    def test_a_password_locked_pdf_is_refused(self):
        with self.assertRaises(CardStatementError) as caught:
            statement_text(pdf_from_text(_text(), password="secret"))
        self.assertEqual(str(caught.exception), "This PDF is password-locked. Unlock it and upload again.")

    def test_bytes_that_are_not_a_pdf_are_refused(self):
        with self.assertRaises(CardStatementError) as caught:
            statement_text(b"Date,SerNo\n01/09/2026,1\n")
        self.assertIn("could not be read as a PDF", str(caught.exception))

    def test_an_open_pdf_reads_as_the_whole_statement(self):
        statement = read_card_statement(statement_text(pdf_from_text(_text())))
        self.assertEqual(statement.holder, "ARJUN TESTHOLDER")
        self.assertEqual(len(statement.lines), 47)
        self.assertEqual(statement.totals.total_due, Decimal("84929.28"))


if __name__ == "__main__":
    unittest.main()
