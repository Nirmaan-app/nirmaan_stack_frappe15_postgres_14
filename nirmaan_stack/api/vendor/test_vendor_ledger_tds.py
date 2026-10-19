# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The Vendor Ledger's Work Order payment rows include the TDS withheld from the vendor (#1512, ADR-0034
Amendment A).

A Work Order's Amount Paid is its Paid payments plus the tax withheld from the vendor on them, so each WO
payment row reads payment + that tax, with "incl. TDS ₹x" in its details, and the ledger closes against
Amount Paid. Tax the company paid on top (`borne_by` Company) was never the vendor's money and adds
nothing. One endpoint (`get_po_ledger_data`) feeds the Vendor page's Ledger tab and, through
`get_vendor_ledger_statement`, the "Vendor Ledger" PDF; both are driven here.

Fixtures are raw inserts (`db_insert`, no hooks) on a scratch vendor, shaped as the approval path leaves
them (a vendor-borne payment stored net, a company-borne one kept whole), purged by vendor in
`tearDownClass`, each scope in its own `try` after a rollback.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from nirmaan_stack.api.vendor.get_vendor_po_invoices import get_po_ledger_data
from nirmaan_stack.api.vendor.vendor_ledger_statement import get_vendor_ledger_statement

PO = "Procurement Orders"
WO = "Service Requests"
PAYMENTS = "Project Payments"
DEDUCTIONS = "Payment TDS Deduction"


def _raw(doctype, name=None, **fields):
    """Insert a row with only the given fields, skipping every hook and validation."""
    doc = frappe.new_doc(doctype)
    doc.update(fields)
    doc.name = name or f"TEST-1512-{frappe.generate_hash(length=10)}"
    doc.db_insert()
    return doc.name


class TestVendorLedgerWorkOrderTds(FrappeTestCase):
    """One vendor, worked out by hand:

    - PO A: invoice 1,000; a Paid 400 on 10-Apr (UTR-1512-P).
    - WO V (vendor-borne): invoice 10,000; a Paid payment of 10,000 gross, 200 withheld, stored net 9,800,
      on 10-May (UTR-1512-V).
    - WO C (company-borne): invoice 800; a Paid 800 kept whole, 16 paid by the company on top, on 10-Jun
      (UTR-1512-C).

    Payments: 400 + 10,000 + 800. Closing (opening 0): 11,800 - 11,200 = 600, the PO's unpaid 600.
    Counting the payments net would leave the withheld 200 as owed: 800.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.V = _raw("Vendors", vendor_name="TEST-1512-VENDOR")
        cls.A = _raw(PO, vendor=cls.V, status="PO Approved", project_name="TEST-1512 Project")
        cls.W_VENDOR = _raw(WO, vendor=cls.V, status="Approved")
        cls.W_COMPANY = _raw(WO, vendor=cls.V, status="Approved")
        for doctype, order, amount in ((PO, cls.A, 1000), (WO, cls.W_VENDOR, 10000), (WO, cls.W_COMPANY, 800)):
            _raw("Vendor Invoices", vendor=cls.V, status="Approved", document_type=doctype, document_name=order,
                 invoice_no=f"INV-{order}", invoice_date="2026-04-05", invoice_amount=amount)
        _raw(PAYMENTS, vendor=cls.V, document_type=PO, document_name=cls.A, amount=400, status="Paid",
             payment_date="2026-04-10", utr="UTR-1512-P")
        for order, net, gross, tds, borne_by, date, utr in (
            (cls.W_VENDOR, 9800, 10000, 200, "Vendor", "2026-05-10", "UTR-1512-V"),
            (cls.W_COMPANY, 800, 800, 16, "Company", "2026-06-10", "UTR-1512-C"),
        ):
            payment = _raw(PAYMENTS, vendor=cls.V, document_type=WO, document_name=order, amount=net,
                           status="Paid", payment_date=date, utr=utr)
            _raw(DEDUCTIONS, project_payment=payment, vendor=cls.V, document_type=WO, document_name=order,
                 gross_amount=gross, tds_percentage=2, tds_amount=tds, borne_by=borne_by, status="Pending")
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        failures = []
        for doctype, field in (
            (DEDUCTIONS, "vendor"),
            (PAYMENTS, "vendor"),
            ("Vendor Invoices", "vendor"),
            (PO, "vendor"),
            (WO, "vendor"),
            ("Vendors", "name"),
        ):
            try:
                frappe.db.delete(doctype, {field: cls.V})
                frappe.db.commit()
            except Exception as error:  # noqa: BLE001 - report every scope, strand none silently
                frappe.db.rollback()
                failures.append(f"{doctype}: {error}")
        super().tearDownClass()
        if failures:
            raise AssertionError(f"test_vendor_ledger_tds left rows behind: {failures}")

    def _payment_rows(self, rows):
        return [
            {key: row[key] for key in ("type", "details", "amount", "payment")}
            for row in rows
            if row["type"] == "Payment Made"
        ]

    def test_a_work_order_payment_row_includes_the_tax_withheld_from_the_vendor(self):
        self.assertEqual(
            self._payment_rows(get_po_ledger_data(self.V)),
            [
                {"type": "Payment Made", "details": f"UTR: UTR-1512-P\nFor PO: {self.A}", "amount": 0,
                 "payment": 400.0},
                {"type": "Payment Made",
                 "details": f"UTR: UTR-1512-V\nFor SR: {self.W_VENDOR}\nincl. TDS ₹200", "amount": 0,
                 "payment": 10000.0},
                {"type": "Payment Made", "details": f"UTR: UTR-1512-C\nFor SR: {self.W_COMPANY}", "amount": 0,
                 "payment": 800.0},
            ],
        )

    def test_the_pdf_statement_carries_the_same_rows_and_closes_without_the_withheld_tax(self):
        statement = get_vendor_ledger_statement(self.V)
        self.assertEqual(
            self._payment_rows(statement["rows"]),
            self._payment_rows(get_po_ledger_data(self.V)),
        )
        self.assertEqual(flt(statement["totals"]["payment"], 2), 11200.0)
        self.assertEqual(flt(statement["closing"], 2), 600.0)
