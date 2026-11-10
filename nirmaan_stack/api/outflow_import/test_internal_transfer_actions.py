# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Mark as Internal Transfer and Send back to Mismatched, by hand (#1626, spec #1619).

Through the whitelisted endpoints, as the roles that use them: who may, every refusal in words, the record made
or deleted, and who, when and why kept.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Every batch, row, record, user, Version and Comment is purged.
"""

import unittest

import frappe

from nirmaan_stack.api.outflow_import.internal_transfer_actions import (
    mark_internal_transfer,
    send_back_to_mismatched,
)
from nirmaan_stack.api.outflow_import.internal_transfers import INTERNAL_TRANSFER_DOCTYPE
from nirmaan_stack.api.outflow_import.test_internal_transfer_status import InternalTransferLineFixture
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT, ACCOUNTANT_LEAD, ADMIN, OUTSIDER, _Users
from nirmaan_stack.api.outflow_import.upload import ROW_DOCTYPE


class ActionFixture(InternalTransferLineFixture):
    def setUp(self):
        super().setUp()
        self.users = _Users()

    def tearDown(self):
        frappe.db.rollback()
        frappe.set_user("Administrator")
        self.users.purge()
        super().tearDown()

    def _as(self, profile):
        frappe.set_user("Administrator")  # only an Admin may make the throwaway user
        frappe.set_user(self.users.make(profile))

    def _record(self, line):
        rows = frappe.get_all(
            INTERNAL_TRANSFER_DOCTYPE, filters={"import_row": line},
            fields=["from_place", "to_place", "detail", "made_by", "marked_by", "marked_at", "mark_reason",
                    "direction", "amount"],
        )
        return rows[0] if rows else None

    def _refused(self, action, words, error=frappe.ValidationError):
        with self.assertRaises(error) as caught:
            action()
        frappe.db.rollback()
        self.assertIn(words, str(caught.exception))


class TestMarkAsInternalTransfer(ActionFixture):
    def test_an_accountant_lead_marks_an_open_icici_line_choosing_only_the_other_end(self):
        line = self._line(self._batch(), status="Mismatched")
        self._as(ACCOUNTANT_LEAD)
        result = mark_internal_transfer(line, other_end="Porter Wallet", reason="Porter top-up the rule missed",
                                        detail="Made-up wallet ref")
        self.assertEqual(result["status"], "Internal Transfer")
        self.assertEqual(self._status(line), "Internal Transfer")
        record = self._record(line)
        self.assertEqual(
            (record.from_place, record.to_place, record.detail, record.made_by, record.mark_reason, record.direction),
            ("ICICI Current Account", "Porter Wallet", "Made-up wallet ref", "by hand",
             "Porter top-up the rule missed", "Out"),
        )
        self.assertEqual(record.marked_by, frappe.session.user)
        self.assertIsNotNone(record.marked_at)

    def test_a_credit_runs_from_the_other_end_to_the_lines_own_side(self):
        line = self._line(self._batch(), status="Mismatched", direction="Credit")
        self._as(ADMIN)
        mark_internal_transfer(line, other_end="Cashfree Wallet", reason="Float returned")
        record = self._record(line)
        self.assertEqual((record.from_place, record.to_place, record.direction),
                         ("Cashfree Wallet", "ICICI Current Account", "In"))

    def test_a_cashbook_line_takes_the_employee_wallet_as_its_own_side(self):
        line = self._line(self._batch(source="Cashbook"), status="Mismatched", source="Cashbook", direction="")
        self._as(ADMIN)
        mark_internal_transfer(line, other_end="Cashbook Virtual Account", reason="Money back to the VA")
        record = self._record(line)
        self.assertEqual((record.from_place, record.to_place), ("Cashbook Employee Wallet", "Cashbook Virtual Account"))

    def test_other_roles_are_refused(self):
        line = self._line(self._batch(), status="Mismatched")
        for profile in (ACCOUNTANT, OUTSIDER):
            with self.subTest(profile=profile):
                self._as(profile)
                with self.assertRaises(frappe.PermissionError):
                    mark_internal_transfer(line, other_end="Porter Wallet", reason="x")
                frappe.db.rollback()
        frappe.set_user("Administrator")
        self.assertEqual(self._status(line), "Mismatched")
        self.assertIsNone(self._record(line))

    def test_a_reason_is_required(self):
        line = self._line(self._batch(), status="Mismatched")
        self._as(ADMIN)
        self._refused(lambda: mark_internal_transfer(line, other_end="Porter Wallet", reason="  "), "reason")

    def test_every_line_that_may_not_be_marked_is_refused_in_words(self):
        batch = self._batch()
        porter = self._line(self._batch(source="Porter Statement"), status="Mismatched", source="Porter Statement")
        card = self._line(self._batch(source="ICICI Credit Card Statement"), status="Pending match run",
                          source="ICICI Credit Card Statement")
        cashbook_batch = self._batch(source="Cashbook")
        cashbook = self._line(cashbook_batch, status="Pending match run", source="Cashbook", direction="")
        cases = (
            (porter, "Porter"),
            (card, "card spend"),
            (cashbook, "still creating"),
            (self._line(batch, status="Settled"), "settled"),
            (self._line(batch, status="Partially Allocated"), "allocated"),
            (self._line(batch, status="Skipped"), "skipped"),
            (self._line(batch, status="Internal Transfer"), "already an Internal Transfer"),
        )
        self._as(ADMIN)
        for line, words in cases:
            with self.subTest(words=words):
                self._refused(lambda: mark_internal_transfer(line, other_end="Porter Wallet", reason="x"), words)
                self.assertIsNone(self._record(line))

    def test_the_other_end_must_be_a_place_other_than_the_lines_own(self):
        line = self._line(self._batch(), status="Mismatched")
        self._as(ADMIN)
        self._refused(
            lambda: mark_internal_transfer(line, other_end="ICICI Current Account", reason="x"), "Choose"
        )


class TestSendBackToMismatched(ActionFixture):
    def _marked(self, profile=ADMIN):
        line = self._line(self._batch(), status="Mismatched")
        self._as(profile)
        mark_internal_transfer(line, other_end="Cashfree Wallet", reason="first")
        return line

    def test_it_deletes_the_record_and_leaves_the_line_mismatched_with_who_when_and_why(self):
        line = self._marked()
        result = send_back_to_mismatched(line, reason="It was a vendor payment")
        self.assertEqual(result["status"], "Mismatched")
        self.assertIsNone(self._record(line))
        row = frappe.db.get_value(ROW_DOCTYPE, line, ["row_status", "outcome_note", "decided_by", "decided_at"],
                                  as_dict=True)
        self.assertEqual(row.row_status, "Mismatched")
        self.assertIn("Sent back to Mismatched", row.outcome_note)
        self.assertIn("It was a vendor payment", row.outcome_note)
        self.assertEqual(row.decided_by, frappe.session.user)
        self.assertIsNotNone(row.decided_at)

    def test_a_line_a_rule_made_is_sent_back_too(self):
        from nirmaan_stack.api.outflow_import.internal_transfers import record_for_line
        from nirmaan_stack.services.outflow_import.internal_transfers import TransferEnds

        line = self._line(self._batch())
        record_for_line(frappe.get_doc(ROW_DOCTYPE, line), TransferEnds("ICICI Current Account", "Cashfree Wallet"),
                        made_by="platform_cashfree")
        frappe.db.commit()
        self._as(ACCOUNTANT_LEAD)
        send_back_to_mismatched(line, reason="Not ours")
        self.assertEqual(self._status(line), "Mismatched")
        self.assertIsNone(self._record(line))

    def test_a_line_sent_back_can_be_marked_again(self):
        line = self._marked()
        send_back_to_mismatched(line, reason="wrong end")
        mark_internal_transfer(line, other_end="Porter Wallet", reason="the right end")
        self.assertEqual(self._record(line).to_place, "Porter Wallet")

    def test_other_roles_and_a_line_that_is_not_an_internal_transfer_are_refused(self):
        line = self._marked()
        self._as(ACCOUNTANT)
        with self.assertRaises(frappe.PermissionError):
            send_back_to_mismatched(line, reason="x")
        frappe.db.rollback()
        self.assertEqual(self._status(line), "Internal Transfer")
        open_line = self._line(self._batch(), status="Mismatched")
        self._as(ADMIN)
        self._refused(lambda: send_back_to_mismatched(open_line, reason="x"), "not an Internal Transfer")

    def _recorded_line(self, batch, **line):
        from nirmaan_stack.api.outflow_import.internal_transfers import record_for_line
        from nirmaan_stack.services.outflow_import.internal_transfers import TransferEnds

        name = self._line(batch, **line)
        record_for_line(frappe.get_doc(ROW_DOCTYPE, name), TransferEnds("ICICI Current Account", "Cashfree Wallet"),
                        made_by="platform_cashfree")
        frappe.db.commit()
        return name

    def test_send_back_takes_only_its_own_line(self):
        """Every Internal Transfer line holds its own record (owner decision 3, #1619), so Send back takes one line and
        its record. Two lines of one move each hold one only when a person marked the second: it stays as it is."""
        txn = f"it-{frappe.generate_hash(length=10)}"
        first = self._recorded_line(self._batch(), transfer_id=txn)
        marked = self._recorded_line(self._batch(), transfer_id=txn, status_raw="REVERSED")
        self._as(ACCOUNTANT_LEAD)
        result = send_back_to_mismatched(first, reason="A vendor payment after all")
        frappe.set_user("Administrator")
        self.assertEqual(result["row"], first)
        self.assertEqual((self._status(first), self._record(first)), ("Mismatched", None))
        self.assertEqual(self._status(marked), "Internal Transfer")
        self.assertIsNotNone(self._record(marked))


class TestOnlySendBackDeletesARecord(unittest.TestCase):
    def test_no_role_holds_the_delete_right_on_the_doctype(self):
        """Review finding (#1619): only Send back deletes a record, so no role -- System Manager included -- may
        delete one in Desk."""
        self.assertEqual(
            [perm.role for perm in frappe.get_meta(INTERNAL_TRANSFER_DOCTYPE).permissions if perm.delete], []
        )


class TestTheRowCarriesWhatTheScreenShows(ActionFixture):
    """Review findings (#1619): the screen keeps no copy of the places or the may-mark rule (frontend F1), and Made by
    is words. Read through `get_outflow_rows`, as the main table reads it."""

    def _row(self, line):
        from nirmaan_stack.api.outflow_import.review import get_outflow_rows

        batch = frappe.db.get_value(ROW_DOCTYPE, line, "import_batch")
        return next(r for r in get_outflow_rows(scope="all", batch=batch, limit=50)["rows"] if r["name"] == line)

    def test_an_open_line_carries_its_hand_mark_offer_from_the_backends_places(self):
        from nirmaan_stack.services.outflow_import.internal_transfers import PLACES

        offer = self._row(self._line(self._batch(), status="Mismatched"))["hand_mark"]
        self.assertEqual(offer["own_place"], "ICICI Current Account")
        self.assertEqual(offer["other_ends"], [place for place in PLACES if place != "ICICI Current Account"])

    def test_a_cashbook_line_offers_its_wallet_holder_as_the_detail(self):
        line = self._line(self._batch(source="Cashbook"), status="Mismatched", source="Cashbook", direction="")
        frappe.db.set_value(ROW_DOCTYPE, line, {"added_by_raw": "Test Employee A", "beneficiary_name": "A Shop"})
        frappe.db.commit()
        self.assertEqual(self._row(line)["hand_mark"]["detail"], "Test Employee A")

    def test_a_line_that_may_not_be_marked_carries_no_offer(self):
        self.assertIsNone(self._row(self._line(self._batch(), status="Settled"))["hand_mark"])

    def test_a_line_says_whether_it_may_be_sent_back(self):
        """The screen keeps no copy of the send-back rule either (`internal_transfer_rules.send_back_refusal`): an
        Internal Transfer line may be, an open line may not. A Cashbook move is pinned by
        `test_internal_transfer_cashbook.TestACashbookMoveIsNeverSentBack`."""
        batch = self._batch()
        self.assertTrue(self._row(self._line(batch))["can_send_back"])
        self.assertFalse(self._row(self._line(batch, status="Mismatched"))["can_send_back"])

    def test_the_tab_and_the_summary_chip_count_a_line_marked_by_hand_whatever_its_bank_status(self):
        """Every Internal Transfer line holds one record (owner decision 3, #1619), so the chip counts what the tab
        lists: a person's mark on a line the bank called FAILED (unskipped first) counts in both."""
        from nirmaan_stack.api.outflow_import.review import get_outflow_rows, get_outflow_summary

        batch = self._batch(source="Cashfree")
        line = self._line(batch, status="Mismatched", source="Cashfree", status_raw="FAILED")
        self._as(ADMIN)
        mark_internal_transfer(line, other_end="ICICI Current Account", reason="The float came back")
        frappe.set_user("Administrator")
        tab = get_outflow_rows(scope="internal_transfers", batch=batch, limit=50)["rows"]
        chip = get_outflow_summary(batch=batch)["totals"]
        self.assertEqual((len(tab), chip["internal_transfer_rows"], chip["internal_transfer_out_value"]),
                         (1, 1, 5100.0))

    def test_made_by_is_words(self):
        line = self._line(self._batch(), status="Mismatched")
        self._as(ADMIN)
        mark_internal_transfer(line, other_end="Porter Wallet", reason="by a person")
        frappe.set_user("Administrator")
        self.assertEqual(self._row(line)["transfer_made_by_label"], "By hand")
