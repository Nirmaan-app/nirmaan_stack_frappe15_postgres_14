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
from nirmaan_stack.api.expenses.cashbook_invoices import attach_cashbook_invoice, get_cashbook_invoice_queue
from nirmaan_stack.api.expenses.expense_bill_approval import (
    approve_expense_bill,
    get_pending_expense_bills,
    reject_expense_bill,
)
from nirmaan_stack.api.expenses.expense_bill_fixture import capture_jobs, purge_expense_bills
from nirmaan_stack.api.expenses.test_cashbook_invoices import PE, CashbookInvoiceCase
from nirmaan_stack.api.expenses.test_expense_bills import NPE, CardBillCase, FakeReader, bills_of, run_reading
from nirmaan_stack.api.outflow_import.test_cashbook_late_bills import LATE, LateBillsCase
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT, ACCOUNTANT_LEAD, OUTSIDER, _Users
from nirmaan_stack.cloud_file_fixture import cloud_url
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
        # Saved through the document layer: a Version of the decision is kept on the bill and on the spend.
        self.assertTrue(frappe.db.exists("Version", {"ref_doctype": BILL, "docname": self.bill, "owner": accountant}))
        self.assertTrue(frappe.db.exists("Version", {"ref_doctype": NPE, "docname": self.spend, "owner": accountant}))

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
        # Raw: the spend has doc_events, but nothing is derived from its invoice fields; a seeded state.
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
        # Raw: the spend has doc_events, but nothing is derived from its invoice fields; a seeded state.
        frappe.db.set_value(NPE, self.spend, {"invoice_ref": "INV-9", "invoice_date": "2026-09-09"})
        frappe.db.commit()
        accountant = self.users.make(ACCOUNTANT)

        with keeping_versions():
            self._as(accountant, reject_expense_bill, self.bill, reason=" Bill of another shop ")

        self.assertEqual(
            frappe.db.get_value(BILL, self.bill, ["status", "rejection_reason", "is_latest", "rejected_by"]),
            ("Rejected", "Bill of another shop", 1, accountant),
        )
        self.assertTrue(frappe.db.get_value(BILL, self.bill, "rejected_on"))
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


class TestTheCreditCardPill(WaitingCardBillCase):
    def _listed(self, user=None) -> dict:
        rows = self._as(user or self.users.make(ACCOUNTANT), get_pending_expense_bills, "card")
        return {r["name"]: r for r in rows}

    def test_a_waiting_card_bill_is_listed_with_what_an_approver_decides_on(self):
        row = self._listed()[self.bill]

        self.assertEqual((row["expense"], row["expense_doctype"]), (self.spend, NPE))
        self.assertEqual(str(row["payment_date"]), "2026-09-10")
        self.assertEqual((float(row["line_amount"]), float(row["read_total"])), (1180.0, 1250.0))
        self.assertEqual(row["bill_check"], "Mismatched")
        self.assertEqual(row["bill_check_reason"], "The bill's total is ₹1,250.00; the statement line is ₹1,180.00.")
        self.assertEqual(row["paid_by"], self.holder)
        self.assertIsNone(row["project"])
        self.assertTrue(row["uploaded_by"])
        self.assertEqual(row["bill_file"], frappe.db.get_value(BILL, self.bill, "bill_file"))
        # A waiting bill carries its (empty) decision record too, as All Invoices' rows do (story 35).
        self.assertEqual(
            (row["approved_by"], row["approved_by_name"], row["approved_on"], row["rejected_by"], row["rejected_by_name"],
             row["rejected_on"]),
            (None, None, None, None, None, None),
        )

    def test_a_mismatched_bill_offers_the_number_and_date_the_accountant_typed(self):
        # A Mismatched bill fills nothing on itself; the approve form starts from what was typed on the Expense.
        # Raw: the spend has doc_events, but nothing is derived from its invoice fields; a seeded state.
        frappe.db.set_value(NPE, self.spend, {"invoice_ref": "TYPED-3", "invoice_date": "2026-09-04"})
        frappe.db.commit()

        row = self._listed()[self.bill]

        self.assertEqual((row["invoice_no"], str(row["invoice_date"])), ("TYPED-3", "2026-09-04"))

    def test_bills_still_being_read_or_already_decided_are_not_listed(self):
        self._as(self.users.make(ACCOUNTANT), reject_expense_bill, self.bill, reason="Blurred photo")
        _, checking = self._attach()

        listed = self._listed()

        self.assertNotIn(self.bill, listed)
        self.assertNotIn(checking, listed)

    def test_someone_outside_admin_and_the_accountant_profiles_cannot_list(self):
        with self.assertRaises(frappe.PermissionError):
            self._listed(self.users.make(OUTSIDER))


