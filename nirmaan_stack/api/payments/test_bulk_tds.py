# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The bulk approve endpoint's post-commit TDS phase.

⚠️ "TDS" HERE IS **TAX DEDUCTED AT SOURCE**, not the Technical Data Sheet doctypes. See
`services/payment_tds.py` for why that warning is on every file in this family.

WHAT THIS SUITE EXISTS TO HOLD DOWN
-----------------------------------
The deduction used to be written from `controllers/project_payments.on_update`, INSIDE the
save loop, which meant it shared one transaction with every approval in the batch. On
Postgres a database-level failure there (a deadlock on the `PTD-` naming series, a unique
violation) aborts the whole transaction, and `record_deduction_if_eligible` swallows the
Python exception without clearing that state — so the endpoint's `frappe.db.commit()` ran as
a ROLLBACK while still returning `succeeded`. Measured before the fix: one forced failure on
payment 3 of 8 lost all 8 approvals and still answered HTTP 200.

`test_a_failed_deduction_does_not_lose_the_other_approvals` is that exact scenario, and it is
the reason this file is here. The rest guard the edges the fix moved.

⚠️ THIS SUITE RUNS AGAINST THE LIVE SITE DATABASE — there is no separate test DB on this
bench, and the endpoint COMMITS, so `FrappeTestCase`'s rollback cannot undo it. Every fixture
is named `TEST-BTDS-*` and teardown deletes exactly that set, the same arrangement
`services/test_payment_tds.py` uses and for the same reason.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.payments import bulk_actions
from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER
from nirmaan_stack.services import payment_tds

TDS_DOCTYPE = "Payment TDS Deduction"
PAYMENT = "Project Payments"
SR = "Service Requests"
PO = "Procurement Orders"

P = "TEST-BTDS-"
U = "Administrator"


