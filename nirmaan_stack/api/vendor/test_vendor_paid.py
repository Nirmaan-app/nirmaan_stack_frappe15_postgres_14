# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""What reached each vendor in a date range: the Vendor report's dated paid figures (#1461, ADR-0034).

The Amount Paid rule, dated: a vendor's Paid payments on PO / Work Orders by their payment date, less its
Received Vendor Refunds by the refund's own date. Waiting and Cancelled refunds, and payments not yet Paid,
count for nothing.

Fixtures are raw inserts (`db_insert`, no hooks) on a scratch vendor, purged by vendor in `tearDownClass`,
each scope in its own `try` after a rollback.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from nirmaan_stack.api.vendor.vendor_paid import get_vendors_paid

PO = "Procurement Orders"
WO = "Service Requests"


def _raw(doctype, name=None, **fields):
    """Insert a row with only the given fields, skipping every hook and validation."""
    doc = frappe.new_doc(doctype)
    doc.update(fields)
    doc.name = name or f"TEST-1461-{frappe.generate_hash(length=10)}"
    doc.db_insert()
    return doc.name


class TestVendorsPaid(FrappeTestCase):
    """One vendor, worked out by hand:

    - PO A: a Paid 400 on 10-Apr, a Requested 5,000 and a Reconciliation Pending 900 (neither counts).
    - WO W: a Paid 300 on 10-May.
    - A Received refund of 100 on 15-Jun against A; a waiting 50 and a Cancelled 30 (neither counts).

    All time: 400 + 300 - 100 = 600.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.V = _raw("Vendors", vendor_name="TEST-1461-VENDOR")
        cls.A = _raw(PO, vendor=cls.V, status="PO Approved")
        cls.W = _raw(WO, vendor=cls.V, status="Approved")
        for doctype, order, amount, status, date in (
            (PO, cls.A, 400, "Paid", "2026-04-10"),
            (WO, cls.W, 300, "Paid", "2026-05-10"),
            (PO, cls.A, 5000, "Requested", "2026-05-11"),
            (PO, cls.A, 900, "Reconciliation Pending", "2026-05-12"),
        ):
            _raw("Project Payments", vendor=cls.V, document_type=doctype, document_name=order, amount=amount,
                 status=status, payment_date=date)
        for amount, status, date in (
            (100, "Received", "2026-06-15"),
            (50, "Reconciliation Pending", "2026-05-20"),
            (30, "Cancelled", "2026-05-21"),
        ):
            _raw("Vendor Refunds", vendor=cls.V, document_type=PO, document_name=cls.A, amount=amount,
                 status=status, payment_date=date)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        failures = []
        for doctype, field in (
            ("Project Payments", "vendor"),
            ("Vendor Refunds", "vendor"),
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
            raise AssertionError(f"test_vendor_paid left rows behind: {failures}")

    def _paid(self, **dates):
        return flt(get_vendors_paid(**dates).get(self.V, 0), 2)

    def test_all_time_is_payments_less_received_refunds(self):
        self.assertEqual(self._paid(), 600.0)

    def test_a_refund_counts_on_its_own_date(self):
        # April-May: both payments, not the 15-Jun refund on the same PO.
        self.assertEqual(self._paid(from_date="2026-04-01", to_date="2026-05-31"), 700.0)
        # June alone: only the refund.
        self.assertEqual(self._paid(from_date="2026-06-01", to_date="2026-06-30"), -100.0)
        # From May on, open-ended: the WO payment less the refund.
        self.assertEqual(self._paid(from_date="2026-05-01"), 200.0)

    def test_a_reader_without_payment_access_is_refused(self):
        frappe.set_user("Guest")
        try:
            with self.assertRaises(frappe.PermissionError):
                get_vendors_paid()
        finally:
            frappe.set_user("Administrator")


class TestVendorsPaidCountWorkOrderTds(FrappeTestCase):
    """A Work Order payment counts the TDS withheld from the vendor on it, on the payment's date (#1512,
    ADR-0034 Amendment A); tax the company paid on top counts nothing. One vendor, by hand:

    - WO W: Paid 9,800 net (10,000 gross, 200 withheld) on 10-May-2026, in FY 2026-27.
    - WO W: Paid 4,900 net (5,000 gross, 100 withheld) on 10-Mar-2026, in FY 2025-26.
    - WO C: Paid 800 kept whole, 16 paid by the company on top, on 10-Jun-2026.
    - WO W: an Approved 2,450 net with 50 withheld: not Paid, so neither counts.

    FY 2026-27: 10,000 + 800 = 10,800. FY 2025-26: 5,000. All time: 15,800.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.V = _raw("Vendors", vendor_name="TEST-1512-VENDOR-PAID")
        cls.W = _raw(WO, vendor=cls.V, status="Approved")
        cls.C = _raw(WO, vendor=cls.V, status="Approved")
        for order, net, gross, tds, borne_by, status, date in (
            (cls.W, 9800, 10000, 200, "Vendor", "Paid", "2026-05-10"),
            (cls.W, 4900, 5000, 100, "Vendor", "Paid", "2026-03-10"),
            (cls.C, 800, 800, 16, "Company", "Paid", "2026-06-10"),
            (cls.W, 2450, 2500, 50, "Vendor", "Approved", "2026-05-20"),
        ):
            payment = _raw("Project Payments", vendor=cls.V, document_type=WO, document_name=order, amount=net,
                           status=status, payment_date=date)
            _raw("Payment TDS Deduction", project_payment=payment, vendor=cls.V, document_type=WO,
                 document_name=order, gross_amount=gross, tds_percentage=2, tds_amount=tds, borne_by=borne_by,
                 status="Pending")
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        failures = []
        for doctype, field in (
            ("Payment TDS Deduction", "vendor"),
            ("Project Payments", "vendor"),
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
            raise AssertionError(f"test_vendor_paid left rows behind: {failures}")

    def _paid(self, **dates):
        return flt(get_vendors_paid(**dates).get(self.V, 0), 2)

    def test_current_fy_paid_counts_the_withheld_tax_of_a_payment_dated_in_the_year(self):
        self.assertEqual(self._paid(from_date="2026-04-01", to_date="2027-03-31"), 10800.0)

    def test_the_tax_of_a_payment_dated_outside_the_year_counts_in_that_payments_year(self):
        self.assertEqual(self._paid(from_date="2025-04-01", to_date="2026-03-31"), 5000.0)

    def test_all_time_is_the_work_orders_amount_paid_added_up(self):
        self.assertEqual(self._paid(), 15800.0)
