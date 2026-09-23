# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""The payment summary: the pure arithmetic, then the endpoint against the request cap.

The endpoint tests run against the LIVE site: raw fixtures inside a transaction rolled back in
`tearDown` (the endpoint writes nothing, so no commit is ever attempted).
"""

import unittest

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.payments.payment_summary import get_payment_summary
from nirmaan_stack.services.finance import (
	get_source_document_financials,
	get_total_paid,
	get_total_pending,
	get_total_reconciliation_pending,
)
from nirmaan_stack.services.payment_summary import LINE_ORDER, summarise


def _p(name, amount, status):
	return {"name": name, "amount": amount, "status": status}


class TestSummarise(unittest.TestCase):
	def test_every_counted_status_has_its_own_line(self):
		payments = [
			_p("A", 100, "Paid"),
			_p("B", 20, "Reconciliation Pending"),
			_p("C", 30, "Approved"),
			_p("D", 40, "CEO Pending"),
			_p("E", 50, "Requested"),
			_p("F", 60, "Rejected"),
		]
		out = summarise(1000, payments)
		self.assertEqual(list(out["lines"]), list(LINE_ORDER))
		self.assertEqual(
			out["lines"],
			{"paid": 100, "reconciliation_pending": 20, "approved": 30,
			 "ceo_pending": 40, "requested": 50, "rejected": 60},
		)
		self.assertEqual(out["committed"], 300)
		self.assertEqual(out["left"], 700)

	def test_the_payment_being_approved_is_left_out(self):
		out = summarise(1000, [_p("A", 100, "Paid"), _p("THIS", 400, "Requested")], exclude_payment="THIS")
		self.assertEqual(out["lines"]["requested"], 0)
		self.assertEqual(out["left"], 900)
		self.assertEqual([p["name"] for p in out["payments"]], ["A"])

	def test_a_work_order_counts_its_payments_gross(self):
		"""4,900 net + 100 withheld was a 5,000 request."""
		out = summarise(10000, [_p("A", 4900, "Paid")], tds_by_payment={"A": 100})
		self.assertEqual(out["lines"]["paid"], 5000)
		self.assertEqual(out["payments"][0]["gross_amount"], 5000)

	def test_a_company_borne_work_order_does_not_add_the_tax_back(self):
		out = summarise(10000, [_p("A", 5000, "Paid")], tds_by_payment={"A": 100}, company_borne=True)
		self.assertEqual(out["lines"]["paid"], 5000)

	def test_an_over_committed_order_goes_negative(self):
		self.assertEqual(summarise(100, [_p("A", 150, "Approved")])["left"], -50)

	def test_an_unknown_status_is_listed_but_not_counted(self):
		out = summarise(100, [_p("A", 40, "Cancelled")])
		self.assertEqual(out["committed"], 0)
		self.assertEqual(out["payments"][0]["status"], "Cancelled")


def _raw(doctype, **fields):
	doc = frappe.new_doc(doctype)
	doc.update(fields)
	doc.name = frappe.generate_hash(length=12)
	doc.db_insert()
	return doc.name


class TestPaymentSummaryEndpoint(FrappeTestCase):
	def setUp(self):
		frappe.set_user("Administrator")

	def tearDown(self):
		frappe.db.rollback()

	def _po_with_payments(self):
		po = _raw("Procurement Orders", amount=100000, tax_amount=18000, total_amount=118000)
		for amount, status in (
			(20000, "Paid"),
			(5000, "Reconciliation Pending"),
			(10000, "Approved"),
			(7000, "CEO Pending"),
			(3000, "Requested"),
			(1000, "Rejected"),
		):
			_raw(
				"Project Payments",
				document_type="Procurement Orders",
				document_name=po,
				amount=amount,
				status=status,
			)
		return po

	def test_left_is_exactly_the_request_caps_balance(self):
		"""The summary and `create_project_payment`'s refusal must never disagree."""
		po = self._po_with_payments()
		out = get_payment_summary("Procurement Orders", po)

		src = frappe.get_doc("Procurement Orders", po)
		cap_balance = (
			get_source_document_financials(src)["payable_total"]
			- get_total_paid(src)
			- get_total_pending(src)
			- get_total_reconciliation_pending(src)
		)
		self.assertEqual(out["value"], 118000)
		self.assertEqual(out["value_basis"], "incl_gst")
		self.assertAlmostEqual(out["left"], cap_balance, places=2)
		self.assertAlmostEqual(out["left"], 118000 - 46000, places=2)
		self.assertEqual(len(out["payments"]), 6)

	def test_the_payment_being_approved_is_excluded(self):
		po = self._po_with_payments()
		this = _raw(
			"Project Payments",
			document_type="Procurement Orders",
			document_name=po,
			amount=4000,
			status="Requested",
		)
		out = get_payment_summary("Procurement Orders", po, exclude_payment=this)
		self.assertEqual(out["lines"]["requested"], 3000)
		self.assertNotIn(this, [p["name"] for p in out["payments"]])

	def test_a_gst_work_order_is_measured_against_its_base_amount(self):
		sr = _raw("Service Requests", total_amount=118000, gst="true")
		out = get_payment_summary("Service Requests", sr)
		self.assertEqual(out["value_basis"], "ex_gst")
		self.assertAlmostEqual(out["value"], 100000, places=2)

	def test_other_doctypes_are_refused(self):
		with self.assertRaises(frappe.ValidationError):
			get_payment_summary("Vendors", "anything")
