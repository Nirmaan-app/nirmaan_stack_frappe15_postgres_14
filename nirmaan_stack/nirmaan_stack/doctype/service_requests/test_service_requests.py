# Copyright (c) 2024, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""GST Applicable set from the vendor's GST number at first approval (owner, 19/09/2026).

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
