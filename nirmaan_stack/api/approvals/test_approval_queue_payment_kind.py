# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The approval queue carries a payment's kind (ADR-0030), so every payment list can tag a GST
payment and the approve / bulk-confirm TDS forecast can skip it.

The frontend reads `is_gst_payment` straight off the queue row; this is the read of the stored
value that proves it ARRIVES (CODING_STANDARDS.md: a test on each side of a boundary is not a test of it).
"""

import unittest

import frappe
from frappe.utils import flt

from nirmaan_stack.api.approvals.get_approval_queue import get_approval_queue
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture

U = "Administrator"


class TestTheQueueCarriesThePaymentKind(unittest.TestCase):
	def setUp(self):
		frappe.set_user(U)
		self.fx = TaxedWorkOrderFixture.attach(self)
		self.project = self.fx.project()
		self.vendor = self.fx.vendor(2.0)
		self.sr = self.fx.service_request(self.project, self.vendor)

	def _plant(self, *, gst):
		name = self.fx._name("PAY")
		frappe.db.sql(
			"""INSERT INTO "tabProject Payments" (name, creation, modified, modified_by, owner,
				   docstatus, idx, project, vendor, amount, status, document_type, document_name,
				   is_gst_payment)
			   VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, 'Requested',
					   'Service Requests', %s, %s)""",
			(name, U, U, self.project, self.vendor, flt(20000), self.sr, 1 if gst else 0),
		)
		self.fx.payments.append(name)
		frappe.db.commit()
		return name

	def _row(self, name):
		rows = [
			r
			for r in get_approval_queue(filters=[["name", "=", name]], limit_page_length=5)["data"]
			if r["name"] == name
		]
		self.assertEqual(len(rows), 1)
		return rows[0]

	def test_a_gst_payment_reads_1_and_a_base_payment_reads_0(self):
		self.assertEqual(self._row(self._plant(gst=True))["is_gst_payment"], 1)
		self.assertEqual(self._row(self._plant(gst=False))["is_gst_payment"], 0)
