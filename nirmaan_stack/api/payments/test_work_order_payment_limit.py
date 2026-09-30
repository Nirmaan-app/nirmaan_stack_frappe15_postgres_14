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


class TestWorkOrderPaidEntryLimit(FrappeTestCase):
	"""The Accountant's paid entry on the Work Order page -- a `Project Payments` insert straight at
	`Paid`, the same insert a Desk form or `POST /api/resource/Project Payments` makes -- is held to
	the SAME limit by the insert validation (`controllers/project_payments.validate`), whatever the
	screen sends. Before #1342 the screen only warned."""

	def setUp(self):
		frappe.set_user(U)
		self.fx = TaxedWorkOrderFixture.attach(self)
		self.project = self.fx.project()
		self.vendor = self.fx.vendor(2.0)
		# A paid entry falls through to the "new payment request" admin fan-out, which reaches every
		# real admin on the live site -- keep it off.
		for target in ("_notify_admins_auto_approved", "get_admin_users"):
			quiet = patch(f"{CONTROLLER}.{target}", return_value=[])
			quiet.start()
			self.addCleanup(quiet.stop)

	_gst_wo = TestWorkOrderPaymentRequestLimit._gst_wo
	_plant = TestWorkOrderPaymentRequestLimit._plant
	_count = TestWorkOrderPaymentRequestLimit._count

	def _paid_entry(self, sr, amount, gst=None, status="Paid"):
		"""The insert `approved-sr.tsx` makes through `createDoc`."""
		row = {
			"doctype": PAYMENT, "document_type": SR, "document_name": sr, "project": self.project,
			"vendor": self.vendor, "amount": amount, "status": status, "utr": "UTR-TEST",
			"payment_date": frappe.utils.nowdate(),
		}
		if gst is not None:
			row["is_gst_payment"] = 1 if gst else 0
		doc = frappe.get_doc(row).insert()
		self.fx.payments.append(doc.name)
		frappe.db.commit()
		return doc.name

	# -- refused ------------------------------------------------------------------------------------
	def test_a_base_paid_entry_above_base_left_is_refused(self):
		sr = self._gst_wo(gst_invoiced=9000)  # base left 60,000
		before = self._count(sr)
		with self.assertRaisesRegex(frappe.ValidationError, "Maximum amount you can pay.*Base left"):
			self._paid_entry(sr, 61000, gst=False)
		self.assertEqual(self._count(sr), before)

	def test_a_paid_entry_that_names_no_kind_is_a_base_payment(self):
		sr = self._gst_wo(gst_invoiced=9000)
		with self.assertRaisesRegex(frappe.ValidationError, "Base left"):
			self._paid_entry(sr, 61000)

	def test_a_gst_paid_entry_above_gst_left_is_refused(self):
		sr = self._gst_wo(gst_invoiced=9000)
		before = self._count(sr)
		with self.assertRaisesRegex(frappe.ValidationError, "Maximum amount you can pay.*GST left"):
			self._paid_entry(sr, 9500, gst=True)
		self.assertEqual(self._count(sr), before)

	def test_a_paid_entry_above_total_left_is_refused_even_within_its_part(self):
		# 1,10,000 of base held by an Approved payment: GST left 18,000, total left 8,000. The old
		# insert check (amount + Paid <= total) sees nothing Paid and would have let 9,000 through.
		sr = self._gst_wo(gst_invoiced=18000, base_paid_gross=0)
		self._plant(sr, 110000, "Approved")
		with self.assertRaisesRegex(frappe.ValidationError, "Maximum amount you can pay.*total left"):
			self._paid_entry(sr, 9000, gst=True)
		self.assertTrue(self._paid_entry(sr, 8000, gst=True))

	def test_a_gst_paid_entry_on_a_gst_off_work_order_is_refused(self):
		sr = self.fx.service_request(self.project, self.vendor, total=100000)
		with self.assertRaisesRegex(frappe.ValidationError, "no GST"):
			self._paid_entry(sr, 5, gst=True)

	def test_a_desk_insert_at_requested_is_held_to_the_limit_too(self):
		sr = self._gst_wo(gst_invoiced=9000)
		with self.assertRaisesRegex(frappe.ValidationError, "Base left"):
			self._paid_entry(sr, 61000, gst=False, status="Requested")

	# -- allowed ------------------------------------------------------------------------------------
	def test_a_gst_paid_entry_within_gst_left_is_stored_as_a_gst_payment(self):
		sr = self._gst_wo(gst_invoiced=9000)
		name = self._paid_entry(sr, 9000, gst=True)
		row = frappe.db.get_value(PAYMENT, name, ["is_gst_payment", "amount", "status"], as_dict=True)
		self.assertEqual((row.is_gst_payment, flt(row.amount), row.status), (1, 9000.0, "Paid"))

	def test_a_base_paid_entry_within_base_left_is_stored_as_a_base_payment(self):
		sr = self._gst_wo(gst_invoiced=9000)
		name = self._paid_entry(sr, 60000, gst=False)
		self.assertEqual(frappe.db.get_value(PAYMENT, name, "is_gst_payment"), 0)

	# -- paths the insert check deliberately leaves to their own rules --------------------------------
	def test_a_split_leftover_is_not_counted_twice(self):
		"""A CEO part-approval inserts the leftover BEFORE it trims the original, so for one moment
		the same money is on two rows. The leftover is money already counted, never new money."""
		sr = self._gst_wo(gst_invoiced=0, base_paid_gross=0)
		pay = self._plant(sr, 100000, "CEO Pending")  # base left 0
		frappe.db.set_value(PAYMENT, pay, "approval_date", frappe.utils.nowdate())
		frappe.db.commit()
		from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER
		from nirmaan_stack.api.payments.project_payments import ceo_approve_payment

		frappe.set_user(CEO_AUTHORIZED_USER)
		try:
			result = ceo_approve_payment(pay, 60000)
		finally:
			frappe.set_user(U)
		self.assertEqual(flt(frappe.db.get_value(PAYMENT, result["data"]["remainder_payment"], "amount")), 40000.0)

	def test_a_refund_is_never_refused_by_the_limit(self):
		sr = self._gst_wo(gst_invoiced=0, base_paid_gross=0)
		self._plant(sr, 130000, "Approved")  # paid past the total: total left is -12,000
		self.assertTrue(self._paid_entry(sr, -2000, gst=False, status="Requested"))
