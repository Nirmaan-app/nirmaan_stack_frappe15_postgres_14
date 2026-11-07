# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""An Expense deleted (an Unreconcile's undo, `outflow_import.unreconcile_created.delete_created`) leaves its Expense
bills as history, out of every queue and list (spec #1637 review; owner, 2026-11-07: an orphan bill is never
deleted).

DB tests: `DEVENV test --module nirmaan_stack.api.expenses.test_expense_bill_orphans`. A card spend with no
statement line (so no live match holds its delete) gets a bill, read Mismatched through the replaced reader; then the
spend is deleted with `force=True`, as Unreconcile deletes one.
"""

from datetime import date
from decimal import Decimal

import frappe

from nirmaan_stack.api.expenses.card_invoices import attach_card_invoice
from nirmaan_stack.api.expenses.expense_bill_fixture import cloud_url
from nirmaan_stack.api.expenses.expense_bill_approval import get_pending_expense_bills
from nirmaan_stack.api.expenses.test_all_expense_bills import _list
from nirmaan_stack.api.expenses.test_expense_bills import NPE, CardBillCase, FakeReader, bills_of, run_reading
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT
from nirmaan_stack.services.expense_bills import BILL_DOCTYPE as BILL
from nirmaan_stack.services.expense_bills.bill_check import BillRead
from nirmaan_stack.services.expense_bills.bill_list import latest_bill_checks


class TestADeletedExpensesBills(CardBillCase):
    def setUp(self):
        super().setUp()
        self.accountant = self.users.make(ACCOUNTANT)
        self.orphaned = self._expense(self.statement, serno="70000000008", amount=640)
        self._as(self.accountant, attach_card_invoice, self.orphaned, cloud_url("orphan.pdf"))
        self.bill = bills_of(NPE, self.orphaned)[-1].name
        run_reading(self.bill, FakeReader(BillRead(Decimal("700.00"), "INV-O", date(2026, 9, 9))))
        self.assertIn(self.bill, self._pending())
        frappe.delete_doc(NPE, self.orphaned, force=True, ignore_permissions=True)
        frappe.db.commit()

    def _pending(self) -> set:
        return {r["name"] for r in self._as(self.accountant, get_pending_expense_bills, "card")}

    def test_they_stay_as_history_no_longer_latest(self):
        self.assertFalse(frappe.db.exists(NPE, self.orphaned))
        self.assertEqual(
            frappe.db.get_value(BILL, self.bill, ["expense", "is_latest", "status", "bill_check"]),
            (self.orphaned, 0, "Pending", "Mismatched"),
        )

    def test_the_approval_queue_all_invoices_and_the_expense_lists_ignore_them(self):
        self.assertNotIn(self.bill, self._pending())
        self.assertNotIn(self.bill, {r["name"] for r in self._as(self.accountant, _list, "card")["data"]})
        self.assertEqual(latest_bill_checks(NPE, [self.orphaned]), {})
