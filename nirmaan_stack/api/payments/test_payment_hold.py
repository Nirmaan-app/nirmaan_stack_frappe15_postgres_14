# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Payment hold: an Approved PO / WO payment held from payment until it is released.

WHAT THIS SUITE HOLDS DOWN
--------------------------
The owner's rule (2026-09-22): Admin, Accountant and Accountant Lead hold AND release, any of them
may release another's hold, and a held payment cannot leave `Approved` by any route -- the tab's
Mark as Paid (a plain status write), `update_payment_request` fulfil, or the cheque auto-move.
The boundary is `services/payment_hold.validate_hold`, so every route is exercised through its
real code, not through the endpoint alone.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE (the endpoints commit). Every row is planted through
`TaxedWorkOrderFixture` and purged by it: `TEST-TWO-*`, plus every payment under its projects.
The role users are real `Nirmaan Users` rows, read at run time; a test whose profile has no user
on this site is skipped rather than faked.
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt, nowdate

from nirmaan_stack.api.payments.payment_hold import set_payment_hold
from nirmaan_stack.api.payments.project_payments import (
	move_cheque_payment_to_reconciliation,
	update_payment_request,
)
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture

PAYMENT = "Project Payments"
SR = "Service Requests"
U = "Administrator"
APPROVED = "Approved"
RECON = "Reconciliation Pending"

ACCOUNTANT = "Nirmaan Accountant Profile"
ACCOUNTANT_LEAD = "Nirmaan Accountant Lead Profile"
PROJECT_MANAGER = "Nirmaan Project Manager Profile"


