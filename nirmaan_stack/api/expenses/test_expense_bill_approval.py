# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Expense bill approval in Vendor Invoice Recon -> Pending Approval (#1644, spec #1637, GLOSSARY *Expense bills*).

DB tests: `DEVENV test --module nirmaan_stack.api.expenses.test_expense_bill_approval`. A bill is attached in a
Pending Invoices Upload tab and read through the replaced reader (`expense_bills.reading.read_bill`), so no test
touches the network; then the Cashbook / Credit Card pills list it, and an approver approves or rejects it.
"""

from datetime import date
from decimal import Decimal
from unittest.mock import patch

import frappe

from nirmaan_stack.api.expenses.card_invoices import mark_card_no_invoice
from nirmaan_stack.api.expenses.expense_bill_approval import approve_expense_bill, reject_expense_bill
from nirmaan_stack.api.expenses.test_expense_bills import NPE, CardBillCase, FakeReader, run_reading
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT, ACCOUNTANT_LEAD, OUTSIDER
from nirmaan_stack.services.expense_bills import BILL_DOCTYPE as BILL
from nirmaan_stack.services.expense_bills.bill_check import BillRead, ReadFailed


def keeping_versions():
    """Frappe keeps no Version under tests (`ignore_version` defaults to `in_test`); this lets one be kept."""
    return patch.dict(frappe.flags, {"in_test": False})


class WaitingCardBillCase(CardBillCase):
    """A card spend whose bill was read Mismatched: it waits in Pending Approval -> Credit Card."""

    def setUp(self):
        super().setUp()
        _, self.bill = self._attach()
        run_reading(self.bill, FakeReader(BillRead(Decimal("1250.00"), "INV-9", date(2026, 9, 9))))


class TestOnlyApproversDecide(WaitingCardBillCase):
    def test_someone_outside_admin_and_the_accountant_profiles_cannot_approve(self):
        outsider = self.users.make(OUTSIDER)

        with self.assertRaises(frappe.PermissionError):
            self._as(outsider, approve_expense_bill, self.bill)

        self.assertEqual(frappe.db.get_value(BILL, self.bill, "status"), "Pending")
        self.assertEqual(frappe.db.get_value(NPE, self.spend, "invoice_ref"), None)


class TestApprove(WaitingCardBillCase):
    def test_approving_with_a_corrected_number_and_date_mirrors_them_onto_the_expense_and_records_who_and_when(self):
        accountant = self.users.make(ACCOUNTANT)

        with keeping_versions():
            self._as(accountant, approve_expense_bill, self.bill, invoice_no=" INV-9A ", invoice_date="2026-09-08")

        bill = frappe.get_doc(BILL, self.bill)
        self.assertEqual((bill.status, bill.auto_approved, bill.approved_by), ("Approved", 0, accountant))
        self.assertTrue(bill.approved_on)
        self.assertEqual((bill.invoice_no, str(bill.invoice_date)), ("INV-9A", "2026-09-08"))
        self.assertEqual(
            frappe.db.get_value(NPE, self.spend, ["invoice_ref", "invoice_date"]), ("INV-9A", date(2026, 9, 8))
        )
        # Saved through the document layer: a Version of the decision is kept.
        self.assertTrue(frappe.db.exists("Version", {"ref_doctype": BILL, "docname": self.bill, "owner": accountant}))

    def test_approving_with_no_correction_keeps_the_number_and_date_the_accountant_typed(self):
        # A Not read bill fills nothing: its own number and date are empty, the Expense's typed ones stand.
        _, typed = self._attach_typed("TYPED-7", "2026-09-05")
        run_reading(typed, FakeReader(ReadFailed("The reader timed out.")))

        self._as(self.users.make(ACCOUNTANT), approve_expense_bill, typed)

        self.assertEqual(
            frappe.db.get_value(BILL, typed, ["status", "invoice_no", "invoice_date"]),
            ("Approved", "TYPED-7", date(2026, 9, 5)),
        )
        self.assertEqual(
            frappe.db.get_value(NPE, self.spend, ["invoice_ref", "invoice_date"]), ("TYPED-7", date(2026, 9, 5))
        )

    def test_a_bill_still_being_read_cannot_be_approved(self):
        _, checking = self._attach_typed(None, None)

        with self.assertRaises(frappe.ValidationError):
            self._as(self.users.make(ACCOUNTANT), approve_expense_bill, checking)

        self.assertEqual(frappe.db.get_value(BILL, checking, "status"), "Pending")

    def _attach_typed(self, invoice_ref, invoice_date):
        """Reject the waiting bill's file off the spend by hand and attach a new one with a typed number and date."""
        frappe.db.set_value(NPE, self.spend, "invoice_attachment", None)
        frappe.db.commit()
        return self._attach(invoice_ref=invoice_ref, invoice_date=invoice_date)


