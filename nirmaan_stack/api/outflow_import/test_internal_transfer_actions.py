# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Mark as Internal Transfer and Send back to Mismatched, by hand (#1626, spec #1619).

Through the whitelisted endpoints, as the roles that use them: who may, every refusal in words, the record made
or deleted, and who, when and why kept.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Every batch, row, record, user, Version and Comment is purged.
"""

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
        frappe.set_user("Administrator")
        for batch in self.batches:
            frappe.db.sql(
                """DELETE FROM "tabInternal Transfer" WHERE import_row IN
                   (SELECT name FROM "tabOutflow Import Row" WHERE import_batch = %s)""",
                (batch,),
            )
        frappe.db.commit()
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
