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
            frappe.db.set_value(doctype, doc.name, values, update_modified=False)
        self.expenses[doctype].append(doc.name)
        frappe.db.commit()
        return doc.name

    def _match(self, batch, expense, doctype=NPE, *, created=1, kind="Settled", source=CASHBOOK) -> str:
        transfer_id = frappe.db.get_value(doctype, expense, "payment_ref")
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
