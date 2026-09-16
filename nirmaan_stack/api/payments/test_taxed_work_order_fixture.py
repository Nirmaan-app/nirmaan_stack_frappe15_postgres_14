# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The shared taxed Work Order payment fixture builds what production builds (#1284).

⚠️ A FIXTURE THAT QUIETLY STOPS REACHING THE TAX CODE IS THE FAILURE THIS SUITE GUARDS. The Bulk Import
and payment-split suites planted payments by raw SQL with no vendor, so no `Payment TDS Deduction` row
ever existed, and both double-TDS bugs in #1283 went unseen. Every later test that leans on this fixture
is only as good as these assertions.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Every row is `TEST-TWO-*` and the fixture's own purge removes it.
"""

import unittest

import frappe
from frappe.utils import flt

from nirmaan_stack.api.payments.taxed_work_order_fixture import (
    DEFAULT_GROSS,
    DEFAULT_RATE,
    PAYMENT,
    TDS,
    TaxedWorkOrderFixture,
)
from nirmaan_stack.services.payment_split import split_payment


class TestTaxedWorkOrderPayment(unittest.TestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.fixture = TaxedWorkOrderFixture.attach(self)

    def test_the_payment_is_an_approved_work_order_payment_with_a_vendor(self):
        made = self.fixture.payment()

        row = frappe.db.get_value(
            PAYMENT, made.name, ["document_type", "document_name", "vendor", "project", "status"],
            as_dict=True,
        )
        self.assertEqual(row.document_type, "Service Requests")
        self.assertEqual(row.document_name, made.service_request)
        self.assertEqual(row.vendor, made.vendor)
        self.assertEqual(row.project, made.project)
        self.assertEqual(row.status, "Approved")
        self.assertEqual(
            flt(frappe.db.get_value("Vendors", made.vendor, "tds_deduction_percentage")), DEFAULT_RATE
        )

    def test_exactly_one_real_tax_row_carries_the_gross(self):
        made = self.fixture.payment()

        self.assertEqual(frappe.db.count(TDS, {"project_payment": made.name}), 1)
        tax = frappe.db.get_value(
            TDS, made.deduction, ["project_payment", "gross_amount", "tds_percentage", "tds_amount"],
            as_dict=True,
        )
        self.assertEqual(tax.project_payment, made.name)
        self.assertEqual(flt(tax.gross_amount), DEFAULT_GROSS)
        self.assertEqual(flt(tax.tds_percentage), DEFAULT_RATE)
        self.assertEqual(flt(tax.tds_amount), 1000.0)
        self.assertEqual(frappe.db.get_value(PAYMENT, made.name, "payment_tds"), made.deduction)

    def test_the_payment_amount_is_netted(self):
        made = self.fixture.payment()

        self.assertEqual(flt(frappe.db.get_value(PAYMENT, made.name, "amount")), 49000.0)
        self.assertEqual((made.gross, made.tds, made.net), (50000.0, 1000.0, 49000.0))

    def test_gross_and_rate_are_the_callers(self):
        """The owner's worked case from `services/payment_tds.py`: 38,550 at 2% nets to 37,779."""
        made = self.fixture.payment(gross=38550, rate=2)
        self.assertEqual(flt(frappe.db.get_value(PAYMENT, made.name, "amount")), 37779.0)
        self.assertEqual(made.tds, 771.0)

        made = self.fixture.payment(gross=10000, rate=3)
        self.assertEqual(flt(frappe.db.get_value(PAYMENT, made.name, "amount")), 9700.0)

    def test_payments_can_share_a_project_and_a_service_request(self):
        first = self.fixture.payment(gross=20000)
        second = self.fixture.payment(
            gross=10000, project=first.project, service_request=first.service_request,
            vendor=first.vendor,
        )
        self.assertEqual(second.project, first.project)
        self.assertEqual(second.service_request, first.service_request)
        self.assertEqual(frappe.db.count(TDS, {"project": first.project}), 2)

    def test_purge_removes_everything_including_what_the_code_under_test_minted(self):
        made = self.fixture.payment()
        # A split's leftover is what a later test's code under test mints; purge must sweep it too.
        child = split_payment(
            made.name, 20000, expect_status="Approved", remainder_status="Approved",
            stamp_ceo_approval=False,
        )["remainder_payment"]
        frappe.db.commit()

        self.fixture.purge()

        self.assertFalse(frappe.db.exists(PAYMENT, made.name))
        self.assertFalse(frappe.db.exists(PAYMENT, child))
        self.assertFalse(frappe.db.exists(TDS, made.deduction))
        self.assertFalse(frappe.db.exists("Service Requests", made.service_request))
        self.assertFalse(frappe.db.exists("Vendors", made.vendor))
        self.assertFalse(frappe.db.exists("Projects", made.project))

    def test_purge_leaves_a_project_it_did_not_create(self):
        other = TaxedWorkOrderFixture()
        borrowed = other.project()
        try:
            self.fixture.payment(project=borrowed)
            self.fixture.purge()
            self.assertTrue(frappe.db.exists("Projects", borrowed))
            self.assertEqual(frappe.db.count(PAYMENT, {"project": borrowed}), 0)
        finally:
            other.purge()
