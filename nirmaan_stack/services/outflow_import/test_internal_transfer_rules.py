# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Mark as Internal Transfer by hand: which lines may be marked, and the line's own side (#1626). Pure."""

import unittest

from nirmaan_stack.services.outflow_import.internal_transfer_rules import (
    mark_refusal,
    other_end_refusal,
    own_place,
    send_back_refusal,
)


class TestWhichLinesMayBeMarked(unittest.TestCase):
    def test_an_open_icici_cashfree_or_cashbook_line_may_be_marked(self):
        for source in ("ICICI Bank Statement", "Cashfree", "Cashbook"):
            for status in ("Matched", "Mismatched", "Error"):
                with self.subTest(source=source, status=status):
                    self.assertIsNone(mark_refusal(row_status=status, source=source, direction="Debit"))
        self.assertIsNone(mark_refusal(row_status="Pending match run", source="Cashfree", direction=""))

    def test_a_line_that_is_not_open_is_refused_in_words(self):
        for status, words in (
            ("Settled", "settled"),
            ("Partially Allocated", "allocated"),
            ("Skipped", "skipped"),
            ("Internal Transfer", "already an Internal Transfer"),
        ):
            with self.subTest(status=status):
                self.assertIn(words, mark_refusal(row_status=status, source="Cashfree", direction="Debit"))

    def test_a_porter_line_a_card_spend_and_a_cashbook_line_its_job_still_owns_are_refused(self):
        self.assertIn("Porter", mark_refusal(row_status="Mismatched", source="Porter Statement", direction="Debit"))
        self.assertIn(
            "card spend", mark_refusal(row_status="Pending match run", source="ICICI Credit Card Statement",
                                       direction="Debit")
        )
        self.assertIn(
            "still creating",
            mark_refusal(row_status="Pending match run", source="Cashbook", direction="", import_batch="OFI-1"),
        )

    def test_a_card_credit_is_refused_too(self):
        refusal = mark_refusal(row_status="Mismatched", source="ICICI Credit Card Statement", direction="Credit")
        self.assertIn("ICICI, Cashfree or Cashbook", refusal)


class TestTheLinesOwnSide(unittest.TestCase):
    def test_the_own_side_comes_from_the_source(self):
        self.assertEqual(own_place("ICICI Bank Statement"), "ICICI Current Account")
        self.assertEqual(own_place("Cashfree"), "Cashfree Wallet")
        self.assertEqual(own_place("Cashbook"), "Cashbook Employee Wallet")

    def test_the_other_end_is_one_of_the_places_and_not_the_lines_own(self):
        self.assertIsNone(other_end_refusal("ICICI Bank Statement", "Porter Wallet"))
        self.assertIn("ICICI Current Account", other_end_refusal("ICICI Bank Statement", "ICICI Current Account"))
        self.assertIn("Choose", other_end_refusal("Cashfree", "Somewhere Else"))


class TestSendBack(unittest.TestCase):
    def test_only_an_internal_transfer_line_may_be_sent_back(self):
        self.assertIsNone(send_back_refusal("Internal Transfer"))
        self.assertIn("not an Internal Transfer", send_back_refusal("Mismatched"))
