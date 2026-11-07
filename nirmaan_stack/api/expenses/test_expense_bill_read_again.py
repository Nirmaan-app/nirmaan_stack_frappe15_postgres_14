# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Read again on a Not read Expense bill in Pending Approval -> Cashbook / Credit Card (#1645, spec #1637,
GLOSSARY *Expense bills*).

DB tests: `DEVENV test --module nirmaan_stack.api.expenses.test_expense_bill_read_again`. A card bill is attached and
read Not read through the replaced reader (`expense_bills.reading.read_bill`), so no test touches the network, and
`frappe.enqueue` is captured: the queue is shared with the main bench.
"""

from decimal import Decimal

import frappe

from nirmaan_stack.api.expenses.expense_bill_approval import read_expense_bill_again
from nirmaan_stack.api.expenses.test_expense_bills import CardBillCase, FakeReader, readings_queued, run_reading
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT_LEAD
from nirmaan_stack.services.expense_bills import BILL_DOCTYPE as BILL
from nirmaan_stack.services.expense_bills.bill_check import ReadFailed


class NotReadCardBillCase(CardBillCase):
    """A card spend whose bill could not be read: it waits in Pending Approval -> Credit Card as Not read."""

    def setUp(self):
        super().setUp()
        _, self.bill = self._attach()
        run_reading(self.bill, FakeReader(ReadFailed("The reader failed (ClientError).")))
        self.jobs.clear()


class TestReadAgain(NotReadCardBillCase):
    def test_an_accountant_lead_puts_a_not_read_bill_back_to_checking_and_its_reading_is_queued(self):
        self._as(self.users.make(ACCOUNTANT_LEAD), read_expense_bill_again, self.bill)

        self.assertEqual(
            frappe.db.get_value(BILL, self.bill, ["bill_check", "bill_check_reason", "read_claimed_at"]),
            ("Checking", None, None),
        )
        self.assertEqual(readings_queued(self.jobs), [("long", self.bill)])