class TestPaymentHold(FrappeTestCase):
	def setUp(self):
		frappe.set_user(U)
		self.fx = TaxedWorkOrderFixture.attach(self)
		self.project = self.fx.project()
		self.vendor = self.fx.vendor(2.0)
		self.sr = self.fx.service_request(self.project, self.vendor)

	def tearDown(self):
		frappe.set_user(U)

	# -- helpers --------------------------------------------------------------------------------
	def _plant(self, status=APPROVED, *, cheque=False):
		"""A payment already sitting at `status`. Raw insert, so no approval hook runs."""
		name = self.fx._name("PAY")
		frappe.db.sql(
			"""INSERT INTO "tabProject Payments" (name, creation, modified, modified_by, owner,
				   docstatus, idx, project, vendor, amount, status, document_type, document_name,
				   mode_of_payment, cheque_no, cheque_date)
			   VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, 20000, %s, %s, %s, %s, %s, %s)""",
			(
				name, U, U, self.project, self.vendor, status, SR, self.sr,
				"Cheque" if cheque else "Online",
				f"TESTCHQ-{frappe.generate_hash(length=8)}" if cheque else None,
				nowdate() if cheque else None,
			),
		)
		self.fx.payments.append(name)
		frappe.db.commit()
		return name

	def _user(self, profile):
		user = frappe.db.get_value("Nirmaan Users", {"role_profile": profile}, "name")
		if not user:
			self.skipTest(f"no {profile} user on this site")
		return user

	def _state(self, name):
		row = frappe.db.get_value(PAYMENT, name, ["status", "on_hold"], as_dict=True)
		return row.status, int(row.on_hold or 0)

	def _as(self, user, fn, *args, **kwargs):
		previous = frappe.session.user
		frappe.set_user(user)
		try:
			return fn(*args, **kwargs)
		finally:
			frappe.set_user(previous)

	def _mark_as_paid(self, name):
		"""What the tab's Mark as Paid does: a plain status write through the document."""
		doc = frappe.get_doc(PAYMENT, name)
		doc.status = RECON
		doc.save(ignore_permissions=True)
		frappe.db.commit()

	# -- who ------------------------------------------------------------------------------------
	def test_accountant_holds_and_accountant_lead_releases(self):
		name = self._plant()
		self._as(self._user(ACCOUNTANT), set_payment_hold, name, True)
		self.assertEqual(self._state(name), (APPROVED, 1))

		self._as(self._user(ACCOUNTANT_LEAD), set_payment_hold, name, False)
		self.assertEqual(self._state(name), (APPROVED, 0))

	def test_administrator_holds_and_releases(self):
		name = self._plant()
		set_payment_hold(name, "true")
		self.assertEqual(self._state(name), (APPROVED, 1))
		set_payment_hold(name, "0")
		self.assertEqual(self._state(name), (APPROVED, 0))

	def test_another_role_cannot_hold_through_the_endpoint(self):
		name = self._plant()
		with self.assertRaises(frappe.PermissionError):
			self._as(self._user(PROJECT_MANAGER), set_payment_hold, name, True)
		self.assertEqual(self._state(name), (APPROVED, 0))

	def test_another_role_cannot_change_the_flag_through_the_document(self):
		"""The Desk / REST path: the doctype's write permission is wide, so `validate` checks the role."""
		pm = self._user(PROJECT_MANAGER)
		name = self._plant()

		def flip(value):
			doc = frappe.get_doc(PAYMENT, name)
			doc.on_hold = value
			doc.save(ignore_permissions=True)

		with self.assertRaises(frappe.PermissionError):
			self._as(pm, flip, 1)
		frappe.db.rollback()
		self.assertEqual(self._state(name), (APPROVED, 0))

		set_payment_hold(name, True)
		with self.assertRaises(frappe.PermissionError):
			self._as(pm, flip, 0)
		frappe.db.rollback()
		self.assertEqual(self._state(name), (APPROVED, 1))

	# -- what can be held -----------------------------------------------------------------------
	def test_only_an_approved_payment_can_be_held(self):
		for status in ("Requested", "CEO Pending", RECON, "Paid", "Rejected"):
			with self.subTest(status=status):
				name = self._plant(status)
				with self.assertRaises(frappe.ValidationError):
					set_payment_hold(name, True)
				self.assertEqual(self._state(name), (status, 0))

	def test_holding_twice_is_a_no_op(self):
		name = self._plant()
		set_payment_hold(name, True)
		modified = frappe.db.get_value(PAYMENT, name, "modified")
		self.assertEqual(set_payment_hold(name, True), {"name": name, "on_hold": 1})
		self.assertEqual(frappe.db.get_value(PAYMENT, name, "modified"), modified)

	# -- what a hold blocks ---------------------------------------------------------------------
	def test_held_payment_cannot_be_marked_as_paid_until_released(self):
		name = self._plant()
		set_payment_hold(name, True)
		with self.assertRaises(frappe.ValidationError):
			self._mark_as_paid(name)
		frappe.db.rollback()
		self.assertEqual(self._state(name), (APPROVED, 1))

		set_payment_hold(name, False)
		self._mark_as_paid(name)
		self.assertEqual(self._state(name), (RECON, 0))

	def test_held_payment_cannot_be_fulfilled(self):
		name = self._plant()
		set_payment_hold(name, True)
		with self.assertRaises(frappe.ValidationError):
			update_payment_request(frappe.as_json({
				"action": "fulfil", "name": name, "utr": f"TESTUTR-{frappe.generate_hash(length=8)}",
			}))
		frappe.db.rollback()
		self.assertEqual(self._state(name), (APPROVED, 1))

	def test_held_cheque_is_not_moved_on(self):
		name = self._plant(cheque=True)
		set_payment_hold(name, True)
		with patch("frappe.log_error") as log_error:
			self.assertEqual(move_cheque_payment_to_reconciliation(name), {"moved": False})
		log_error.assert_not_called()
		self.assertEqual(self._state(name), (APPROVED, 1))

		set_payment_hold(name, False)
		self.assertEqual(move_cheque_payment_to_reconciliation(name), {"moved": True})
		self.assertEqual(self._state(name), (RECON, 0))

	def test_a_save_that_leaves_the_status_alone_still_works_while_held(self):
		"""Other writers (a PO term sync, a TDS restatement) save a held payment without moving it."""
		name = self._plant()
		set_payment_hold(name, True)
		doc = frappe.get_doc(PAYMENT, name)
		doc.amount = flt(doc.amount) + 1
		doc.save(ignore_permissions=True)
		frappe.db.commit()
		self.assertEqual(self._state(name), (APPROVED, 1))
