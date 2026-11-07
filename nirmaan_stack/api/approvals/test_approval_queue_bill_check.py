# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Project Payments -> All Payments shows each Expense's bill and Bill check (#1648, spec #1637, GLOSSARY *Expense
bills*).

DB tests: `DEVENV test --module nirmaan_stack.api.approvals.test_approval_queue_bill_check`. A bill is attached to a
card spend and read through the replaced reader; then the queue (`get_approval_queue`, as All Payments calls it, read
as an Accountant) gives the Expense row its latest bill's file, Bill check and approval. A PO payment row has none:
one payment can cover many invoices.
"""

from datetime import date
from decimal import Decimal

import frappe

from nirmaan_stack.api.approvals.get_approval_queue import get_approval_queue
from nirmaan_stack.api.expenses.expense_bill_approval import reject_expense_bill
from nirmaan_stack.api.expenses.test_expense_bill_list import CardSpendOnTheListCase
from nirmaan_stack.api.expenses.test_expense_bills import FakeReader, run_reading
from nirmaan_stack.api.outflow_import.test_card_import import purge_records
from nirmaan_stack.api.tds.test_submit import _cloud_url
from nirmaan_stack.services.expense_bills.bill_check import BillRead, ReadFailed

PAYMENTS = "Project Payments"


class TestAllPaymentsBillCheck(CardSpendOnTheListCase):
    def setUp(self):
        super().setUp()
        self.payment = f"PAY-TEST-BILL-{frappe.generate_hash(length=8)}"
        # Raw on purpose: a bare Paid PO payment row is all the queue reads; `Project Payments`' validate would
        # demand a real PO, and no derived figure depends on this row.
        frappe.db.sql(
            """INSERT INTO "tabProject Payments" (name, creation, modified, modified_by, owner, docstatus, idx,
                   amount, status, document_type, document_name)
               VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, 20000, 'Paid',
                   'Procurement Orders', 'PO/TEST/BILL/1')""",
            (self.payment,),
        )
        frappe.db.commit()
        self.addCleanup(purge_records, PAYMENTS, [self.payment])

    def _rows(self) -> dict:
        """The queue's rows for this test's records, as the Accountant reads All Payments (no status filter)."""
        result = self._as(
            self.accountant, get_approval_queue,
            filters=[["name", "in", [*self.expenses, self.payment]]], limit_page_length=50,
        )
        return {r["name"]: r for r in result["data"]}

    def test_an_expense_row_shows_its_latest_bill_and_its_bill_check(self):
        _, bill = self._attach()
        run_reading(bill, FakeReader(BillRead(Decimal("1180.40"), "INV-9", date(2026, 9, 9))))

        row = self._rows()[self.spend]

        self.assertEqual(row["invoice"], self.bill_url)
        self.assertEqual((row["bill_check"], row["bill_approval"]), ("Matched", "Auto-approved"))

    def test_a_mismatched_bill_shows_mismatched_and_pending(self):
        _, bill = self._attach()
        run_reading(bill, FakeReader(BillRead(Decimal("1250.00"), "INV-9", date(2026, 9, 9))))

        row = self._rows()[self.spend]

        self.assertEqual((row["bill_check"], row["bill_approval"]), ("Mismatched", "Pending"))

    def test_a_po_payment_row_has_no_invoice_and_no_bill_check(self):
        self._attach()

        row = self._rows()[self.payment]

        self.assertEqual((row["invoice"], row["bill_check"], row["bill_approval"]), ("", None, None))

    def test_an_expense_with_a_bill_but_no_expense_bill_keeps_its_file_and_shows_no_bill_check(self):
        # A bill attached before launch: on the Expense, with no Expense bill record. `set_value` skips the
        # Expense's doc_events on purpose: it is the state such an Expense was left in, with nothing to recompute.
        frappe.db.set_value("Non Project Expenses", self.spend, "invoice_attachment", _cloud_url("old.pdf"))
        frappe.db.commit()

        row = self._rows()[self.spend]

        self.assertEqual(row["invoice"], _cloud_url("old.pdf"))
        self.assertEqual((row["bill_check"], row["bill_approval"]), (None, None))

    def test_a_rejected_bill_leaves_no_invoice_and_shows_rejected(self):
        _, bill = self._attach()
        run_reading(bill, FakeReader(ReadFailed("The reader timed out.")))
        self._as(self.accountant, reject_expense_bill, bill, reason="Wrong shop")

        row = self._rows()[self.spend]

        # The Expense waits for a new bill: nothing to open, and its Bill check says why.
        self.assertEqual(row["invoice"], "")
        self.assertEqual((row["bill_check"], row["bill_approval"]), ("Not read", "Rejected"))
