# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The one table that says which recognised lines are Internal Transfers, and their From, To and detail
(spec #1619). Plain `unittest`: the module is pure. Every narration is made up, shaped after the rule it
exercises.
"""

from __future__ import annotations

import unittest

from nirmaan_stack.services.outflow_import.bank_exclusions import SKIP_CATEGORY_IDS, should_skip
from nirmaan_stack.services.outflow_import.internal_transfers import (
    PLACES,
    TransferEnds,
    bank_line_transfer,
)


def _bank(remarks, *, out=True):
    """The table's answer for a made-up ICICI line, through the exclusion rules as the upload asks it."""
    skip, category = should_skip(remarks, 100 if out else None, None if out else 100)
    return bank_line_transfer(category if skip else "", remarks)


class TestThePlaces(unittest.TestCase):
    def test_from_and_to_are_a_fixed_list_of_seven_places(self):
        self.assertEqual(
            PLACES,
            (
                "ICICI Current Account",
                "ICICI Bank Ledger",
                "Cashfree Wallet",
                "Cashbook Virtual Account",
                "Cashbook Employee Wallet",
                "Porter Wallet",
                "ICICI Credit Card",
            ),
        )


class TestBankCategories(unittest.TestCase):
    def test_wallet_top_ups_run_from_the_current_account_to_the_wallet(self):
        self.assertEqual(
            _bank("MMT/IMPS/600000000001/Cashfree Balanc/IDFB0020101"),
            TransferEnds("ICICI Current Account", "Cashfree Wallet"),
        )
        self.assertEqual(
            _bank("MMT/IMPS/600000000002/Cashbook Bal/IDFB0080101"),
            TransferEnds("ICICI Current Account", "Cashbook Virtual Account"),
        )
        self.assertEqual(
            _bank("MMT/IMPS/600000000003/Porter Topup/RATN0000156"),
            TransferEnds("ICICI Current Account", "Porter Wallet"),
        )

    def test_wallet_money_returned_runs_from_cashfree_to_the_current_account(self):
        self.assertEqual(
            _bank("MMT/IMPS/600000000004/CASHFREEIDFC/IDFB0020101", out=False),
            TransferEnds("Cashfree Wallet", "ICICI Current Account"),
        )

    def test_both_legs_of_the_banks_ledger_move_name_the_ledger_numbers(self):
        self.assertEqual(
            _bank("Ac xfr from gl 01234 to 56789"),
            TransferEnds("ICICI Current Account", "ICICI Bank Ledger", "GL 01234 to 56789"),
        )
        self.assertEqual(
            _bank("Ac xfr from gl 01234 to 56789", out=False),
            TransferEnds("ICICI Bank Ledger", "ICICI Current Account", "GL 01234 to 56789"),
        )

    def test_card_bills_run_to_the_credit_card_with_its_last_four_when_the_text_gives_them(self):
        self.assertEqual(
            _bank("ATD/Auto Debit CC0xx4321"),
            TransferEnds("ICICI Current Account", "ICICI Credit Card", "Card ending 4321"),
        )
        self.assertEqual(
            _bank("BIL/BPAY/000000000001/BBPS/ICICI CRED/123456"),
            TransferEnds("ICICI Current Account", "ICICI Credit Card"),
        )

    def test_the_card_rounding_line_stays_a_skip(self):
        self.assertIsNone(_bank("CMS/ CC RBI rounding", out=False))

    def test_a_line_no_rule_recognised_is_not_internal(self):
        self.assertIsNone(bank_line_transfer("", "NEFT/some vendor"))

    def test_fixed_deposit_lines_are_never_internal(self):
        self.assertIsNone(_bank("TRF TO FD 000000000001"))
        self.assertIsNone(_bank("000000000001 FD clos proceeds", out=False))

    def test_every_category_is_answered_one_way_or_the_other(self):
        """A new exclusion rule must be placed here in the same change: internal, or left a skip."""
        for category in SKIP_CATEGORY_IDS:
            answer = bank_line_transfer(category, "")
            self.assertTrue(answer is None or isinstance(answer, TransferEnds), category)


class TestABouncedWalletTopUp(unittest.TestCase):
    """#1622: a `NEFT-RETURN-` line is internal only when its text names one of our wallets."""

    def test_a_return_naming_a_wallet_runs_from_that_wallet_to_the_current_account(self):
        self.assertEqual(
            _bank("NEFT-RETURN-TESTREF0001-CASHFREE PAYMENTS-WALLET TOPUP", out=False),
            TransferEnds("Cashfree Wallet", "ICICI Current Account"),
        )
        self.assertEqual(
            _bank("NEFT-RETURN-TESTREF0002-Cash Book Topup", out=False),
            TransferEnds("Cashbook Virtual Account", "ICICI Current Account"),
        )
        self.assertEqual(
            _bank("NEFT-RETURN-TESTREF0003-PORTER WALLET", out=False),
            TransferEnds("Porter Wallet", "ICICI Current Account"),
        )

    def test_a_return_naming_a_wallet_by_its_ifsc_counts(self):
        self.assertEqual(
            _bank("NEFT-RETURN-TESTREF0004-RATN0000156-TESTREF", out=False),
            TransferEnds("Porter Wallet", "ICICI Current Account"),
        )

    def test_the_ifsc_wins_when_the_name_and_the_ifsc_disagree(self):
        self.assertEqual(
            _bank("NEFT-RETURN-TESTREF0005-Cashbook Bal-IDFB0020101", out=False),
            TransferEnds("Cashfree Wallet", "ICICI Current Account"),
        )

    def test_a_return_naming_no_wallet_stays_a_skip(self):
        self.assertIsNone(_bank("NEFT-RETURN-TESTREF0006-TESTVENDOR TRADERS", out=False))

    def test_a_word_that_only_contains_a_wallet_name_does_not_count(self):
        self.assertIsNone(_bank("NEFT-RETURN-TESTREF0007-SITE TRANSPORTER CO", out=False))
        self.assertIsNone(_bank("NEFT-RETURN-TESTREF0008-MYCASHBOOKS LTD", out=False))
