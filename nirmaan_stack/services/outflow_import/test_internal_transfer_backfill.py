# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Placing a line skipped before spec #1619 as the import would place it today (#1627). Pure."""

import unittest

from nirmaan_stack.services.outflow_import.internal_transfer_backfill import (
    LEFT,
    PLACED,
    REFUSED,
    UNPLACED,
    place_old_skip,
)
from nirmaan_stack.services.outflow_import.internal_transfers import TransferEnds


def _icici(kind, remarks, direction="Debit"):
    return place_old_skip(source="ICICI Bank Statement", skip_kind=kind, remarks=remarks, direction=direction)


def _cashbook(transfer_id, row_kind="", status="SUCCESS", who_from="", who_to=""):
    return place_old_skip(
        source="Cashbook", skip_kind="Cashbook internal movement", transfer_id=transfer_id, row_kind=row_kind,
        status_raw=status, added_by_raw=who_from, beneficiary_name=who_to,
    )


class TestIciciKinds(unittest.TestCase):
    def test_each_moved_kind_is_placed_as_the_import_would(self):
        cases = (
            ("Cashfree wallet top-up", "MMT/IMPS/600900000001/TESTWALLETA/IDFB0020101", "Debit",
             TransferEnds("ICICI Current Account", "Cashfree Wallet"), "platform_cashfree"),
            ("Wallet money returned", "MMT/IMPS/600900000004/CASHFREEIDFC/IDFB0020101", "Credit",
             TransferEnds("Cashfree Wallet", "ICICI Current Account"), "gateway_wallet_return"),
            ("Bank internal transfer", "Ac xfr from gl 01234 to 56789", "Credit",
             TransferEnds("ICICI Bank Ledger", "ICICI Current Account", "GL 01234 to 56789"),
             "internal_gl_transfer_in"),
            ("Credit card auto-debit", "ATD/Auto Debit CC0xx4321", "Debit",
             TransferEnds("ICICI Current Account", "ICICI Credit Card", "Card ending 4321"),
             "credit_facility_auto_debit"),
        )
        for kind, remarks, direction, ends, rule in cases:
            with self.subTest(kind=kind):
                placed = _icici(kind, remarks, direction)
                self.assertEqual((placed.outcome, placed.ends, placed.rule), (PLACED, ends, rule))

    def test_a_bounced_wallet_top_up_is_placed_and_a_vendor_bounce_is_left(self):
        self.assertEqual(
            _icici("Failed payment bounced back", "NEFT-RETURN-TESTREF0011-CASHBOOK TOPUP", "Credit").ends,
            TransferEnds("Cashbook Virtual Account", "ICICI Current Account"),
        )
        self.assertEqual(_icici("Failed payment bounced back", "NEFT-RETURN-TESTREF0012-TESTVENDOR", "Credit").outcome,
                         LEFT)

    def test_a_line_the_rules_now_read_differently_is_not_placed_and_says_why(self):
        placed = _icici("Porter wallet top-up", "NEFT/TESTSUPPLIER STEEL/UTIB0000001")
        self.assertEqual(placed.outcome, UNPLACED)
        self.assertIn("no rule", placed.why)

    def test_every_other_skip_is_left(self):
        for kind in ("Already imported", "Skipped by hand", "Bank card rounding (₹2)", "Outflow Already Recorded"):
            with self.subTest(kind=kind):
                self.assertEqual(_icici(kind, "anything").outcome, LEFT)


class TestCashbookLines(unittest.TestCase):
    def test_a_stored_type_places_the_line(self):
        placed = _cashbook("OBO1", row_kind="VA → Wallet", who_to="Test Employee A")
        self.assertEqual(placed.ends, TransferEnds("Cashbook Virtual Account", "Cashbook Employee Wallet",
                                                   "Test Employee A"))
        self.assertEqual(placed.rule, "cashbook_va_to_wallet")

    def test_a_line_with_no_type_is_placed_by_its_txn_id(self):
        self.assertEqual(_cashbook("VALOAD-1234567").ends, TransferEnds("ICICI Current Account",
                                                                       "Cashbook Virtual Account"))
        self.assertEqual(_cashbook("BUSINESS_USER-123456-0", who_to="Test Employee A").ends,
                         TransferEnds("Cashbook Virtual Account", "Cashbook Employee Wallet", "Test Employee A"))
        self.assertEqual(_cashbook("C2B-BUSINESS_USER-12", who_from="Test Employee B").ends,
                         TransferEnds("Cashbook Employee Wallet", "Cashbook Virtual Account", "Test Employee B"))

    def test_a_refund_is_left_as_it_is(self):
        placed = _cashbook("REF-TEST0000001")
        self.assertEqual(placed.outcome, LEFT)
        self.assertIn("refund", placed.why)

    def test_a_line_neither_its_type_nor_its_txn_id_places_is_reported(self):
        placed = _cashbook("TESTUPI0000000001")
        self.assertEqual(placed.outcome, UNPLACED)
        self.assertIn("Txn Id", placed.why)

    def test_a_move_the_wallet_says_failed_is_bank_refused_as_the_import_skips_it(self):
        """Owner decision 3 (#1619, 2026-11-07): in the import and in the patch."""
        placed = _cashbook("VALOAD-7654321", status="FAILED")
        self.assertEqual(placed.outcome, REFUSED)
        self.assertIn("did not succeed", placed.why)


class TestCardPayments(unittest.TestCase):
    def test_the_auto_debit_is_placed_and_every_other_card_payment_is_left(self):
        card = "ICICI Credit Card Statement"
        placed = place_old_skip(source=card, skip_kind="Card payment received", remarks="Autodebit Payment Recd.",
                                direction="Credit")
        self.assertEqual((placed.outcome, placed.ends.from_place, placed.ends.to_place),
                         (PLACED, "ICICI Current Account", "ICICI Credit Card"))
        for remarks in ("UPI Payment Received", "Auto Dr.Retn-Insuff. fund"):
            with self.subTest(remarks=remarks):
                self.assertEqual(place_old_skip(source=card, skip_kind="Card payment received", remarks=remarks,
                                                direction="Credit").outcome, LEFT)
