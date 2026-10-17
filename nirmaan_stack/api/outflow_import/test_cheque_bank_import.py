# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Bulk Import Transactions clears Payment cheques (#1485, spec #1477, ADR-0035).

Each test stages a small planted ICICI statement through the import's own staging (`upload._stage_batch`,
what the upload endpoint calls after parsing) and runs the match the upload dialog runs next
(`review.match_batch`). It then reads back what a user sees: the line's status and note on the review
screen, each payment's status and payment date, the bank-match rows, and the Cheque's status, dates,
bank line and history.

⚠️ RUNS AGAINST THE ENV DATABASE (the match run commits). Cheques, payments and POs are purged by their
fixtures; each staged statement is purged here. Cheque numbers are random 9-digit numbers written with
two leading zeros on the cheque and without them on the statement.
"""

from datetime import datetime
from unittest.mock import patch

import frappe
from frappe.utils import add_days, flt, nowdate

from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.cheques.test_cheque_status import ChequeStatusCase
from nirmaan_stack.api.outflow_import.review import get_outflow_rows, match_batch
from nirmaan_stack.api.outflow_import.test_review import _stage_icici_statement
from nirmaan_stack.api.outflow_import.unreconcile import plan_of_line, unreconcile_line
from nirmaan_stack.services.cheques.rules import BANK_APPROVAL_NOTE, BANK_REVIVAL_NOTE
from nirmaan_stack.services.cheques.status import cancel, clear

PAYMENT = "Project Payments"
ROW = "Outflow Import Row"
MATCH = "Outflow Row Match"
U = "Administrator"
RP = "Reconciliation Pending"


class ChequeImportCase(ChequeStatusCase):
    def setUp(self):
        super().setUp()
        self.day = nowdate()
        self.tid = f"T1485{frappe.generate_hash(length=6).upper()}"

    def _number(self) -> str:
        """A cheque number nothing else carries, as written on the cheque (with leading zeros)."""
        return "00" + str(int(frappe.generate_hash(length=10), 16))[-7:].rjust(7, "1")

    def _import(self, *lines):
        """Stage a statement of `(cheque_column, amount)` / `(cheque_column, amount, "credit")` lines and run
        the match. Returns the line names, in order."""
        planted = [
            {
                "tid": f"{self.tid}{n}", "day": datetime.strptime(self.day, "%Y-%m-%d"), "cheque": cheque,
                "narration": "CLG/TEST CHEQUE VENDOR/HSB", "amount": flt(amount),
                "credit": len(rest) > 0 and rest[0] == "credit",
            }
            for n, (cheque, amount, *rest) in enumerate(lines, start=1)
        ]
        filename = f"test-1485-{self.tid}.csv"
        batch = _stage_icici_statement(planted, filename).name
        frappe.db.commit()
        self.addCleanup(ChequeFixture.purge_rows, [
            (MATCH, {"import_batch": batch}),
            ("File", {"file_url": f"/private/files/{filename}"}),
            ("Comment", {"reference_doctype": PAYMENT, "reference_name": ["in", self.fx.payments or [""]]}),
            (ROW, {"import_batch": batch}),
            ("Outflow Import Batch", {"name": batch}),
        ])
        self.batch = batch
        match_batch(batch)
        return frappe.get_all(ROW, filters={"import_batch": batch}, order_by="transfer_id asc", pluck="name")

    # -- reading --------------------------------------------------------------------------------
    def _line(self, row):
        return frappe.db.get_value(ROW, row, ["row_status", "outcome_note"], as_dict=True)

    def _legs(self, row):
        return sorted(
            (m.target_name, m.match_basis)
            for m in frappe.get_all(MATCH, filters={"import_row": row, "match_kind": "Settled"},
                                    fields=["target_name", "match_basis"])
        )

    def _state(self, cheque):
        return frappe.db.get_value(
            "Cheques", cheque, ["status", "cleared_by", "bank_line", "clearance_date", "issue_date"], as_dict=True
        )

    def _shown(self, row):
        rows = get_outflow_rows(scope="all", batch=self.batch, limit=50)["rows"]
        return next(r for r in rows if r["name"] == row)


class TestALineClearsItsCheque(ChequeImportCase):
    def test_an_issued_cheque_is_cleared_and_every_payment_paid_and_linked_to_the_line(self):
        number = self._number()
        cheque, (a, b) = self._issued(30000, 12000, cheque_no=number)

        (row,) = self._import((number.lstrip("0"), 42000))

        self.assertEqual(self._statuses(a, b), ["Paid", "Paid"])
        self.assertEqual(self._payment_dates(a, b), [self.day, self.day])
        self.assertEqual(self._legs(row), sorted([(a, "cheque number"), (b, "cheque number")]))
        state = self._state(cheque)
        self.assertEqual(
            (state.status, state.cleared_by, state.bank_line, str(state.clearance_date)),
            ("Cleared", "Bank import", row, self.day),
        )
        self.assertEqual(self._history(cheque)[-1][:2], ("Issued", "Cleared"))
        line = self._line(row)
        self.assertEqual(line.row_status, "Settled")
        self.assertEqual(
            line.outcome_note,
            f"Cheque {number} cleared: 2 payments Reconciliation Pending → Paid, payment date "
            f"{datetime.strptime(self.day, '%Y-%m-%d').strftime('%d-%m-%Y')}.",
        )
        shown = self._shown(row)["cheque_outcome"]
        self.assertEqual(
            (shown["cheque"], shown["cheque_no"], shown["started"], shown["double_payments"]),
            (cheque, number, "Issued", []),
        )

    def test_a_pending_cheque_is_approved_by_the_import_then_cleared(self):
        number = self._number()
        a, b = self._payment(20000), self._payment(15000, "CEO Pending")
        cheque = self._make([a, b], [20000, 15000], cheque_no=number)
        frappe.db.set_value(PAYMENT, b, "approval_date", add_days(self.day, -3), update_modified=False)
        frappe.db.commit()

        (row,) = self._import((number, 35000))

        self.assertEqual(self._statuses(a, b), ["Paid", "Paid"])
        self.assertEqual(str(frappe.db.get_value(PAYMENT, a, "approval_date")), self.day)
        self.assertEqual(str(frappe.db.get_value(PAYMENT, b, "ceo_approval_date")), self.day)
        self.assertEqual(self._terms(a, b), ["Paid", "Paid"])
        history = self._history(cheque)
        self.assertEqual(history[-2], ("Pending", "Issued", U, BANK_APPROVAL_NOTE))
        self.assertEqual(history[-1][:2], ("Issued", "Cleared"))
        state = self._state(cheque)
        self.assertEqual((state.status, str(state.issue_date)), ("Cleared", self.day))
        self.assertEqual(self._line(row).row_status, "Settled")
        self.assertIn("approved by bank import", self._line(row).outcome_note)
        self.assertEqual(self._shown(row)["cheque_outcome"]["started"], "Pending")

    def test_a_cancelled_cheque_is_cleared_and_a_later_payment_on_its_po_is_flagged(self):
        number = self._number()
        cheque, (a,) = self._issued(25000, cheque_no=number)
        cancel(cheque, note="Vendor lost the cheque", user=U)
        frappe.db.commit()
        # The cancel happened an hour ago; the PO was then paid online.
        frappe.db.sql(
            """UPDATE "tabCheque Status History" SET changed_at = NOW() - INTERVAL '1 hour'
               WHERE parent = %s AND to_status = 'Cancelled'""", (cheque,),
        )
        po = frappe.db.get_value(PAYMENT, a, "document_name")
        online = ChequeFixture.plant_payment(self.fx, "Approved", project=self.project, vendor=self.vendor,
                                             document=("Procurement Orders", po), amount=25000)

        (row,) = self._import((number, 25000))

        self.assertEqual(self._statuses(a), ["Paid"])
        self.assertEqual(self._statuses(online), ["Approved"])
        last = self._history(cheque)[-1]
        self.assertEqual(last[:2], ("Cancelled", "Cleared"))
        self.assertIn(BANK_REVIVAL_NOTE, last[3])
        note = self._line(row).outcome_note
        self.assertIn("was cancelled, but the bank paid it: 1 payment Rejected → Paid", note)
        self.assertIn(f"Check for double payment: {po} has {online} (₹25,000, Approved)", note)
        shown = self._shown(row)["cheque_outcome"]
        self.assertEqual(shown["started"], "Cancelled")
        self.assertEqual([d["payment"] for d in shown["double_payments"]], [online])

    def test_a_cheque_cleared_by_hand_gets_the_line_linked_and_nothing_paid_again(self):
        number = self._number()
        cheque, (a, b) = self._issued(10000, 5000, cheque_no=number)
        earlier = add_days(self.day, -2)
        frappe.db.set_value("Cheques", cheque, "issue_date", earlier, update_modified=False)
        clear(cheque, clearance_date=earlier, user=U)
        frappe.db.commit()
        history_before = self._history(cheque)

        (row,) = self._import((number, 15000))

        self.assertEqual(self._payment_dates(a, b), [earlier, earlier])
        self.assertEqual(self._legs(row), sorted([(a, "cheque number"), (b, "cheque number")]))
        state = self._state(cheque)
        self.assertEqual((state.status, state.cleared_by, state.bank_line), ("Cleared", "By hand", row))
        self.assertEqual(self._history(cheque), history_before)
        self.assertEqual(self._line(row).row_status, "Settled")
        self.assertIn("already cleared by hand: this line is linked", self._line(row).outcome_note)
        self.assertEqual(self._shown(row)["cheque_outcome"]["started"], "Cleared")


class TestALineThatClearsNothing(ChequeImportCase):
    def test_the_number_with_another_amount_settles_nothing_and_shows_the_hint(self):
        number = self._number()
        cheque, (a,) = self._issued(40000, cheque_no=number)

        (row,) = self._import((number, 30000))

        self.assertEqual(self._statuses(a), [RP])
        self.assertEqual(self._state(cheque).status, "Issued")
        self.assertEqual(self._legs(row), [])
        line = self._line(row)
        self.assertEqual(line.row_status, "Mismatched")
        self.assertEqual(
            line.outcome_note,
            f"Cheque {number} found, but its amount is ₹40,000, not ₹30,000. Nothing was settled. Check the "
            "cheque, or match this line by hand.",
        )
        self.assertIsNone(self._shown(row)["cheque_outcome"])

    def test_a_security_deposit_or_old_type_cheque_with_the_number_is_never_matched(self):
        deposit_no, old_no = self._number(), self._number()
        deposit, (a,) = self._issued(20000, cheque_no=deposit_no)
        old, (b,) = self._issued(20000, cheque_no=old_no)
        frappe.db.set_value("Cheques", deposit, "cheque_type", "Security Deposit", update_modified=False)
        frappe.db.set_value("Cheques", old, "old_type", 1, update_modified=False)
        frappe.db.commit()

        first, second = self._import((deposit_no, 20000), (old_no, 20000))

        self.assertEqual(self._statuses(a, b), [RP, RP])
        self.assertEqual([self._state(c).status for c in (deposit, old)], ["Issued", "Issued"])
        self.assertEqual(
            self._line(first).outcome_note,
            f"No Payment cheque {deposit_no} on ICICI Bank. A Security Deposit cheque is never matched. Match "
            "this line by hand.",
        )
        self.assertEqual(self._line(second).row_status, "Mismatched")

    def test_a_credit_carrying_the_cheque_number_is_not_a_cheque_line(self):
        number = self._number()
        cheque, (a,) = self._issued(18000, cheque_no=number)

        (row,) = self._import((number, 18000, "credit"))

        self.assertEqual(self._statuses(a), [RP])
        self.assertEqual(self._state(cheque).status, "Issued")
        self.assertNotEqual(self._line(row).row_status, "Settled")

    def test_a_failure_rolls_the_whole_cheque_back_and_the_line_says_why(self):
        number = self._number()
        cheque, (a, b) = self._issued(9000, 6000, cheque_no=number)

        with patch("nirmaan_stack.services.cheques.status._record_bank_line",
                   side_effect=frappe.ValidationError("the bank line is locked")):
            (row,) = self._import((number, 15000))

        self.assertEqual(self._statuses(a, b), [RP, RP])
        self.assertEqual(self._state(cheque).status, "Issued")
        self.assertEqual(self._legs(row), [])
        line = self._line(row)
        self.assertEqual(line.row_status, "Mismatched")
        self.assertEqual(
            line.outcome_note,
            f"Cheque {number} matches this line but could not be cleared: the bank line is locked. Nothing was "
            "settled.",
        )

    def test_a_pending_cheque_with_a_line_still_waiting_for_its_payment_is_not_cleared(self):
        number = self._number()
        a = self._payment(10000)
        cheque = self._cheque((a, 10000), (None, 5000, frappe.db.get_value(PAYMENT, a, "document_name")))
        frappe.db.set_value("Cheques", cheque, "cheque_no", number, update_modified=False)
        frappe.db.commit()

        (row,) = self._import((number, 15000))

        self.assertEqual(self._statuses(a), ["Requested"])
        self.assertEqual(self._state(cheque).status, "Pending")
        self.assertEqual(self._line(row).row_status, "Mismatched")
        self.assertIn(f"Cheque {number} matches this line but could not be cleared: Line 2", self._line(row).outcome_note)


class TestAClearedChequeStaysCleared(ChequeImportCase):
    def test_unreconciling_the_line_is_refused_and_changes_nothing(self):
        number = self._number()
        cheque, (a,) = self._issued(22000, cheque_no=number)
        (row,) = self._import((number, 22000))

        plan = plan_of_line(row)
        self.assertEqual(plan["refused_count"], 1)
        self.assertIn(f"cheque {number}, which is Cleared", plan["legs"][0]["reason"])
        with self.assertRaisesRegex(frappe.ValidationError, "which is Cleared"):
            unreconcile_line(row, "all", "wrong line", U)
        frappe.db.rollback()

        self.assertEqual(self._statuses(a), ["Paid"])
        self.assertEqual(self._line(row).row_status, "Settled")

    def test_deleting_the_line_is_refused_out_loud(self):
        number = self._number()
        self._issued(11000, cheque_no=number)
        (row,) = self._import((number, 11000))

        with self.assertRaises(frappe.LinkExistsError):
            frappe.delete_doc(ROW, row, ignore_permissions=True)
        frappe.db.rollback()
        self.assertTrue(frappe.db.exists(ROW, row))

    def test_running_the_match_again_changes_nothing(self):
        number = self._number()
        cheque, (a,) = self._issued(13000, cheque_no=number)
        (row,) = self._import((number, 13000))
        history = self._history(cheque)

        match_batch(self.batch)

        self.assertEqual(self._history(cheque), history)
        self.assertEqual(self._legs(row), [(a, "cheque number")])
        self.assertEqual(self._line(row).row_status, "Settled")
