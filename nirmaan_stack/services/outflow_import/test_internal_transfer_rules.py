# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Mark as Internal Transfer by hand: which lines may be marked, and the line's own side (#1626). Pure."""

import unittest

from nirmaan_stack.services.outflow_import.internal_transfer_rules import (
    hand_mark_offer,
    mark_refusal,
    other_end_refusal,
    own_place,
    send_back_refusal,
)
from nirmaan_stack.services.outflow_import.internal_transfers import (
    CARD_AUTO_DEBIT_RULE,
    CASHBOOK_INTERNAL_KINDS,
    INTERNAL_BANK_CATEGORIES,
    made_by_words,
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
        self.assertIsNone(send_back_refusal(row_status="Internal Transfer", source="ICICI Bank Statement", row_kind="",
                                            transfer_id=""))
        self.assertIn("not an Internal Transfer",
                      send_back_refusal(row_status="Mismatched", source="ICICI Bank Statement", row_kind="",
                                        transfer_id=""))

    def test_a_cashbook_move_is_refused_by_its_type_and_a_hand_marked_cashbook_line_is_not(self):
        """The #1619 review: a Cashbook move's money is in the Credit column the line does not keep, so sent back and
        marked again it would record the wrong ends and Rs 0 (owner decision 2026-11-10)."""
        for kind in CASHBOOK_INTERNAL_KINDS:
            with self.subTest(kind=kind):
                refusal = send_back_refusal(row_status="Internal Transfer", source="Cashbook", row_kind=kind,
                                            transfer_id="TXN-1")
                self.assertIn(f"Cashbook's own Type ({kind}) says this line is a move between our own places", refusal)
        self.assertIsNone(send_back_refusal(row_status="Internal Transfer", source="Cashbook", row_kind="Wallet Spend",
                                            transfer_id="OBO-1"))
        self.assertIsNone(send_back_refusal(row_status="Internal Transfer", source="Cashbook", row_kind=None,
                                            transfer_id="OBO-1"))
        self.assertIsNone(send_back_refusal(row_status="Internal Transfer", source="ICICI Bank Statement",
                                            row_kind="Bank → VA", transfer_id="VALOAD-1"))

    def test_an_old_cashbook_move_with_no_stored_type_is_refused_by_its_txn_id(self):
        """Every Cashbook Internal Transfer line in the 2026-11-07 data (922 of 922) was staged before the Type was
        stored; the patch placed each by its Txn Id, and Send back reads it the same way."""
        for txn, kind in (("VALOAD-A1", "Bank → VA"), ("BUSINESS_USER-A2", "VA → Wallet"), ("C2B-A3", "Wallet → VA")):
            with self.subTest(txn=txn):
                refusal = send_back_refusal(row_status="Internal Transfer", source="Cashbook", row_kind="",
                                            transfer_id=txn)
                self.assertIn(f"Cashbook's own Type ({kind}) says this line is a move between our own places", refusal)


class TestTheHandMarkOffer(unittest.TestCase):
    """What the server sends the Mark dialog with each row (review finding F1, #1619): the screen keeps no copy of the
    places, the own-side table or the may-mark rule."""

    def _offer(self, **line):
        facts = dict(row_status="Mismatched", source="ICICI Bank Statement", direction="Debit", import_batch="OFI-1",
                     added_by_raw="", beneficiary_name="")
        facts.update(line)
        return hand_mark_offer(**facts)

    def test_an_open_line_offers_its_own_side_and_every_other_place(self):
        offer = self._offer()
        self.assertEqual(offer["own_place"], "ICICI Current Account")
        self.assertEqual(
            offer["other_ends"],
            ["ICICI Bank Ledger", "Cashfree Wallet", "Cashbook Virtual Account", "Cashbook Employee Wallet",
             "Porter Wallet", "ICICI Credit Card"],
        )

    def test_a_line_that_may_not_be_marked_is_offered_nothing(self):
        for line in (
            dict(row_status="Settled"),
            dict(row_status="Internal Transfer"),
            dict(source="Porter Statement"),
            dict(source="Cashbook", direction="", row_status="Pending match run"),
        ):
            with self.subTest(**line):
                self.assertIsNone(self._offer(**line))

    def test_a_cashbook_line_prefills_the_wallet_holder(self):
        """Owner decision 8a (#1619): the statement's From for money out, its To for money in."""
        out = self._offer(source="Cashbook", direction="", added_by_raw="Test Employee A", beneficiary_name="A Shop")
        back_in = self._offer(source="Cashbook", direction="Credit", added_by_raw="A Shop",
                              beneficiary_name="Test Employee B")
        self.assertEqual((out["detail"], back_in["detail"]), ("Test Employee A", "Test Employee B"))
        self.assertEqual(out["own_place"], "Cashbook Employee Wallet")

    def test_any_other_line_prefills_no_detail(self):
        self.assertEqual(self._offer(added_by_raw="Someone", beneficiary_name="Someone else")["detail"], "")


class TestMadeByInWords(unittest.TestCase):
    """Review finding (#1619): Made by shows words, not rule ids."""

    def test_a_rule_and_a_person_in_words(self):
        self.assertEqual(made_by_words("platform_cashfree"), "Rule: Cashfree wallet top-up")
        self.assertEqual(made_by_words("cashbook_va_to_wallet"), "Rule: Cashbook VA → Wallet")
        self.assertEqual(made_by_words("card_auto_debit"), "Rule: Card auto-debit")
        self.assertEqual(made_by_words("by hand"), "By hand")

    def test_every_rule_that_makes_a_record_has_words(self):
        rules = set(INTERNAL_BANK_CATEGORIES) | set(CASHBOOK_INTERNAL_KINDS.values()) | {CARD_AUTO_DEBIT_RULE}
        for rule in sorted(rules):
            with self.subTest(rule=rule):
                words = made_by_words(rule)
                self.assertTrue(words.startswith("Rule: "), words)
                self.assertNotIn("_", words)
