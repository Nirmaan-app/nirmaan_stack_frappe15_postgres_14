# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The customer page's "Total Amount Paid" is what the customer's orders were paid: the stored Amount
Paid of every PO and WO on the customer's projects (ADR-0034), never a sum of their payments.

    PO A   PO Approved   Paid payment 400, Received refund 100   -> Amount Paid 300
    PO B   Cancelled     Paid payment 50                         -> Amount Paid 50 (real money out)
    WO W   Approved      Paid payment 200                        -> Amount Paid 200
    plus a Requested payment of 999 and a Rejected one of 777 on PO A, which paid nothing.

Total Amount Paid = 300 + 50 + 200 = 550. Adding up the payments would give 400 + 50 + 200 + 999 + 777.

Fixtures are raw inserts (`db_insert`, no hooks) on a scratch customer, purged after a rollback.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from nirmaan_stack.api.customers.customer_financials import get_customer_financial_details_api

PO = "Procurement Orders"
WO = "Service Requests"


def _raw(doctype, name=None, **fields):
    """Insert a row with only the given fields, skipping every hook and validation."""
    doc = frappe.new_doc(doctype)
    doc.update(fields)
    doc.name = name or f"TEST-1451C-{frappe.generate_hash(length=10)}"
    doc.db_insert()
    return doc.name


class TestCustomerFinancialsPaid(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.C = _raw("Customers", company_name="TEST-1451C-CUSTOMER")
        cls.P = _raw("Projects", project_name="TEST-1451C-PAID", status="WIP", customer=cls.C)
        cls.A = _raw(PO, project=cls.P, status="PO Approved", total_amount=1000, amount_paid=300)
        cls.B = _raw(PO, project=cls.P, status="Cancelled", total_amount=50, amount_paid=50)
        cls.W = _raw(WO, project=cls.P, status="Approved", gst="false", total_amount=500, amount_paid=200)
        for doctype, order, amount, status in (
            (PO, cls.A, 400, "Paid"), (PO, cls.B, 50, "Paid"), (WO, cls.W, 200, "Paid"),
            (PO, cls.A, 999, "Requested"), (PO, cls.A, 777, "Rejected"),
        ):
            _raw("Project Payments", project=cls.P, document_type=doctype, document_name=order, amount=amount,
                 status=status, payment_date="2026-05-10")
        _raw("Vendor Refunds", project=cls.P, document_type=PO, document_name=cls.A, amount=100,
             status="Received", payment_date="2026-06-15")
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        failures = []
        for doctype, field, value in (
            ("Project Payments", "project", cls.P),
            ("Vendor Refunds", "project", cls.P),
            (PO, "project", cls.P),
            (WO, "project", cls.P),
            ("Projects", "name", cls.P),
            ("Customers", "name", cls.C),
        ):
            try:
                frappe.db.delete(doctype, {field: value})
                frappe.db.commit()
            except Exception as error:  # noqa: BLE001 - report every scope, strand none silently
                frappe.db.rollback()
                failures.append(f"{doctype}: {error}")
        super().tearDownClass()
        if failures:
            raise AssertionError(f"test_customer_financials left rows behind: {failures}")

    def test_total_amount_paid_is_the_orders_stored_amount_paid(self):
        totals = get_customer_financial_details_api(self.C)["totals"]
        self.assertEqual(flt(totals["total_amount_paid"], 2), 550.0)
