# Copyright (c) 2024, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""GST Applicable set from the vendor's GST number at first approval (owner, 19/09/2026), and the GST
flag guard: GST cannot be switched off while a GST payment exists (ADR-0030, #1343).

Run:  bench --site localhost run-tests --module nirmaan_stack.nirmaan_stack.doctype.service_requests.test_service_requests

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Rows are planted with the GST Hold test fixture (`TEST-GSTH-*`)
and purged after each test. The approval notifications hook is patched out: it inserts a Nirmaan
Notification per real Procurement / Accountant / Admin user and commits each one.
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from nirmaan_stack.api.vendor.test_gst_hold import U, _Fixture

SR = "Service Requests"
NOTIFY_ON_UPDATE = "nirmaan_stack.integrations.controllers.service_requests.on_update"


class TestGstFromVendorOnApproval(FrappeTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user(U)
        self.fx = _Fixture()
        self.addCleanup(self.fx.purge)
        self.project = self.fx.project()

    def _approve(self, vendor, *, gst="true"):
        """Plant a Vendor Selected WO of Rs 1,00,000 and approve it with a real save."""
        name = self.fx.work_order(self.project, vendor, 100_000, gst=gst, status="Vendor Selected")
        doc = frappe.get_doc(SR, name)
        doc.status = "Approved"
        with patch(NOTIFY_ON_UPDATE):
            doc.save()
        return frappe.db.get_value(SR, name, ["gst", "total_amount"], as_dict=True)

    def test_a_vendor_with_a_gst_number_is_approved_gst_on(self):
        sr = self._approve(self.fx.vendor(gst_number="29AADCU7527Q1ZG"), gst="false")
        self.assertEqual((sr.gst, flt(sr.total_amount)), ("true", 118_000))

    def test_a_vendor_without_a_gst_number_is_approved_gst_off(self):
        sr = self._approve(self.fx.vendor())
        self.assertEqual((sr.gst, flt(sr.total_amount)), ("false", 100_000))

    def test_a_blank_gst_number_counts_as_none(self):
        sr = self._approve(self.fx.vendor(gst_number="   "))
        self.assertEqual(sr.gst, "false")

    def test_amendment_approval_leaves_gst_alone(self):
        v = self.fx.vendor(gst_number="29AADCU7527Q1ZG")
        name = self.fx.work_order(self.project, v, 100_000, gst="false", status="Amendment")
        doc = frappe.get_doc(SR, name)
        doc.status = "Approved"
        with patch(NOTIFY_ON_UPDATE):
            doc.save()
        self.assertEqual(frappe.db.get_value(SR, name, "gst"), "false")


class TestGstCannotBeSwitchedOffWithGstPayments(FrappeTestCase):
    """GST flag guard (ADR-0030 decision 6, #1343): off is refused while a GST payment exists."""

    def setUp(self):
        super().setUp()
        frappe.set_user(U)
        self.fx = _Fixture()
        self.addCleanup(self.fx.purge)
        # Runs before the purge (cleanups are LIFO), so its commit never keeps a planted payment.
        self.addCleanup(lambda: frappe.db.delete("Project Payments", {"document_name": ("in", self.fx.srs)}))
        self.project = self.fx.project()
        self.vendor = self.fx.vendor(gst_number="29AADCU7527Q1ZG")

    def _wo(self, *, gst="true", status="Approved"):
        return self.fx.work_order(self.project, self.vendor, 100_000, gst=gst, status=status)

    def _pay(self, wo, *, gst_payment, status="Approved", amount=1_000):
        doc = frappe.new_doc("Project Payments")
        doc.update({
            "document_type": SR, "document_name": wo, "project": self.project, "vendor": self.vendor,
            "amount": amount, "status": status, "is_gst_payment": 1 if gst_payment else 0,
        })
        doc.name = f"TEST-GSTH-PAY-{frappe.generate_hash(length=8)}"
        doc.db_insert()  # no payment hooks: only the row's existence matters here
        return doc.name

    def _switch(self, wo, gst, **changes):
        doc = frappe.get_doc(SR, wo)
        doc.gst = gst
        doc.update(changes)
        with patch(NOTIFY_ON_UPDATE):
            doc.save()
        return frappe.db.get_value(SR, wo, ["gst", "total_amount"], as_dict=True)

    def test_off_is_refused_and_names_every_gst_payment(self):
        wo = self._wo()
        paid = self._pay(wo, gst_payment=True, status="Paid")
        rejected = self._pay(wo, gst_payment=True, status="Rejected")  # Rejected still counts until deleted
        base = self._pay(wo, gst_payment=False)

        with self.assertRaises(frappe.ValidationError) as cm:
            self._switch(wo, "false")
        message = str(cm.exception)
        self.assertIn(paid, message)
        self.assertIn(rejected, message)
        self.assertNotIn(base, message)
        self.assertEqual(frappe.db.get_value(SR, wo, "gst"), "true")

    def test_off_is_refused_through_an_amendment_too(self):
        wo = self._wo()
        self._pay(wo, gst_payment=True)
        with self.assertRaises(frappe.ValidationError):
            self._switch(wo, "false", status="Amendment")

    def test_off_with_only_base_payments_works(self):
        wo = self._wo()
        self._pay(wo, gst_payment=False, status="Paid")
        sr = self._switch(wo, "false")
        self.assertEqual((sr.gst, flt(sr.total_amount)), ("false", 100_000))

    def test_off_with_no_payments_works(self):
        sr = self._switch(self._wo(), "false")
        self.assertEqual(sr.gst, "false")

    def test_off_works_once_the_gst_payment_is_deleted(self):
        wo = self._wo()
        pay = self._pay(wo, gst_payment=True)
        frappe.db.delete("Project Payments", {"name": pay})
        self.assertEqual(self._switch(wo, "false").gst, "false")

    def test_on_is_never_refused(self):
        wo = self._wo(gst="false")
        self._pay(wo, gst_payment=True)
        sr = self._switch(wo, "true")
        self.assertEqual((sr.gst, flt(sr.total_amount)), ("true", 118_000))

    def test_a_save_that_leaves_gst_off_is_not_refused(self):
        wo = self._wo(gst="false")
        self._pay(wo, gst_payment=True)
        self.assertEqual(self._switch(wo, "false", project_gst="29ABFCS9095N1Z9").gst, "false")