class TestReject(WaitingCardBillCase):
    def test_rejecting_needs_a_reason(self):
        with self.assertRaises(frappe.ValidationError):
            self._as(self.users.make(ACCOUNTANT), reject_expense_bill, self.bill, reason="  ")

        self.assertEqual(frappe.db.get_value(BILL, self.bill, "status"), "Pending")

    def test_someone_outside_admin_and_the_accountant_profiles_cannot_reject(self):
        with self.assertRaises(frappe.PermissionError):
            self._as(self.users.make(OUTSIDER), reject_expense_bill, self.bill, reason="Wrong shop")

        self.assertEqual(frappe.db.get_value(BILL, self.bill, "status"), "Pending")

    def test_rejecting_clears_the_expenses_bill_and_sends_it_back_to_its_queue_with_the_reason(self):
        frappe.db.set_value(NPE, self.spend, {"invoice_ref": "INV-9", "invoice_date": "2026-09-09"})
        frappe.db.commit()
        accountant = self.users.make(ACCOUNTANT)

        with keeping_versions():
            self._as(accountant, reject_expense_bill, self.bill, reason=" Bill of another shop ")

        self.assertEqual(
            frappe.db.get_value(BILL, self.bill, ["status", "rejection_reason", "is_latest"]),
            ("Rejected", "Bill of another shop", 1),
        )
        self.assertEqual(
            frappe.db.get_value(NPE, self.spend, ["invoice_attachment", "invoice_ref", "invoice_date"]),
            (None, None, None),
        )
        row = self._queue()[self.spend]
        self.assertEqual(row["last_bill_rejected"], "Bill of another shop")
        # Both saves went through the document layer.
        self.assertTrue(frappe.db.exists("Version", {"ref_doctype": BILL, "docname": self.bill, "owner": accountant}))
        self.assertTrue(frappe.db.exists("Version", {"ref_doctype": NPE, "docname": self.spend, "owner": accountant}))

    def test_a_rejected_spend_can_still_be_marked_no_invoice_by_an_accountant_lead(self):
        self._as(self.users.make(ACCOUNTANT), reject_expense_bill, self.bill, reason="Blurred photo")

        self._as(self.users.make(ACCOUNTANT_LEAD), mark_card_no_invoice, self.spend, "Toll booth, no bill")

        self.assertTrue(frappe.db.get_value(NPE, self.spend, "no_invoice_by"))
        self.assertNotIn(self.spend, self._queue())

    def test_a_new_bill_on_a_rejected_spend_is_its_latest_and_the_rejection_stays_as_history(self):
        self._as(self.users.make(ACCOUNTANT), reject_expense_bill, self.bill, reason="Blurred photo")

        _, new = self._attach()

        self.assertEqual(frappe.db.get_value(BILL, self.bill, ["status", "is_latest"]), ("Rejected", 0))
        self.assertEqual(frappe.db.get_value(BILL, new, ["bill_check", "is_latest"]), ("Checking", 1))
        self.assertNotIn(self.spend, self._queue())
