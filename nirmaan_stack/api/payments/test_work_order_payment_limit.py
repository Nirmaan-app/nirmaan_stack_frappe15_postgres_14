# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""The Work Order payment limit through `create_payment_request_for_service` (ADR-0030).

The arithmetic is pinned in `services/test_work_order_payment_limit`; this suite proves the endpoint
enforces it: the payment kind it is handed picks Base left or GST left, total left always applies,
and a refused request writes nothing.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Everything is planted by `TaxedWorkOrderFixture`
(`TEST-TWO-*`), whose purge also sweeps the payments the endpoint mints under its projects.
"""

import json
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from nirmaan_stack.api.payments.project_payments import create_payment_request_for_service
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.services import payment_tds

PAYMENT = "Project Payments"
SR = "Service Requests"
U = "Administrator"
CONTROLLER = "nirmaan_stack.integrations.controllers.project_payments"


class TestWorkOrderPaymentRequestLimit(FrappeTestCase):
	def setUp(self):
		frappe.set_user(U)
		self.fx = TaxedWorkOrderFixture.attach(self)
		self.project = self.fx.project()
		self.vendor = self.fx.vendor(2.0)
		# The auto-approve admin note reaches every real admin on the live site -- keep it off.
		quiet = patch(f"{CONTROLLER}._notify_admins_auto_approved")
		quiet.start()
		self.addCleanup(quiet.stop)

	def _gst_wo(self, gst_invoiced, base_paid_gross=40000):
		"""Base 1,00,000 + GST 18,000 = 1,18,000, with one taxed base payment approved on it."""
		sr = self.fx.service_request(self.project, self.vendor, total=118000, gst=True, gst_invoiced=gst_invoiced)
		if base_paid_gross:
			made = self.fx.payment(base_paid_gross, project=self.project, vendor=self.vendor, service_request=sr)
			self.assertEqual((made.net, made.tds), (base_paid_gross * 0.98, base_paid_gross * 0.02))
		return sr

	def _plant(self, sr, amount, status, gst=False):
		name = self.fx._name("PAY")
		frappe.db.sql(
			"""INSERT INTO "tabProject Payments" (name, creation, modified, modified_by, owner, docstatus,
				   idx, project, vendor, amount, status, document_type, document_name, is_gst_payment)
			   VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, %s, %s, %s, %s)""",
			(name, U, U, self.project, self.vendor, flt(amount), status, SR, sr, 1 if gst else 0),
		)
		self.fx.payments.append(name)
		frappe.db.commit()
		return name

	def _request(self, sr, amount, gst=None):
		payload = {"doctype": SR, "docname": sr, "amount": amount}
		if gst is not None:
			payload["is_gst_payment"] = 1 if gst else 0
		return json.loads(create_payment_request_for_service(json.dumps(payload)))["name"]

	def _count(self, sr):
		return frappe.db.count(PAYMENT, {"document_type": SR, "document_name": sr})

	# -- refused ------------------------------------------------------------------------------------
	def test_a_base_request_above_base_left_is_refused(self):
		sr = self._gst_wo(gst_invoiced=9000)  # base left 60,000
		before = self._count(sr)
		with self.assertRaisesRegex(frappe.ValidationError, "Maximum amount you can request.*Base left"):
			self._request(sr, 61000)
		self.assertEqual(self._count(sr), before)

	def test_base_payments_count_gross_of_tds(self):
		"""Counted net, 39,200 paid would leave 60,800; counted gross it leaves 60,000."""
		sr = self._gst_wo(gst_invoiced=0)
		with self.assertRaisesRegex(frappe.ValidationError, "Base left"):
			self._request(sr, 60500)

	def test_a_gst_request_above_gst_left_is_refused(self):
		sr = self._gst_wo(gst_invoiced=9000)
		with self.assertRaisesRegex(frappe.ValidationError, "Maximum amount you can request.*GST left"):
			self._request(sr, 9500, gst=True)

	def test_no_gst_can_be_requested_before_an_invoice_is_approved(self):
		sr = self._gst_wo(gst_invoiced=0)
		with self.assertRaisesRegex(frappe.ValidationError, "GST left"):
			self._request(sr, 1000, gst=True)

	def test_a_request_above_total_left_is_refused_even_within_its_part(self):
		# An old Work Order paid 1,10,000 of base before GST payments existed: GST left is 18,000,
		# but only 8,000 remains under the total incl. GST.
		sr = self._gst_wo(gst_invoiced=18000, base_paid_gross=0)
		self._plant(sr, 110000, "Paid")
		with self.assertRaisesRegex(frappe.ValidationError, "Maximum amount you can request.*total"):
			self._request(sr, 9000, gst=True)
		self.assertTrue(self._request(sr, 8000, gst=True))

	def test_a_rejected_payment_still_holds_its_share(self):
		sr = self._gst_wo(gst_invoiced=9000)
		self._plant(sr, 5000, "Rejected", gst=True)
		with self.assertRaisesRegex(frappe.ValidationError, "GST left"):
			self._request(sr, 5000, gst=True)

	def test_a_gst_payment_on_a_gst_off_work_order_is_refused(self):
		sr = self.fx.service_request(self.project, self.vendor, total=100000)
		with self.assertRaisesRegex(frappe.ValidationError, "no GST"):
			self._request(sr, 5, gst=True)

	def test_a_gst_payment_on_a_purchase_order_is_refused(self):
		with self.assertRaisesRegex(frappe.ValidationError, "Work Order"):
			create_payment_request_for_service(json.dumps(
				{"doctype": "Procurement Orders", "docname": "anything", "amount": 100, "is_gst_payment": 1}
			))

	# -- allowed ------------------------------------------------------------------------------------
	def test_a_gst_request_within_gst_left_is_a_gst_payment_with_no_tds(self):
		sr = self._gst_wo(gst_invoiced=9000)
		name = self._request(sr, 9000, gst=True)
		row = frappe.db.get_value(PAYMENT, name, ["is_gst_payment", "amount", "status"], as_dict=True)
		self.assertEqual((row.is_gst_payment, flt(row.amount), row.status), (1, 9000.0, "Approved"))
		self.assertIsNone(payment_tds.existing_deduction(name))

	def test_a_base_request_within_base_left_is_a_base_payment(self):
		sr = self._gst_wo(gst_invoiced=9000)
		name = self._request(sr, 10000)
		self.assertEqual(frappe.db.get_value(PAYMENT, name, "is_gst_payment"), 0)
		self.assertTrue(payment_tds.existing_deduction(name))

	def test_a_gst_off_work_order_is_capped_at_its_total(self):
		sr = self.fx.service_request(self.project, self.vendor, total=30000)
		self._plant(sr, 20000, "Approved")
		with self.assertRaisesRegex(frappe.ValidationError, "Maximum amount you can request"):
			self._request(sr, 10500, gst=False)
		self.assertTrue(self._request(sr, 10000))