class TestTheCashbookPill(CashbookInvoiceCase):
    def setUp(self):
        super().setUp()
        self.accountant = self.users.make(ACCOUNTANT)
        self._as(self.accountant, attach_cashbook_invoice, self.pe, PE, cloud_url("wallet.pdf"))
        self.bill = bills_of(PE, self.pe)[-1].name
        run_reading(self.bill, FakeReader(ReadFailed("The reader timed out.")))

    def test_a_waiting_wallet_bill_is_listed_with_its_wallet_holder_and_project(self):
        rows = {r["name"]: r for r in self._as(self.accountant, get_pending_expense_bills, "cashbook")}

        row = rows[self.bill]
        self.assertEqual((row["expense"], row["expense_doctype"]), (self.pe, PE))
        self.assertEqual((row["bill_check"], row["bill_check_reason"]), ("Not read", "The reader timed out."))
        self.assertIsNone(row["read_total"])
        self.assertEqual(row["paid_by"], self.lines[self.pe].added_by_raw.strip())
        self.assertEqual(row["project"], self.project)
        self.assertEqual(row["project_name"], frappe.db.get_value("Projects", self.project, "project_name"))
        self.assertEqual(row["uploaded_by"], self.accountant)
        # A wallet bill is not on the Credit Card pill.
        self.assertNotIn(self.bill, {r["name"] for r in self._as(self.accountant, get_pending_expense_bills, "card")})

    def test_a_rejected_wallet_spend_waits_in_the_cashbook_tab_with_the_reason(self):
        self._as(self.accountant, reject_expense_bill, self.bill, reason="Partial bill")

        self.assertEqual(self._queue()[self.pe]["last_bill_rejected"], "Partial bill")


class TestALateBillAfterARejection(LateBillsCase):
    def setUp(self):
        super().setUp()
        self.users = _Users()
        self.addCleanup(self.users.purge)
        self.jobs = capture_jobs(self)

    def test_a_later_cashbook_statements_late_bill_refills_a_rejected_expense(self):
        waiting = self._first_upload()
        self.addCleanup(purge_expense_bills, [waiting.name])  # before the batch purge removes the Expense
        accountant = self.users.make(ACCOUNTANT)
        frappe.set_user("Administrator")
        _as(accountant, attach_cashbook_invoice, waiting.name, waiting.doctype, cloud_url("wrong-shop.pdf"))
        bill = bills_of(waiting.doctype, waiting.name)[-1].name
        run_reading(bill, FakeReader(BillRead(Decimal("99999.00"))))
        _as(accountant, reject_expense_bill, bill, reason="Bill of another shop")
        self.assertIn(waiting.name, {row["name"] for row in get_cashbook_invoice_queue()})

        self._upload(self._second_file())

        after = self._expense(LATE)
        self.assertEqual(after.name, waiting.name)
        self.assertTrue(after.invoice_attachment)
        self.assertNotEqual(after.invoice_attachment, cloud_url("wrong-shop.pdf"))
        self.assertNotIn(after.name, {row["name"] for row in get_cashbook_invoice_queue()})


def _as(user, fn, *args, **kwargs):
    frappe.set_user(user)
    try:
        return fn(*args, **kwargs)
    finally:
        frappe.set_user("Administrator")
