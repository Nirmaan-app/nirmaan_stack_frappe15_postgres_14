# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A bill the Cashbook import copies in is approved on arrival (#1755, spec #1753 stories 60-70).

Seam 2 of the spec: a bill arriving through the Cashbook import job, run inline with the bill download
(`cashbook_bills.fetch_bill`) and the reader (`expense_bills.reading.read_bill`) replaced; read back as the bill
list and the Cashbook approval tab read it.

Run: DEVENV test --module nirmaan_stack.api.outflow_import.test_cashbook_bill_approval
"""

from datetime import date
from decimal import Decimal

import frappe

from nirmaan_stack.api.expenses.cashbook_invoices import attach_cashbook_invoice
from nirmaan_stack.api.expenses.expense_bill_approval import get_pending_expense_bills
from nirmaan_stack.api.expenses.test_expense_bill_approval import _as
from nirmaan_stack.api.expenses.test_expense_bills import FakeReader, bills_of, run_reading
from nirmaan_stack.api.outflow_import.test_cashbook_bills import NO_LINK, ONE_LINK, CashbookBillsCase
from nirmaan_stack.api.outflow_import.test_cashbook_expense_bills import _line_amount
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT, _Users
from nirmaan_stack.cloud_file_fixture import cloud_url
from nirmaan_stack.services.expense_bills.bill_check import BillRead


class TestAnImportBillIsApprovedOnArrival(CashbookBillsCase):
    def test_an_import_bill_read_mismatched_stays_approved_and_keeps_its_verdict_and_remark(self):
        self._run()
        expense = self._expense(ONE_LINK)
        (bill,) = bills_of(expense.doctype, expense.name)
        self.assertEqual(
            (bill.status, bill.auto_approved, bill.approved_by, bill.bill_check), ("Approved", 1, "System", "Checking")
        )
        self.assertTrue(bill.approved_on)

        run_reading(bill.name, FakeReader(BillRead(total=_line_amount(expense) + 50, invoice_no="IMP-1")))

        (bill,) = bills_of(expense.doctype, expense.name)
        self.assertEqual((bill.status, bill.auto_approved, bill.approved_by), ("Approved", 1, "System"))
        self.assertEqual(bill.bill_check, "Mismatched")
        self.assertIn("The bill's total is", bill.bill_check_reason)
        self.assertEqual(Decimal(str(bill.read_total)), _line_amount(expense) + 50)

    def test_a_matched_import_bill_fills_its_own_and_its_expenses_invoice_number_and_date(self):
        self._run()
        expense = self._expense(ONE_LINK)
        (bill,) = bills_of(expense.doctype, expense.name)

        reader = FakeReader(BillRead(total=_line_amount(expense), invoice_no="IMP-2", invoice_date=date(2026, 9, 3)))
        run_reading(bill.name, reader)

        (bill,) = bills_of(expense.doctype, expense.name)
        self.assertEqual((bill.status, bill.auto_approved, bill.bill_check), ("Approved", 1, "Matched"))
        self.assertEqual((bill.invoice_no, bill.invoice_date), ("IMP-2", date(2026, 9, 3)))
        self.assertEqual(
            frappe.db.get_value(expense.doctype, expense.name, ["invoice_ref", "invoice_date"]),
            ("IMP-2", date(2026, 9, 3)),
        )


class TestOnlyAPersonsUploadWaitsForApproval(CashbookBillsCase):
    def setUp(self):
        super().setUp()
        self.users = _Users()
        self.addCleanup(self.users.purge)

    def test_the_cashbook_tab_lists_a_persons_upload_and_not_the_imports_copy(self):
        self._run()
        imported = self._expense(ONE_LINK)
        (import_bill,) = bills_of(imported.doctype, imported.name)
        run_reading(import_bill.name, FakeReader(BillRead(total=_line_amount(imported) + 50)))

        waiting = self._expense(NO_LINK)
        accountant = self.users.make(ACCOUNTANT)
        _as(accountant, attach_cashbook_invoice, waiting.name, waiting.doctype, cloud_url("person-upload.pdf"))
        (upload,) = bills_of(waiting.doctype, waiting.name)
        self.assertEqual((upload.status, upload.auto_approved, upload.approved_by), ("Pending", 0, None))
        run_reading(upload.name, FakeReader(BillRead(total=_line_amount(waiting) + 50)))

        listed = {row["name"] for row in _as(accountant, get_pending_expense_bills, "cashbook")}

        self.assertIn(upload.name, listed)
        self.assertNotIn(import_bill.name, listed)
