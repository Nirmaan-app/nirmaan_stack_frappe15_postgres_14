# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The bills the Cashbook import copies get the Bill check (#1641, spec #1637 stories 6, 8, 15, 16).

Seam: the Cashbook job run inline (`cashbook._cashbook_worker`, and the two-upload endpoints for a late bill), with
both transports replaced: the bill download (`cashbook_bills.fetch_bill`) and the reader
(`expense_bills.reading.read_bill`). `frappe.enqueue` is captured (`expense_bill_fixture.capture_jobs`): each
captured reading is then run inline, as the `long` queue would run it.

Run: DEVENV test --module nirmaan_stack.api.outflow_import.test_cashbook_expense_bills
"""

from decimal import Decimal
from unittest.mock import patch

import frappe

from nirmaan_stack.api.expenses.test_expense_bills import FakeReader, bills_of, readings_queued, run_reading
from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import import cashbook_bills as bills
from nirmaan_stack.api.outflow_import.test_cashbook_bills import FOUR_LINKS, ONE_LINK, CashbookBillsCase, _fake_bills
from nirmaan_stack.api.outflow_import.test_cashbook_late_bills import LATE, LateBillsCase
from nirmaan_stack.services.expense_bills.bill_check import BillRead


def _line_amount(expense) -> Decimal:
    return Decimal(str(expense.amount)).quantize(Decimal("0.01"))


class TestACopiedBillIsChecked(CashbookBillsCase):
    def test_a_created_line_with_one_bill_gets_a_checking_expense_bill_whose_reading_then_matches(self):
        self._run()
        expense = self._expense(ONE_LINK)

        (bill,) = bills_of(expense.doctype, expense.name)
        self.assertEqual((bill.bill_check, bill.status, bill.is_latest), ("Checking", "Pending", 1))
        self.assertEqual(bill.bill_file, expense.invoice_attachment)
        self.assertEqual(bill.uploaded_by, "Administrator")
        self.assertIn(("long", bill.name), readings_queued(self.jobs))

        reader = FakeReader(BillRead(total=_line_amount(expense), invoice_no="WALLET-1"))
        run_reading(bill.name, reader)
        (bill,) = bills_of(expense.doctype, expense.name)
        self.assertEqual((bill.bill_check, bill.status, bill.auto_approved), ("Matched", "Approved", 1))
        self.assertEqual(frappe.db.get_value(expense.doctype, expense.name, "invoice_ref"), "WALLET-1")


class TestASpendWithSeveralBillsIsNotChecked(CashbookBillsCase):
    def test_four_bill_links_make_a_pending_not_checked_bill_whose_total_is_the_line_amount_and_nothing_is_read(self):
        self._run()
        expense = self._expense(FOUR_LINKS)

        (bill,) = bills_of(expense.doctype, expense.name)
        self.assertEqual((bill.bill_check, bill.status, bill.auto_approved), ("Not checked", "Pending", 0))
        self.assertEqual(Decimal(str(bill.invoice_amount)), _line_amount(expense))
        self.assertEqual((bill.invoice_no, bill.invoice_date), (None, None))
        self.assertEqual(bill.bill_file, expense.invoice_attachment)
        self.assertEqual(readings_queued(self.jobs).count(("long", bill.name)), 0)
        # Even a reading job run for it by mistake reads nothing: it is not Checking.
        reader = FakeReader(BillRead(total=Decimal("1")))
        run_reading(bill.name, reader)
        self.assertEqual(reader.files, [])
        self.assertEqual(bills_of(expense.doctype, expense.name)[0].bill_check, "Not checked")
