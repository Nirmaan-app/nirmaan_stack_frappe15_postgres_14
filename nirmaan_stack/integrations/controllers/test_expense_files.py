# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""An expense never owns a File for a Porter invoice's shared PDF (spec #1442 story 52; #1548, spec #1528 story 95).

The refusal is a `File` `before_insert` hook. `hooks.py` once held two `"File"` keys in one dict, so the later
one (the dev cloud-upload switch) replaced it and the refusal never ran. Each test acts as an Accountant
saving an expense, or as Frappe's attach hook inserting the File, and checks what is stored.

Run: DEVENV test --module nirmaan_stack.integrations.controllers.test_expense_files

⚠️ RUNS AGAINST THE SITE DATABASE. The Porter Invoice, the expense, the Expense Type, the Files and the
test user are removed after each test.
"""

from io import BytesIO

import frappe
from frappe.tests.utils import FrappeTestCase
from pypdf import PdfWriter

from nirmaan_stack.api.expense_requests.test_expense_requests import _make_user
from nirmaan_stack.integrations.controllers.expense_files import INVOICE_PDF_COPY_REFUSAL

NPE = "Non Project Expenses"
PORTER_INVOICE = "Porter Invoice"
ACCOUNTANT = "test-expense-files-accountant@example.com"


def _pdf(title: str) -> bytes:
    """A real one-page PDF (Frappe reads every uploaded PDF), told apart from others by its title."""
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.add_metadata({"/Title": title})
    out = BytesIO()
    writer.write(out)
    return out.getvalue()


class TestTheInvoicePdfIsNeverCopiedOntoAnExpense(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        _make_user(ACCOUNTANT, "Nirmaan Accountant Profile", ("Nirmaan Accountant",))
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        for doctype in ("Nirmaan Users", "User"):
            if frappe.db.exists(doctype, ACCOUNTANT):
                frappe.delete_doc(doctype, ACCOUNTANT, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDownClass()

    def setUp(self):
        frappe.set_user("Administrator")
        self.expenses = []
        self.addCleanup(self._purge)
        self.tag = frappe.generate_hash(length=8)
        self.invoice = f"TEST-EXPF-{self.tag}"
        frappe.get_doc({"doctype": PORTER_INVOICE, "invoice_number": self.invoice}).db_insert()
        self.pdf = self._file(PORTER_INVOICE, self.invoice, _pdf(f"porter invoice {self.tag}"))
        frappe.db.set_value(PORTER_INVOICE, self.invoice, "invoice_file", self.pdf.file_url)
        self.expense_type = frappe.get_doc({
            "doctype": "Expense Type", "expense_name": f"test expense files {self.tag}",
            "non_project": 1, "expense_category": "Uncategorized",
        }).insert(ignore_permissions=True).name
        frappe.db.commit()

    def _purge(self):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        files = frappe.get_all("File", filters={"attached_to_name": ("in", [self.invoice, *self.expenses])},
                               pluck="name")
        for name in files:
            frappe.delete_doc("File", name, force=True, ignore_permissions=True)
        frappe.db.delete(NPE, {"name": ("in", self.expenses or [""])})
        frappe.db.delete(PORTER_INVOICE, {"name": self.invoice})
        frappe.db.delete("Expense Type", {"name": self.expense_type})
        frappe.db.commit()

    def _file(self, doctype, name, content, **fields):
        return frappe.get_doc({
            "doctype": "File", "file_name": f"expf-{self.tag}.pdf", "content": content, "is_private": 1,
            "attached_to_doctype": doctype, "attached_to_name": name, **fields,
        }).insert(ignore_permissions=True)

    def _save_expense(self, **fields):
        """Record a non-project expense as the Accountant, the way the expense dialog saves one."""
        frappe.set_user(ACCOUNTANT)
        try:
            doc = frappe.get_doc({
                "doctype": NPE, "type": self.expense_type, "amount": 100,
                "description": f"test expense files {self.tag}", **fields,
            }).insert()
        finally:
            frappe.set_user("Administrator")
        self.expenses.append(doc.name)
        frappe.db.commit()
        return doc

    def _files_of(self, expense):
        return frappe.get_all("File", filters={"attached_to_doctype": NPE, "attached_to_name": expense.name},
                              pluck="file_url")

    def test_saving_an_expense_that_carries_the_invoice_pdf_gives_it_no_file_of_its_own(self):
        expense = self._save_expense(invoice_attachment=self.pdf.file_url)

        self.assertEqual(frappe.db.get_value(NPE, expense.name, "invoice_attachment"), self.pdf.file_url)
        self.assertEqual(self._files_of(expense), [])
        self.assertEqual(
            frappe.get_all("File", filters={"file_url": self.pdf.file_url}, pluck="attached_to_doctype"),
            [PORTER_INVOICE],
        )

    def test_a_file_copying_the_invoice_pdf_onto_an_expense_is_refused(self):
        expense = self._save_expense()

        with self.assertRaises(frappe.ValidationError) as refused:
            frappe.get_doc({
                "doctype": "File", "file_url": self.pdf.file_url, "is_private": 1,
                "attached_to_doctype": NPE, "attached_to_name": expense.name,
                "attached_to_field": "invoice_attachment",
            }).insert(ignore_permissions=True)

        self.assertIn(INVOICE_PDF_COPY_REFUSAL, str(refused.exception))

    def test_an_expense_keeps_a_pdf_of_its_own(self):
        expense = self._save_expense()

        own = self._file(NPE, expense.name, _pdf(f"a bill of its own {self.tag}"))

        self.assertEqual(self._files_of(expense), [own.file_url])
