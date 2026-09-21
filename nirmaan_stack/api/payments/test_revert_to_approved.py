# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""`revert_payment_to_approved`: Reconciliation Pending -> Approved, and nothing else.

Runs against the LIVE site: raw fixtures inside a transaction whose commits are stubbed and which
is rolled back in `tearDown`.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.payments.revert_to_approved import revert_payment_to_approved
from nirmaan_stack.services import payment_tds

PAYMENT = "Project Payments"


def _raw(doctype, **fields):
	doc = frappe.new_doc(doctype)
	doc.update(fields)
	doc.name = frappe.generate_hash(length=12)
	doc.db_insert()
	return doc.name


class TestRevertToApproved(FrappeTestCase):
	def setUp(self):
		self._real_commit = frappe.db.commit
		frappe.db.commit = lambda *a, **k: None
		frappe.set_user("Administrator")
		self.po = _raw("Procurement Orders", total_amount=100000, amount_paid=0)

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.commit = self._real_commit
		frappe.db.rollback()

	def _payment(self, status="Reconciliation Pending", **extra):
		return _raw(
			PAYMENT,
			document_type="Procurement Orders",
			document_name=self.po,
			amount=5000,
			status=status,
			mode_of_payment="Online",
			**extra,
		)

	def test_reconciliation_pending_goes_back_to_approved(self):
		name = self._payment()
		out = revert_payment_to_approved(name)
		self.assertEqual(out["status"], "Approved")
		self.assertEqual(frappe.db.get_value(PAYMENT, name, "status"), "Approved")
		# Nothing it carried moves: the amount is untouched and the PO's paid figure never counted it.
		self.assertEqual(float(frappe.db.get_value(PAYMENT, name, "amount")), 5000)
		self.assertEqual(float(frappe.db.get_value("Procurement Orders", self.po, "amount_paid")), 0)

	def test_any_other_status_is_refused(self):
		for status in ("Requested", "CEO Pending", "Approved", "Paid", "Rejected"):
			with self.subTest(status=status):
				name = self._payment(status=status)
				with self.assertRaises(frappe.ValidationError):
					revert_payment_to_approved(name)
				self.assertEqual(frappe.db.get_value(PAYMENT, name, "status"), status)

	def test_a_bank_matched_payment_is_refused(self):
		name = self._payment()
		_raw("Outflow Row Match", target_doctype=PAYMENT, target_name=name, match_kind="Settled")
		with self.assertRaises(frappe.ValidationError):
			revert_payment_to_approved(name)
		self.assertEqual(frappe.db.get_value(PAYMENT, name, "status"), "Reconciliation Pending")

	def test_a_reversed_match_does_not_block(self):
		name = self._payment()
		_raw("Outflow Row Match", target_doctype=PAYMENT, target_name=name, match_kind="Reversed")
		self.assertEqual(revert_payment_to_approved(name)["status"], "Approved")

	def test_a_user_outside_the_settle_roles_is_refused(self):
		name = self._payment()
		frappe.set_user(f"not-a-settler-{frappe.generate_hash(length=6)}@example.com")
		with self.assertRaises(frappe.PermissionError):
			revert_payment_to_approved(name)
		frappe.set_user("Administrator")
		self.assertEqual(frappe.db.get_value(PAYMENT, name, "status"), "Reconciliation Pending")

	def test_the_move_is_not_read_as_an_approval(self):
		"""The premise that keeps TDS from being withheld a second time on the way back."""
		self.assertFalse(
			payment_tds.is_approval_from_an_earlier_step("Reconciliation Pending", "Approved")
		)
