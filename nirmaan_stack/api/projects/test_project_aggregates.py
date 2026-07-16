# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for the projects financial rollup + the per-document invoice totals.

Locks in the byte-identical aggregation math (the load-bearing filters: PO NOT IN
(Merged,Inactive), SR = Approved, Payments/Expenses = Paid, Expenses grouped by the
`projects` plural link field, per-PO min() for liabilities, credit terms, and the
Vendor-Invoice Pending+Approved reconciliation scope) so a future edit that breaks a
number fails here.

Fixtures use `db_insert()` to bypass controller hooks (before_insert / after_insert) and
mandatory-field validation — we only need the exact fields each aggregate reads, not a
fully-valid business document.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from nirmaan_stack.api.projects.project_aggregates import get_projects_financial_rollup
from nirmaan_stack.api.invoices.get_vendor_invoice_totals import (
    get_invoice_totals_by_document,
)


def _raw(doctype, name=None, **fields):
    """Insert a row with only the given fields, skipping ALL hooks/validation."""
    d = frappe.new_doc(doctype)
    d.update(fields)
    d.name = name or frappe.generate_hash(length=12)
    d.db_insert()
    return d.name


class TestProjectFinancialRollup(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.P = "TEST-PROJ-" + frappe.generate_hash(length=8)
        _raw("Projects", name=cls.P, project_name=cls.P)

        # total_project_invoiced = 100 + 400 = 500
        _raw("Project Invoices", project=cls.P, amount=100)
        _raw("Project Invoices", project=cls.P, amount=400)
        # inflow = 200 + 100 = 300
        _raw("Project Inflows", project=cls.P, amount=200)
        _raw("Project Inflows", project=cls.P, amount=100)
        # outflow payments: Paid-only -> 50 (Requested 999 excluded)
        _raw("Project Payments", project=cls.P, amount=50, status="Paid")
        _raw("Project Payments", project=cls.P, amount=999, status="Requested")
        # outflow expenses: link field is `projects` (plural), Paid-only -> 30
        _raw("Project Expenses", projects=cls.P, amount=30, status="Paid")
        _raw("Project Expenses", projects=cls.P, amount=888, status="Requested")
        # po_wo SR part: Approved-only -> 200
        _raw("Service Requests", project=cls.P, total_amount=200, status="Approved")
        _raw("Service Requests", project=cls.P, total_amount=777, status="Vendor Selected")

        # Live PO: total 1000, delivered 400, paid 600 -> po_wo += 1000;
        #   liabilities += 400 - min(600, 400) = 0
        cls.PO = "TEST-PO-" + frappe.generate_hash(length=8)
        _raw("Procurement Orders", name=cls.PO, project=cls.P, status="PO Approved",
             total_amount=1000, po_amount_delivered=400, amount_paid=600)
        # a Credit term (Paid) on that PO -> credit_purchase 300, credit_paid 300
        _raw("PO Payment Terms", parent=cls.PO, parenttype="Procurement Orders",
             parentfield="payment_terms", idx=1, payment_type="Credit",
             amount=300, term_status="Paid")

        # Merged PO — must be EXCLUDED from po_wo AND liabilities.
        _raw("Procurement Orders", project=cls.P, status="Merged",
             total_amount=5000, po_amount_delivered=5000, amount_paid=0)

        # Vendor invoices: Pending 100 + Approved 200 for cls.PO (Rejected 999 excluded).
        _raw("Vendor Invoices", document_type="Procurement Orders",
             document_name=cls.PO, invoice_amount=100, status="Pending")
        _raw("Vendor Invoices", document_type="Procurement Orders",
             document_name=cls.PO, invoice_amount=200, status="Approved")
        _raw("Vendor Invoices", document_type="Procurement Orders",
             document_name=cls.PO, invoice_amount=999, status="Rejected")
        frappe.db.commit()

    def test_rollup_seven_values(self):
        r = get_projects_financial_rollup().get(self.P)
        self.assertIsNotNone(r, "project missing from rollup")
        self.assertAlmostEqual(flt(r["total_project_invoiced"]), 500)
        self.assertAlmostEqual(flt(r["po_wo_amount"]), 1200)  # 1000 PO + 200 Approved SR
        self.assertAlmostEqual(flt(r["inflow"]), 300)
        self.assertAlmostEqual(flt(r["outflow"]), 80)  # 50 paid payment + 30 paid expense
        self.assertAlmostEqual(flt(r["liabilities"]), 0)  # 400 - min(600, 400)
        self.assertAlmostEqual(flt(r["total_credit_purchase"]), 300)
        self.assertAlmostEqual(flt(r["total_credit_paid"]), 300)

    def test_merged_and_status_filters_excluded(self):
        r = get_projects_financial_rollup().get(self.P)
        # Merged PO's 5000 must not leak into po_wo or liabilities; non-Paid / non-Approved
        # rows must not leak into outflow / po_wo.
        self.assertAlmostEqual(flt(r["po_wo_amount"]), 1200)
        self.assertAlmostEqual(flt(r["liabilities"]), 0)
        self.assertAlmostEqual(flt(r["outflow"]), 80)

    def test_invoice_totals_pending_plus_approved(self):
        m = get_invoice_totals_by_document()["message"]
        key = f"Procurement Orders|{self.PO}"
        self.assertIn(key, m)
        self.assertAlmostEqual(flt(m[key]), 300)  # 100 Pending + 200 Approved; Rejected excluded

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("Project Invoices", {"project": cls.P})
        frappe.db.delete("Project Inflows", {"project": cls.P})
        frappe.db.delete("Project Payments", {"project": cls.P})
        frappe.db.delete("Project Expenses", {"projects": cls.P})
        frappe.db.delete("Service Requests", {"project": cls.P})
        frappe.db.delete("PO Payment Terms", {"parent": cls.PO})
        frappe.db.delete("Vendor Invoices", {"document_name": cls.PO})
        frappe.db.delete("Procurement Orders", {"project": cls.P})
        frappe.db.delete("Projects", {"name": cls.P})
        frappe.db.commit()
        super().tearDownClass()
