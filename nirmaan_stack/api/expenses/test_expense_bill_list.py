# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Bill check on the Project Expenses and Non-Project Expenses lists (#1640, spec #1637, GLOSSARY *Expense bills*).

DB tests: `DEVENV test --module nirmaan_stack.api.expenses.test_expense_bill_list`. A bill is attached in a Pending
Invoices Upload tab and read through the replaced reader (`expense_bills.reading.read_bill`); then the lists' endpoint
(`api/data-table.get_list_with_count_enhanced`, as the list pages call it) shows the Expense's latest bill's Bill
check and approval, and filters by them with server-side paging.
"""

import json
from datetime import date
from decimal import Decimal

import frappe

from nirmaan_stack.api.data_table.search import get_list_with_count_enhanced_impl
from nirmaan_stack.api.expenses.test_expense_bills import NPE, CardBillCase, FakeReader, run_reading
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT
from nirmaan_stack.services.expense_bills.bill_check import BillRead

LIST_FIELDS = ["name", "amount", "bill_check", "bill_approval"]


class CardSpendOnTheListCase(CardBillCase):
    """A card spend whose bill is attached; the Non-Project Expenses list read as an Accountant."""

    def setUp(self):
        super().setUp()
        self.accountant = self.users.make(ACCOUNTANT)
        # `_Users` sets the profile only; the list reads through Frappe's permissions, which need the role.
        frappe.get_doc("User", self.accountant).add_roles("Nirmaan Accountant")
        frappe.db.commit()

    def _list(self, *filters, doctype=NPE, start=0, page=50) -> dict:
        """The list's page, scoped to this test's Expenses, as the Accountant reads it: {"rows", "total"}."""
        result = self._as(
            self.accountant, get_list_with_count_enhanced_impl,
            doctype=doctype, fields=json.dumps(LIST_FIELDS),
            filters=json.dumps([["name", "in", self.expenses], *filters]),
            order_by="name asc", limit_start=start, limit_page_length=page,
        )
        return {"rows": {r["name"]: r for r in result["data"]}, "total": result["total_count"]}


class TestTheBillCheckColumn(CardSpendOnTheListCase):
    def test_a_mismatched_bill_shows_mismatched_and_pending(self):
        _, bill = self._attach()
        run_reading(bill, FakeReader(BillRead(Decimal("1250.00"), "INV-9", date(2026, 9, 9))))

        row = self._list()["rows"][self.spend]

        self.assertEqual((row["bill_check"], row["bill_approval"]), ("Mismatched", "Pending"))
