# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The patch that gives each Collect payment left open before #1708 its Expense
(`patches/v3_0/create_open_collect_payment_expenses`).

Seam: the patch's `create_open_collect_payment_expenses`, scoped to this test's lines, on lines staged as the import
before #1708 left them (a Collect payment open at `Mismatched`, one with its bill stored on the line).
Run: DEVENV test --module nirmaan_stack.api.outflow_import.test_open_collect_payments_patch
"""

import frappe

from nirmaan_stack.api.expenses.cashbook_invoices import get_cashbook_invoice_queue
from nirmaan_stack.api.outflow_import.test_cashbook_bills import PORTRAIT_JPEG
from nirmaan_stack.api.outflow_import.test_cashbook_collect_payments import (
    COLLECT_NO_LINK,
    COLLECT_PAID_BY,
    COLLECT_WITH_LINK,
    CollectPaymentCase,
)
from nirmaan_stack.patches.v3_0.create_open_collect_payment_expenses import create_open_collect_payment_expenses
from nirmaan_stack.services.stored_files import store_file

HIGHLIGHT = "Shop-requested payment, check it."


class OpenCollectPaymentCase(CollectPaymentCase):
    def setUp(self):
        super().setUp()
        self.lines = [self._line(txn).name for txn in (COLLECT_WITH_LINK, COLLECT_NO_LINK)]
        for line in self.lines:
            # As the import left an open Collect payment before #1708 (`cashbook_lines.line_values`, ACTION_OPEN).
            frappe.db.set_value(
                "Outflow Import Row",
                line,
                {"row_status": "Mismatched", "outcome_note": HIGHLIGHT, "match_basis": None, "auto_matched": 0},
                update_modified=False,
            )
        saved = store_file(fname="bill.jpeg", content=PORTRAIT_JPEG, dt="Outflow Import Row", dn=self.lines[0],
                           df="stored_bill", is_private=1)
        frappe.db.set_value("Outflow Import Row", self.lines[0], "stored_bill", saved.file_url, update_modified=False)
        self.stored = saved.file_url
        frappe.db.commit()

    def _patch(self):
        return create_open_collect_payment_expenses(lines=self.lines)


class TestThePatchCreatesEachOpenCollectPayment(OpenCollectPaymentCase):
    def test_each_open_line_gets_its_expense_as_the_job_writes_one(self):
        report = self._patch()
        self.assertEqual(report.created, {"Project Expenses": 0, "Non Project Expenses": 2})
        for txn in (COLLECT_WITH_LINK, COLLECT_NO_LINK):
            with self.subTest(txn=txn):
                line = self._line(txn)
                self.assertEqual((line.row_status, line.match_basis, line.auto_matched), ("Settled", "cashbook remark", 1))
                expense = self._expense_of(txn)
                self.assertEqual(line.suggested_name, expense.name)
                self.assertEqual((expense.cashbook_batch, expense.payment_ref), (self.batch, txn + self.suffix))

    def test_a_stored_bill_becomes_its_invoice_and_one_without_waits_in_the_cashbook_tab(self):
        self._patch()
        with_bill, without = self._expense_of(COLLECT_WITH_LINK), self._expense_of(COLLECT_NO_LINK)
        self.assertEqual(with_bill.invoice_attachment, self.stored)
        self.assertEqual(
            frappe.db.get_value("Expense Bill", {"expense": with_bill.name, "is_latest": 1}, "bill_file"), self.stored
        )
        self.assertFalse(without.invoice_attachment)
        waiting = {row["name"]: row for row in get_cashbook_invoice_queue()}
        self.assertNotIn(with_bill.name, waiting)
        self.assertEqual(waiting[without.name]["paid_by"], COLLECT_PAID_BY)

    def test_a_second_run_writes_nothing(self):
        self._patch()
        report = self._patch()
        self.assertEqual(sum(report.created.values()), 0)
        for txn in (COLLECT_WITH_LINK, COLLECT_NO_LINK):
            self.assertEqual(len(self._expenses_of(txn)), 1)

    def test_a_line_someone_decided_by_hand_is_left_alone(self):
        # An Unreconcile leaves the line open with its "Confirm by hand" mark; a hand decision names who made it.
        frappe.db.set_value("Outflow Import Row", self.lines[0], "confirm_by_hand", 1, update_modified=False)
        frappe.db.set_value("Outflow Import Row", self.lines[1], "decided_by", "someone@example.com",
                            update_modified=False)
        frappe.db.commit()
        report = self._patch()
        self.assertEqual(sum(report.created.values()), 0)
        for txn in (COLLECT_WITH_LINK, COLLECT_NO_LINK):
            self.assertEqual((self._line(txn).row_status, self._expenses_of(txn)), ("Mismatched", []))
