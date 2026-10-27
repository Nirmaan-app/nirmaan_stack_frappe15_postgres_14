# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The TDS register's WO/PO value columns: the split rule, and the endpoint that reads it.

⚠️ THE ENDPOINT CASES RUN AGAINST THE SITE DATABASE. Everything is `TEST-TWO-*`, purged by
`TaxedWorkOrderFixture`.
"""

import unittest

import frappe

from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.api.payments.tds_register_orders import get_tds_register_order_values
from nirmaan_stack.services.tds_register_orders import purchase_order_value, work_order_value


class TestTheSplitRule(unittest.TestCase):
    def test_a_gst_on_work_order_fills_incl_only(self):
        self.assertEqual(work_order_value("true", 3351.2), {"excl_gst": None, "incl_gst": 3351.2})

    def test_a_gst_off_work_order_fills_excl_only(self):
        self.assertEqual(work_order_value("false", 40000), {"excl_gst": 40000.0, "incl_gst": None})

    def test_a_blank_gst_flag_reads_off(self):
        """`calculate_total_amount` adds no GST on a blank flag, so the total is ex-GST."""
        self.assertEqual(work_order_value(None, 500), {"excl_gst": 500.0, "incl_gst": None})

    def test_a_taxed_purchase_order_fills_incl_with_its_total(self):
        self.assertEqual(purchase_order_value(6800, 1224, 8024), {"excl_gst": None, "incl_gst": 8024.0})

    def test_an_untaxed_purchase_order_fills_excl_with_its_amount(self):
        self.assertEqual(purchase_order_value(2200, 0, 2200), {"excl_gst": 2200.0, "incl_gst": None})


class TestTheRegisterOrderValues(unittest.TestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.fixture = TaxedWorkOrderFixture.attach(self)

    def test_each_taxed_work_order_lands_in_its_gst_column(self):
        project = self.fixture.project()
        vendor = self.fixture.vendor()
        plain = self.fixture.service_request(project, vendor, 100000)
        with_gst = self.fixture.service_request(project, vendor, 118000, gst=True)
        self.fixture.payment(10000, project=project, vendor=vendor, service_request=plain)
        self.fixture.payment(10000, project=project, vendor=vendor, service_request=with_gst)

        values = get_tds_register_order_values()

        self.assertEqual(values[plain], {"excl_gst": 100000.0, "incl_gst": None})
        self.assertEqual(values[with_gst], {"excl_gst": None, "incl_gst": 118000.0})

    def test_an_order_with_no_deduction_is_not_listed(self):
        project = self.fixture.project()
        untaxed = self.fixture.service_request(project, self.fixture.vendor())
        frappe.db.commit()

        self.assertNotIn(untaxed, get_tds_register_order_values())

    def test_a_reader_without_the_register_is_refused(self):
        frappe.set_user("Guest")
        try:
            with self.assertRaises(frappe.PermissionError):
                get_tds_register_order_values()
        finally:
            frappe.set_user("Administrator")