class TestBulkApproveTDS(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.project = f"{P}PROJ-0001"
		cls.vendor = f"{P}VEN-RATE2"
		cls.sr = f"{P}SR-0001"
		cls.po = f"{P}PO-0001"

		frappe.db.sql(
			"""INSERT INTO "tabProjects" (name, creation, modified, modified_by, owner,
				   docstatus, idx, project_name, tendering_status)
			   VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, 'Won')""",
			(cls.project, U, U, "TEST BTDS Project"),
		)
		frappe.db.sql(
			"""INSERT INTO "tabVendors" (name, creation, modified, modified_by, owner,
				   docstatus, idx, vendor_name, tds_deduction_percentage)
			   VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, 2)""",
			(cls.vendor, U, U, cls.vendor),
		)
		frappe.db.sql(
			"""INSERT INTO "tabService Requests" (name, creation, modified, modified_by, owner,
				   docstatus, idx, project, vendor, status, total_amount, amount_paid)
			   VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, 'Approved', 10000000, 0)""",
			(cls.sr, U, U, cls.project, cls.vendor),
		)
		frappe.db.sql(
			"""INSERT INTO "tabProcurement Orders" (name, creation, modified, modified_by, owner,
				   docstatus, idx, project, vendor, total_amount, amount_paid, status)
			   VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, 10000000, 0, 'PO Approved')""",
			(cls.po, U, U, cls.project, cls.vendor),
		)
		frappe.db.commit()

	@classmethod
	def tearDownClass(cls):
		frappe.set_user(U)
		like = f"{P}%"
		frappe.db.sql(f'DELETE FROM "tab{TDS_DOCTYPE}" WHERE project_payment LIKE %s', (like,))
		frappe.db.sql('DELETE FROM "tabVersion" WHERE docname LIKE %s', (like,))
		frappe.db.sql('DELETE FROM "tabNirmaan Notifications" WHERE docname LIKE %s', (like,))
		for dt in (PAYMENT, SR, PO, "Vendors", "Projects"):
			frappe.db.sql(f'DELETE FROM "tab{dt}" WHERE name LIKE %s', (like,))
		frappe.db.commit()
		super().tearDownClass()

	def setUp(self):
		super().setUp()
		# The endpoint's own gate. Driving the real `frappe.whitelist` entry point rather than
		# `_bulk_action` keeps the authorisation and the phase ordering inside the test.
		frappe.set_user(CEO_AUTHORIZED_USER)

	def tearDown(self):
		frappe.set_user(U)
		frappe.db.sql(
			f'DELETE FROM "tab{TDS_DOCTYPE}" WHERE project_payment LIKE %s', (f"{P}PAY-%",)
		)
		frappe.db.sql(f'DELETE FROM "tab{PAYMENT}" WHERE name LIKE %s', (f"{P}PAY-%",))
		frappe.db.commit()
		super().tearDown()

	# -- helpers ---------------------------------------------------------------------------
	def _pay(self, amount, status="CEO Pending", parent_dt=SR):
		"""A payment planted straight into the table — see `test_payment_tds`'s note on why."""
		name = f"{P}PAY-{frappe.generate_hash(length=8)}"
		frappe.db.sql(
			f"""INSERT INTO "tab{PAYMENT}" (name, creation, modified, modified_by, owner,
					docstatus, idx, project, vendor, amount, status, document_type, document_name)
				VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, %s, %s, %s)""",
			(
				name, U, U, self.project, self.vendor, amount, status,
				parent_dt, self.sr if parent_dt == SR else self.po,
			),
		)
		frappe.db.commit()
		return name

	def _status(self, pid):
		return frappe.db.get_value(PAYMENT, pid, "status")

	def _amount(self, pid):
		return frappe.db.get_value(PAYMENT, pid, "amount")

	def _deduction(self, pid):
		return payment_tds.existing_deduction(pid)

	# -- the happy path --------------------------------------------------------------------
	def test_bulk_approve_nets_every_sr_payment(self):
		"""The phase runs for the whole batch, not just the first payment."""
		a, b = self._pay(38550), self._pay(10000)

		res = bulk_actions.bulk_ceo_approve_payments([a, b], "approve")["data"]

		self.assertEqual(sorted(res["succeeded"]), sorted([a, b]))
		self.assertEqual(res["tds_recorded"], 2)
		self.assertEqual(res["tds_failed"], [])
		# The owner's worked case: 38,550 at 2% -> 771.00 withheld -> 37,779.00 net.
		self.assertEqual(self._amount(a), 37779.0)
		self.assertEqual(self._amount(b), 9800.0)
		self.assertTrue(self._deduction(a))
		self.assertTrue(self._deduction(b))

	def test_the_deduction_row_keeps_the_gross(self):
		"""`Project Payments.amount` is the net afterwards, so the row is the only gross left."""
		pid = self._pay(38550)
		bulk_actions.bulk_ceo_approve_payments([pid], "approve")
		row = frappe.get_doc(TDS_DOCTYPE, self._deduction(pid))
		self.assertEqual(row.gross_amount, 38550.0)
		self.assertEqual(row.tds_amount, 771.0)
		self.assertEqual(row.tds_percentage, 2.0)

	def test_exactly_one_row_per_payment(self):
		"""The controller hook is OFF on this path; a second row would mean it fired too."""
		pid = self._pay(38550)
		bulk_actions.bulk_ceo_approve_payments([pid], "approve")
		self.assertEqual(
			frappe.db.count(TDS_DOCTYPE, {"project_payment": pid}),
			1,
			"the hook and the post-commit phase both wrote — the bulk_approval flag is not holding",
		)
		self.assertEqual(self._amount(pid), 37779.0, "netted twice")

	# -- THE ONE THIS FILE EXISTS FOR ------------------------------------------------------
	def test_a_failed_deduction_does_not_lose_the_other_approvals(self):
		"""A DATABASE-level failure on one payment must cost that deduction and nothing else.

		Before the fix this aborted the shared transaction and the endpoint's commit ran as a
		ROLLBACK — every approval in the batch was lost while the response still reported them
		as succeeded.
		"""
		a, victim, c = self._pay(38550), self._pay(20000), self._pay(10000)

		real = payment_tds.record_deduction

		def exploding(doc, **kw):
			if doc.name == victim:
				# A genuine Postgres error, which is what aborts a transaction — not a Python
				# raise, which never did.
				frappe.db.sql('SELECT * FROM "tabNo Such Table Btds"')
			return real(doc, **kw)

		payment_tds.record_deduction = exploding
		try:
			res = bulk_actions.bulk_ceo_approve_payments([a, victim, c], "approve")["data"]
		finally:
			payment_tds.record_deduction = real

		# EVERY approval survived — that is the regression this guards.
		for pid in (a, victim, c):
			self.assertEqual(self._status(pid), "Approved", f"{pid} lost its approval")
		self.assertEqual(sorted(res["succeeded"]), sorted([a, victim, c]))

		# The failure is reported, not swallowed, and it names the payment to repair.
		self.assertEqual(res["tds_recorded"], 2)
		self.assertEqual(res["tds_failed"], [victim])

		# Its neighbours were still deducted from; the victim is left at gross.
		self.assertEqual(self._amount(a), 37779.0)
		self.assertEqual(self._amount(c), 9800.0)
		self.assertEqual(self._amount(victim), 20000.0)
		self.assertIsNone(self._deduction(victim))

	def test_a_failure_leaves_the_transaction_usable(self):
		"""The rollback in the phase clears Postgres' aborted state for the payments after it."""
		victim = self._pay(20000, status="Approved")
		after = self._pay(10000, status="Approved")
		real = payment_tds.record_deduction

		def exploding(doc, **kw):
			if doc.name == victim:
				frappe.db.sql('SELECT * FROM "tabNo Such Table Btds"')
			return real(doc, **kw)

		payment_tds.record_deduction = exploding
		try:
			bulk_actions._record_bulk_deductions([victim, after])
		finally:
			payment_tds.record_deduction = real

		# `after` comes AFTER the failure in the list, so it only works if the rollback ran.
		self.assertTrue(self._deduction(after))

	# -- the edges the phase must not touch ------------------------------------------------
	def test_a_procurement_order_payment_is_skipped(self):
		"""`DEDUCTIBLE_PARENTS` is SR-only; a PO has no `total_tds` to receive the total."""
		pid = self._pay(38550, status="Approved", parent_dt=PO)
		recorded, failed = bulk_actions._record_bulk_deductions([pid])
		self.assertEqual((recorded, failed), (0, []))
		self.assertIsNone(self._deduction(pid))
		self.assertEqual(self._amount(pid), 38550.0)

	def test_a_payment_not_at_approved_is_skipped(self):
		"""A rejected payment rides the same `succeeded` list on a reject run."""
		pid = self._pay(38550, status="Rejected")
		recorded, failed = bulk_actions._record_bulk_deductions([pid])
		self.assertEqual((recorded, failed), (0, []))
		self.assertIsNone(self._deduction(pid))

	def test_bulk_reject_records_nothing(self):
		"""The phase is gated on `action == "approve"`."""
		pid = self._pay(38550)
		res = bulk_actions.bulk_ceo_approve_payments([pid], "reject", "not needed")["data"]
		self.assertEqual(res["tds_recorded"], 0)
		self.assertEqual(res["tds_failed"], [])
		self.assertIsNone(self._deduction(pid))
		self.assertEqual(self._amount(pid), 38550.0)

	def test_lead_bulk_approve_records_nothing(self):
		"""Requested -> CEO Pending is not the deductible transition."""
		frappe.set_user(U)  # _authorize_lead admits Administrator
		pid = self._pay(38550, status="Requested")
		res = bulk_actions.bulk_lead_approve_payments([pid], "approve")["data"]
		self.assertEqual(self._status(pid), "CEO Pending")
		self.assertEqual(res["tds_recorded"], 0)
		self.assertIsNone(self._deduction(pid))
		self.assertEqual(self._amount(pid), 38550.0)

	def test_running_the_phase_twice_is_safe(self):
		"""Idempotent, so re-running it over `tds_failed` is a safe repair.

		⚠️ `recorded` COUNTS PAYMENTS THAT CARRY A DEDUCTION, NOT ROWS INSERTED. A re-run
		counts the payment again because `record_deduction` answers with the existing row.
		That is the useful reading — re-running over `tds_failed` reports how many are now
		covered — but the invariant that matters is below it: still one row, still netted once.
		"""
		pid = self._pay(38550)
		bulk_actions.bulk_ceo_approve_payments([pid], "approve")
		recorded, failed = bulk_actions._record_bulk_deductions([pid])
		self.assertEqual((recorded, failed), (1, []))
		self.assertEqual(frappe.db.count(TDS_DOCTYPE, {"project_payment": pid}), 1)
		self.assertEqual(self._amount(pid), 37779.0, "netted a second time")
