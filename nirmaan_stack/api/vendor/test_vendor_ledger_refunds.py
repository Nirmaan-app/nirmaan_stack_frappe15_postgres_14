# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The Vendor Ledger lists Received Vendor Refunds as minus payments (#1460, ADR-0034 point 4).

One endpoint (`get_po_ledger_data`) feeds the Vendor page's Ledger tab and, through
`get_vendor_ledger_statement`, the "Vendor Ledger" PDF; both are driven here.

Fixtures are raw inserts (`db_insert`, no hooks) on a scratch vendor, purged by vendor in `tearDownClass`,
each scope in its own `try` after a rollback.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from nirmaan_stack.api.vendor.get_vendor_po_invoices import get_po_ledger_data
from nirmaan_stack.api.vendor.vendor_ledger_statement import get_vendor_ledger_statement

PO = "Procurement Orders"
WO = "Service Requests"


def _raw(doctype, name=None, **fields):
    """Insert a row with only the given fields, skipping every hook and validation."""
    doc = frappe.new_doc(doctype)
    doc.update(fields)
    doc.name = name or f"TEST-1460-{frappe.generate_hash(length=10)}"
    doc.db_insert()
    return doc.name


class TestVendorLedgerRefunds(FrappeTestCase):
    """One vendor, worked out by hand:

    - PO A: an approved invoice of 1,000 on 05-Apr and a Paid payment of 400 on 10-Apr.
    - A Received refund of 100 on 15-Jun against A (UTR UTR-1460-A).
    - WO W: a Received refund of 50 on 01-Jul with no bank line ("No bank proof", no UTR).
    - A waiting 30 and a Cancelled 20 against A: neither is bank-proven money, so neither shows.

    Closing balance (opening 0): 1,000 - 400 + 100 + 50 = 750.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.V = _raw("Vendors", vendor_name="TEST-1460-VENDOR")
        cls.A = _raw(PO, vendor=cls.V, status="PO Approved", project_name="TEST-1460 Project")
        cls.W = _raw(WO, vendor=cls.V, status="Approved")
        _raw("Vendor Invoices", vendor=cls.V, status="Approved", document_type=PO, document_name=cls.A,
             invoice_no="INV-1460", invoice_date="2026-04-05", invoice_amount=1000)
        _raw("Project Payments", vendor=cls.V, document_type=PO, document_name=cls.A, amount=400,
             status="Paid", payment_date="2026-04-10", utr="UTR-1460-P")
        cls.R_PO = _raw("Vendor Refunds", vendor=cls.V, document_type=PO, document_name=cls.A, amount=100,
                        status="Received", payment_date="2026-06-15", utr="UTR-1460-A")
        cls.R_WO = _raw("Vendor Refunds", vendor=cls.V, document_type=WO, document_name=cls.W, amount=50,
                        status="Received", payment_date="2026-07-01", no_bank_line=1)
        _raw("Vendor Refunds", vendor=cls.V, document_type=PO, document_name=cls.A, amount=30,
             status="Reconciliation Pending", payment_date="2026-06-20")
        _raw("Vendor Refunds", vendor=cls.V, document_type=PO, document_name=cls.A, amount=20,
             status="Cancelled", payment_date="2026-06-21")
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        failures = []
        for doctype, field in (
            ("Project Payments", "vendor"),
            ("Vendor Refunds", "vendor"),
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
            raise AssertionError(f"test_vendor_ledger_refunds left rows behind: {failures}")

    def _refund_rows(self, rows):
        return [
            {key: row[key] for key in ("type", "date", "details", "amount", "payment", "project")}
            for row in rows
            if row["type"] == "Refund Received"
        ]

    def test_received_refunds_are_minus_rows_on_their_own_date(self):
        self.assertEqual(
            self._refund_rows(get_po_ledger_data(self.V)),
            [
                {
                    "type": "Refund Received",
                    "date": "2026-06-15 00:00:00",
                    "details": f"Refund: {self.R_PO}\nUTR: UTR-1460-A\nFor PO: {self.A}",
                    "amount": 0,
                    "payment": -100.0,
                    "project": "TEST-1460 Project",
                },
                {
                    "type": "Refund Received",
                    "date": "2026-07-01 00:00:00",
                    "details": f"Refund: {self.R_WO}\nUTR: No bank proof\nFor SR: {self.W}",
                    "amount": 0,
                    "payment": -50.0,
                    "project": "N/A",
                },
            ],
        )

    def test_the_pdf_statement_carries_the_same_refund_rows_and_closing(self):
        statement = get_vendor_ledger_statement(self.V)
        self.assertEqual(
            self._refund_rows(statement["rows"]),
            self._refund_rows(get_po_ledger_data(self.V)),
        )
        self.assertEqual(flt(statement["closing"], 2), 750.0)
