# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The payment lists carry each payment's Cheque, so the cheque chip needs no fetch per row (#1415, spec #1407).

The queue (`get_approval_queue`) feeds the four payment-queue tabs, Project › Financials › All Payments and
Customer › Financials. The Vendor › Payments tab and the Transaction Details cards read the chip through
`cheque_chips.get_cheque_chips`. Both are read back here the way the browser reads them.

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoints commit). Projects, vendors, Work Orders and payments come
from `TaxedWorkOrderFixture`; every Cheque carries a TESTCHQ number and is purged by `ChequeFixture`.
"""

import json
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import nowdate

from nirmaan_stack.api.approvals.get_approval_queue import get_approval_queue
from nirmaan_stack.api.cheques.cheque_chips import get_cheque_chips
from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.cheques.cheque_status import change_cheque_status
from nirmaan_stack.api.cheques.save_cheque import save_cheque
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture

U = "Administrator"
SR = "Service Requests"
PHOTO = "https://storage.example.invalid/private/files/cheque-test.jpg"
CONTROLLER = "nirmaan_stack.integrations.controllers.project_payments"


class TestTheQueueCarriesTheCheque(FrappeTestCase):
	def setUp(self):
		frappe.set_user(U)
		self.fx = TaxedWorkOrderFixture.attach(self)
		self.cheques = ChequeFixture.attach(self)
		self.vendor = self.fx.vendor(2.0)
		self.project = self.fx.project()
		self.sr = self.fx.service_request(self.project, self.vendor)
		frappe.db.commit()
		quiet = patch(f"{CONTROLLER}._notify_admins_auto_approved")
		quiet.start()
		self.addCleanup(quiet.stop)

	def _plant(self, *, utr=""):
		"""An Online payment waiting for approval (raw insert: no approval hook runs)."""
		return self.cheques.plant_payment(
			self.fx, "Requested", project=self.project, vendor=self.vendor, document=(SR, self.sr), utr=utr
		)

	def _cheque(self, payment, cheque_no):
		result = save_cheque(
			bank="ICICI Bank",
			cheque_no=cheque_no,
			cheque_date=nowdate(),
			amount=20000,
			vendor=self.vendor,
			attachment=PHOTO,
			lines=json.dumps([
				{"line_type": "PO/WO Payment", "project": self.project, "record_doctype": SR,
				 "record_name": self.sr, "payment_name": payment},
			]),
		)
		return self.cheques.track(result["cheque"])

	def _row(self, name):
		rows = [
			r
			for r in get_approval_queue(filters=[["name", "=", name]], limit_page_length=5)["data"]
			if r["name"] == name
		]
		self.assertEqual(len(rows), 1)
		return rows[0]

	def test_a_payment_on_a_cheque_carries_its_link_number_and_status(self):
		payment = self._plant()
		number = self.cheques.number()
		cheque = self._cheque(payment, number)

		row = self._row(payment)
		self.assertEqual((row["cheque"], row["cheque_no"], row["cheque_status"]), (cheque, number, "Issued"))
		self.assertEqual(row["mode_of_payment"], "Cheque")

	def test_a_cancelled_cheque_reads_cancelled_on_its_payment(self):
		payment = self._plant()
		cheque = self._cheque(payment, self.cheques.number())
		change_cheque_status(cheque, "Cancelled", note="Torn")
		self.assertEqual(self._row(payment)["cheque_status"], "Cancelled")

	def test_an_online_payment_has_no_cheque_and_keeps_its_utr(self):
		row = self._row(self._plant(utr="UTR123456"))
		self.assertEqual((row["cheque"], row["cheque_status"], row["utr_ref"]), ("", "", "UTR123456"))

	def test_the_chip_read_names_each_cheques_number_and_status(self):
		first, second = self._plant(), self._plant()
		one, two = self.cheques.number(), self.cheques.number()
		a, b = self._cheque(first, one), self._cheque(second, two)
		change_cheque_status(b, "Cleared")

		self.assertEqual(
			get_cheque_chips(json.dumps([a, b, "CHQ-NOT-THERE"])),
			{a: {"cheque_no": one, "status": "Issued"}, b: {"cheque_no": two, "status": "Cleared"}},
		)
		self.assertEqual(get_cheque_chips([]), {})
