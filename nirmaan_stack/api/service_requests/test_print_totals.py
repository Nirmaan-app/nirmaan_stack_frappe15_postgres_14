# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The WO PDF footer's figures come from the server (spec #1528 story 68, review round 3 U1): the printed
rows' value and the total the Work Order has, or, while an amendment is open, the total its accept will store.

Run: DEVENV test --module nirmaan_stack.api.service_requests.test_print_totals

⚠️ RUNS AGAINST THE SITE DATABASE. Rows are planted with the GST Hold fixture (`TEST-GSTH-*`) and purged.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.service_requests.print_totals import get_work_order_print_totals
from nirmaan_stack.api.vendor.test_gst_hold import U, _Fixture

SR = "Service Requests"


class TestPrintTotals(FrappeTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user(U)
        self.fx = _Fixture()
        self.addCleanup(self.fx.purge)
        self.project, self.vendor = self.fx.project(), self.fx.vendor()

    def test_an_approved_work_order_prints_its_stored_total(self):
        wo = self.fx.work_order(self.project, self.vendor, 100_000, gst="true")
        self.assertEqual(get_work_order_print_totals(wo), {"sub_total": 100_000, "total": 118_000})

    def test_under_amendment_it_prints_the_amended_items_total_its_accept_will_store(self):
        wo = self.fx.work_order(self.project, self.vendor, 100_000, gst="true", status="Amendment")
        # The amended rows, written as the amend sheet's save writes them; the stored total stays the old one.
        frappe.db.set_value("Work Order Items", {"parent": wo}, "rate", 120_000)
        frappe.db.commit()
        self.assertEqual(get_work_order_print_totals(wo), {"sub_total": 120_000, "total": 141_600})

    def test_a_user_who_cannot_read_the_work_order_is_refused(self):
        wo = self.fx.work_order(self.project, self.vendor, 1_000)
        frappe.set_user("Guest")
        try:
            with self.assertRaises(frappe.PermissionError):
                get_work_order_print_totals(wo)
        finally:
            frappe.set_user(U)
