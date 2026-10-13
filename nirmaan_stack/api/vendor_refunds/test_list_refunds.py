# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""`get_vendor_refunds` -- the per-document read, and that it is permission-aware.

⚠️ RUNS AGAINST THE LIVE SITE DB. The two refunds it inserts are deleted, with their Version rows, in
`tearDownClass`. The PO one lowers a real PAID PO's `amount_paid`, and the raw delete runs no hook, so
that PO's stored paid figures are captured first and written back exactly as found -- and so is its
vendor's credit, which each refund save recounts (#1398).
"""

import unittest

import frappe

from nirmaan_stack.api.vendor_refunds import credit_fixture
from nirmaan_stack.api.vendor_refunds.list_refunds import get_vendor_refunds

VENDOR_REFUNDS = "Vendor Refunds"


class TestGetVendorRefunds(unittest.TestCase):
    refunds: list = []

    @classmethod
    def setUpClass(cls):
        frappe.set_user("Administrator")
        cls.refunds = []
        po = frappe.db.sql(
            """
            SELECT name, vendor, project FROM "tabProcurement Orders"
            WHERE status <> 'Merged' AND amount_paid >= 1000
              AND vendor IS NOT NULL AND project IS NOT NULL
            ORDER BY name LIMIT 1
            """,
            as_dict=True,
        )[0]
        cls.po = po
        cls.po_figures = frappe.db.get_value(
            "Procurement Orders", po.name, ["amount_paid", "amount_due", "modified", "modified_by"], as_dict=True
        )
        cls.credit = credit_fixture.snapshot([po.vendor])
        for document_type, document_name, amount, description, status in (
            ("Procurement Orders", po.name, 10, None, "Reconciliation Pending"),
            ("Misc. Expense", None, 5, "test: list_refunds misc", "Received"),
        ):
            doc = frappe.get_doc(
                {
                    "doctype": VENDOR_REFUNDS,
                    "vendor": po.vendor,
                    "project": po.project,
                    "document_type": document_type,
                    "document_name": document_name,
                    "amount": amount,
                    "description": description,
                    "payment_date": frappe.utils.today(),
                    "status": status,
                }
            ).insert(ignore_permissions=True)
            cls.refunds.append(doc.name)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        if cls.refunds:
            frappe.db.delete(VENDOR_REFUNDS, {"name": ["in", cls.refunds]})
            frappe.db.delete("Version", {"ref_doctype": VENDOR_REFUNDS, "docname": ["in", cls.refunds]})
            frappe.db.set_value("Procurement Orders", cls.po.name, cls.po_figures, update_modified=False)
            credit_fixture.restore(cls.credit)
            frappe.db.commit()

    def test_a_po_lists_only_the_refunds_against_it(self):
        rows = get_vendor_refunds(document_type="Procurement Orders", document_name=self.po.name)
        names = [r["name"] for r in rows]
        self.assertIn(self.refunds[0], names)
        self.assertNotIn(self.refunds[1], names)
        for row in rows:
            self.assertEqual((row["document_type"], row["document_name"]), ("Procurement Orders", self.po.name))
            self.assertEqual(row["project"], self.po.project)

    def test_each_row_says_its_status(self):
        rows = get_vendor_refunds(document_type="Procurement Orders", document_name=self.po.name)
        status = {r["name"]: r["status"] for r in rows}
        self.assertEqual(status[self.refunds[0]], "Reconciliation Pending")

    def test_it_needs_a_po_or_wo(self):
        with self.assertRaises(frappe.ValidationError):
            get_vendor_refunds()
        with self.assertRaises(frappe.ValidationError):
            get_vendor_refunds(document_type="Misc. Expense", document_name="X")
        with self.assertRaises(frappe.ValidationError):
            get_vendor_refunds(document_type="Project Expenses", document_name="X")

    def test_someone_without_read_permission_is_refused(self):
        frappe.set_user("Guest")
        try:
            with self.assertRaises(frappe.PermissionError):
                get_vendor_refunds(document_type="Procurement Orders", document_name=self.po.name)
        finally:
            frappe.set_user("Administrator")
