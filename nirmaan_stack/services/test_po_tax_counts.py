# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The vendor's tax recorded on a PO's Paid payments counts in its Amount Paid, as a Work Order's does
(#1534, ADR-0034 Amendment B).

Worked by hand: a PO worth ₹1,18,000, paid ₹1,00,000 on which ₹100 TDS was recorded for the vendor.

  * The old shape (86 payments on 2026-10-08): the payment is stored at the gross ₹1,00,000 with the legacy
    `tds` box filled in. Its tax is inside its amount, so every figure reads ₹1,00,000, never ₹1,00,100.
  * Netted (after `patches/v3_0/net_po_payments_with_tds`): stored ₹99,900, the box cleared. The ₹100 is
    counted on top: Amount Paid, the Vendor Ledger row, the Vendor report, project outflow, the payment
    summary and the request limit all still read ₹1,00,000, and Amount Due stays ₹18,000.

Taking a deduction stays Work-Order-only: approving a PO payment withholds nothing.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from nirmaan_stack.api.payments.payment_summary import get_payment_summary
from nirmaan_stack.api.payments.project_payments import create_payment_request_for_service
from nirmaan_stack.api.payments.taxed_po_fixture import PO, TaxedPoFixture
from nirmaan_stack.api.payments.work_order_tds import get_order_payment_tds
from nirmaan_stack.api.vendor.get_vendor_po_invoices import get_po_ledger_data
from nirmaan_stack.services.amount_paid import write_amount_paid
from nirmaan_stack.services.amount_paid_drift import mismatches
from nirmaan_stack.services.project_money import project_money_of
from nirmaan_stack.services.vendor_paid import vendors_paid


class PoTaxFixture(FrappeTestCase):
    PREFIX = "TEST-1534"

    def setUp(self):
        frappe.set_user("Administrator")
        self.fx = TaxedPoFixture(self.PREFIX)
        self.po = self.fx.po(value=118000, paid=100000)

    def tearDown(self):
        frappe.set_user("Administrator")
        self.fx.purge()

    def ledger_payment_rows(self):
        return [(r["payment"], "incl. TDS" in r["details"]) for r in get_po_ledger_data(self.fx.vendor)
                if r["type"] == "Payment Made"]

    def vendor_report_paid(self):
        return flt(vendors_paid().get(self.fx.vendor), 2)


class TheOldShape(PoTaxFixture):
    """Stored gross, legacy box filled, tax record beside it: the tax is inside the amount."""

    def setUp(self):
        super().setUp()
        self.payment = self.fx.old_payment(self.po, gross=100000, tds=100)

    def test_the_vendor_ledger_row_and_the_vendor_report_read_the_payment_amount(self):
        self.assertEqual(self.ledger_payment_rows(), [(100000.0, False)])
        self.assertEqual(self.vendor_report_paid(), 100000.0)

    def test_the_mismatch_report_finds_the_po_right(self):
        self.assertEqual(mismatches(PO, [self.po]), [])


class TheNettedShape(PoTaxFixture):
    """Stored net, box cleared: the ₹100 is counted on top, so every figure still reads ₹1,00,000."""

    def setUp(self):
        super().setUp()
        self.payment = self.fx.netted_payment(self.po, gross=100000, tds=100)

    def test_the_vendor_ledger_row_and_the_vendor_report_read_the_gross(self):
        self.assertEqual(self.ledger_payment_rows(), [(100000.0, True)])
        self.assertEqual(self.vendor_report_paid(), 100000.0)

    def test_the_mismatch_report_finds_the_po_right_at_the_gross(self):
        self.assertEqual(mismatches(PO, [self.po]), [])

    def test_a_recount_keeps_amount_paid_at_the_gross_and_amount_due_unchanged(self):
        write_amount_paid(PO, self.po)

        self.assertEqual(
            frappe.db.get_value(PO, self.po, ["amount_paid", "amount_due"]), (100000.0, 18000.0)
        )

    def test_project_outflow_counts_the_po_payment_at_the_gross(self):
        self.assertEqual(flt(project_money_of(self.fx.project).po_outflow, 2), 100000.0)

    def test_the_payment_summary_counts_it_at_the_gross(self):
        summary = get_payment_summary(PO, self.po)

        self.assertEqual((summary["lines"]["paid"], summary["left"]), (100000.0, 18000.0))

    def test_the_request_limit_counts_it_at_the_gross(self):
        with self.assertRaisesRegex(frappe.ValidationError, "Maximum amount you can request is ₹ 18,000.00"):
            create_payment_request_for_service(frappe.as_json({"doctype": PO, "docname": self.po, "amount": 18011}))

    def test_the_payments_pop_up_reads_its_tax_from_an_endpoint_that_checks_read_on_the_po(self):
        self.assertEqual(
            get_order_payment_tds(PO, self.po),
            {"payments": {self.payment: {"tds_amount": 100.0, "borne_by": "Vendor"}}},
        )
        frappe.set_user("Guest")
        with self.assertRaises(frappe.PermissionError):
            get_order_payment_tds(PO, self.po)


class TheOldShapeElsewhere(PoTaxFixture):
    """The other figures that read recorded tax leave a payment still stored gross as it was."""

    def setUp(self):
        super().setUp()
        self.payment = self.fx.old_payment(self.po, gross=100000, tds=100)

    def test_outflow_summary_limit_and_pop_up_read_the_payment_amount(self):
        self.assertEqual(flt(project_money_of(self.fx.project).po_outflow, 2), 100000.0)
        self.assertEqual(get_payment_summary(PO, self.po)["lines"]["paid"], 100000.0)
        self.assertEqual(get_order_payment_tds(PO, self.po), {"payments": {}})
        with self.assertRaisesRegex(frappe.ValidationError, "Maximum amount you can request is ₹ 18,000.00"):
            create_payment_request_for_service(frappe.as_json({"doctype": PO, "docname": self.po, "amount": 18011}))


class TakingADeductionStaysWorkOrderOnly(PoTaxFixture):
    def test_approving_a_po_payment_withholds_no_tax(self):
        name = self.fx.payment(self.po, 4000, status="CEO Pending")
        doc = frappe.get_doc("Project Payments", name)
        doc.status = "Approved"
        doc.save(ignore_permissions=True)

        self.assertFalse(frappe.db.exists("Payment TDS Deduction", {"project_payment": name}))
        self.assertEqual(frappe.db.get_value("Project Payments", name, "amount"), 4000.0)
