# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The one-off patch that brings this financial year's older Cashbook Expenses into the Cashbook queue (#1649).

Each test builds its Expenses, import lines and match records by hand, as an import made before #1592 left them
(a Settled, import-created match; no marker), and runs the patch scoped to those Expenses, so the env's own data
is never touched.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Every Expense, batch, line and match this suite makes is purged.
"""

import unittest

import frappe

from nirmaan_stack.api.expenses.cashbook_invoices import get_cashbook_invoice_queue
from nirmaan_stack.api.outflow_import.internal_transfer_fixture import purge_imports
from nirmaan_stack.api.outflow_import.test_card_import import purge_records
from nirmaan_stack.api.outflow_import.upload import BATCH_DOCTYPE, ROW_DOCTYPE
from nirmaan_stack.patches.v3_0.mark_this_year_cashbook_expenses import mark_cashbook_expenses

PE = "Project Expenses"
NPE = "Non Project Expenses"
CASHBOOK = "Cashbook"
CARD = "ICICI Credit Card Statement"
THIS_YEAR = "2026-05-12"
LAST_YEAR = "2026-03-31"


class CashbookMarkerPatchCase(unittest.TestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.batches = []
        self.expenses = {PE: [], NPE: []}
        self.addCleanup(self._purge)

    def _purge(self):
        frappe.db.rollback()
        frappe.set_user("Administrator")
        for doctype, names in self.expenses.items():
            purge_records(doctype, names)
        purge_imports(self.batches, suite="cashbook marker patch test purge")

    def _batch(self, source=CASHBOOK) -> str:
        doc = frappe.new_doc(BATCH_DOCTYPE)
        doc.update({"source": source, "status": "Completed"})
        doc.insert(ignore_permissions=True)
        self.batches.append(doc.name)
        return doc.name

    def _expense(self, doctype=NPE, *, date=THIS_YEAR, **values) -> str:
        doc = frappe.get_doc(
            {
                "doctype": doctype,
                "type": frappe.db.get_value("Expense Type", {"project": 1 if doctype == PE else 0}, "name"),
                "status": "Paid",
                "amount": 120,
                "payment_date": date,
                "payment_ref": f"TESTTXN{frappe.generate_hash(length=10)}",
                "description": "Made-up wallet spend",
            }
        ).insert(ignore_permissions=True)
        if values:
            # A raw write on a fixture: it sets the state a past import or a person left (a marker, a bill, a
            # No invoice mark); no hook of the Expense derives anything from these fields.
            frappe.db.set_value(doctype, doc.name, values, update_modified=False)
        self.expenses[doctype].append(doc.name)
        frappe.db.commit()
        return doc.name

    def _match(self, batch, expense, doctype=NPE, *, created=1, kind="Settled", source=CASHBOOK, transfer_id=None):
        transfer_id = transfer_id or frappe.db.get_value(doctype, expense, "payment_ref")
        line = frappe.new_doc(ROW_DOCTYPE)
        line.update(
            {
                "import_batch": batch,
                "source": source,
                "transfer_id": transfer_id,
                "bank_reference_no": transfer_id,
                "amount": 120,
                "status_raw": "SUCCESS",
                "direction": "Debit",
                "row_status": "Settled",
                "remarks": "Made-up tea and snacks",
                "added_by_raw": "Test Wallet Holder",
                "added_on": "2026-05-12 10:00:00",
            }
        )
        line.insert(ignore_permissions=True)
        match = frappe.new_doc("Outflow Row Match")
        match.update(
            {
                "import_row": line.name,
                "import_batch": batch,
                "transfer_id": transfer_id,
                "target_doctype": doctype,
                "target_name": expense,
                "target_amount": 120,
                "match_kind": kind,
                "match_basis": "Manual",
                "created_by_import": created,
                "source": source,
            }
        )
        match.db_insert()
        frappe.db.commit()
        return line.name

    def _marker(self, expense, doctype=NPE):
        return frappe.db.get_value(doctype, expense, "cashbook_batch")

    def _run(self):
        report = mark_cashbook_expenses(expenses=self.expenses)
        frappe.db.commit()
        return report


class TestThisYearsCashbookExpensesAreMarked(CashbookMarkerPatchCase):
    def test_a_cashbook_made_expense_dated_this_year_gets_its_batch_and_waits_in_the_queue(self):
        batch = self._batch()
        npe = self._expense(NPE)
        pe = self._expense(PE)
        self._match(batch, npe, NPE)
        self._match(batch, pe, PE)
        self.assertNotIn(npe, {r["name"] for r in get_cashbook_invoice_queue()})

        self._run()

        self.assertEqual(self._marker(npe, NPE), batch)
        self.assertEqual(self._marker(pe, PE), batch)
        listed = {r["name"]: r for r in get_cashbook_invoice_queue()}
        self.assertEqual(listed[npe]["doctype"], NPE)
        self.assertEqual(listed[pe]["doctype"], PE)
        # The queue reads who paid from the import line the marker names.
        self.assertEqual(listed[npe]["paid_by"], "Test Wallet Holder")


class TestEveryOtherExpenseIsUntouched(CashbookMarkerPatchCase):
    def test_last_year_hand_keyed_a_link_a_reversed_match_and_other_sources_keep_no_marker(self):
        cashbook, card, cashfree = self._batch(), self._batch(CARD), self._batch("Cashfree")
        last_year = self._expense(date=LAST_YEAR)
        self._match(cashbook, last_year)
        hand_keyed = self._expense()
        linked = self._expense()
        self._match(cashbook, linked, created=0)
        reversed_ = self._expense()
        self._match(cashbook, reversed_, kind="Reversed")
        card_spend = self._expense()
        self._match(card, card_spend, source=CARD)
        cashfree_spend = self._expense(PE)
        self._match(cashfree, cashfree_spend, PE, source="Cashfree")

        report = self._run()

        for name in (last_year, hand_keyed, linked, reversed_, card_spend):
            with self.subTest(expense=name):
                self.assertIsNone(self._marker(name))
        self.assertIsNone(self._marker(cashfree_spend, PE))
        self.assertEqual(report.marked, {PE: 0, NPE: 0})
        self.assertEqual(self._run().marked, {PE: 0, NPE: 0})


class TestAMarkerIsKeptAndASecondRunChangesNothing(CashbookMarkerPatchCase):
    def test_an_expense_with_a_marker_keeps_it(self):
        old, other = self._batch(), self._batch()
        expense = self._expense(cashbook_batch=other)
        self._match(old, expense)

        report = self._run()

        self.assertEqual(self._marker(expense), other)
        self.assertEqual(report.marked[NPE], 0)

    def test_a_second_run_marks_nothing(self):
        batch = self._batch()
        expense = self._expense()
        self._match(batch, expense)
        self.assertEqual(self._run().marked[NPE], 1)

        again = self._run()

        self.assertEqual(again.marked, {PE: 0, NPE: 0})
        self.assertEqual(self._marker(expense), batch)


class TestItPrintsWhatItMarkedAndWhatWaits(CashbookMarkerPatchCase):
    def test_counts_per_ledger_and_the_ones_with_a_bill_or_no_invoice_do_not_wait(self):
        batch = self._batch()
        waits_pe, waits_npe = self._expense(PE), self._expense(NPE)
        billed = self._expense(NPE, invoice_attachment="/private/files/test-made-up-bill.pdf")
        no_bill = self._expense(NPE, no_invoice_by="Administrator")
        for name, doctype in ((waits_pe, PE), (waits_npe, NPE), (billed, NPE), (no_bill, NPE)):
            self._match(batch, name, doctype)

        report = self._run()

        self.assertEqual(report.marked, {PE: 1, NPE: 3})
        self.assertEqual(report.waiting, {PE: 1, NPE: 1})
        self.assertEqual(
            report.text(),
            "Project Expenses: marked 1, of them waiting in the Cashbook queue 1\n"
            "Non Project Expenses: marked 3, of them waiting in the Cashbook queue 1",
        )
        listed = {r["name"] for r in get_cashbook_invoice_queue()}
        self.assertTrue({waits_pe, waits_npe} <= listed)
        self.assertFalse({billed, no_bill} & listed)

        again = self._run()

        self.assertEqual((again.marked, again.waiting), ({PE: 0, NPE: 0}, {PE: 0, NPE: 0}))
        self.assertEqual({r["name"] for r in get_cashbook_invoice_queue()} & set(self.expenses[PE] + self.expenses[NPE]),
                         {waits_pe, waits_npe})


class TestTwoImportCreatedMatchesStopIt(CashbookMarkerPatchCase):
    def test_an_expense_two_cashbook_lines_created_is_named_and_nothing_is_marked(self):
        first, second = self._batch(), self._batch()
        fine = self._expense()
        self._match(first, fine)
        doubled = self._expense()
        self._match(first, doubled)
        # The index allows one import-created Expense per Txn Id, so only a second Txn Id can make this.
        self._match(second, doubled, transfer_id=f"TESTTXN{frappe.generate_hash(length=10)}")

        with self.assertRaisesRegex(frappe.ValidationError, doubled):
            self._run()

        frappe.db.rollback()
        self.assertIsNone(self._marker(fine))
        self.assertIsNone(self._marker(doubled))
