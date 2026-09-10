# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Tests for `services/payment_tds.py` — the SR tax deduction and the parent's running total.

⚠️ THIS SUITE RUNS AGAINST THE LIVE SITE DATABASE. There is no separate test DB on this bench, so
every fixture is named `TEST-PTDS-*` and `tearDownClass` deletes exactly that set and nothing else.

⚠️ FIXTURES ARE RAW-INSERTED, AND THAT IS THE POINT rather than a shortcut. Creating a payment
through `doc.insert()` fires the very hook half these tests exist to check, so the arrangement and
the assertion would share a mechanism — a broken hook would plant the row it was supposed to be
proving. The same reasoning is written into `api/outflow_import/test_settle_payment.py`, which
plants its payments the same way. `test_hook_records_on_approval_transition` is the deliberate
exception: it drives a real `doc.save()`, because a test on each side of a boundary is not a test
of the boundary.

The test project carries NO assigned accountants, which is what makes that one safe to run against
live data: `_notify_accountants_payment_ready` is project-scoped, so it finds nobody, prints, and
returns without minting a notification or sending a push.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services import payment_tds

TDS_DOCTYPE = "Payment TDS Deduction"
PAYMENT = "Project Payments"
SR = "Service Requests"
PO = "Procurement Orders"

P = "TEST-PTDS-"
U = "Administrator"


class TestPaymentTDS(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.project = f"{P}PROJ-0001"
		cls.vendor2 = f"{P}VEN-RATE2"
		cls.vendor0 = f"{P}VEN-RATE0"
		cls.sr = f"{P}SR-0001"
		cls.po = f"{P}PO-0001"

		frappe.db.sql(
			"""INSERT INTO "tabProjects" (name, creation, modified, modified_by, owner,
				   docstatus, idx, project_name, tendering_status)
			   VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, 'Won')""",
			(cls.project, U, U, "TEST PTDS Project"),
		)
		for name, rate in ((cls.vendor2, 2), (cls.vendor0, 0)):
			frappe.db.sql(
				"""INSERT INTO "tabVendors" (name, creation, modified, modified_by, owner,
					   docstatus, idx, vendor_name, tds_deduction_percentage)
				   VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s)""",
				(name, U, U, name, rate),
			)
		frappe.db.sql(
			"""INSERT INTO "tabService Requests" (name, creation, modified, modified_by, owner,
				   docstatus, idx, project, vendor, status, total_amount, amount_paid)
			   VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, 'Approved', 1000000, 0)""",
			(cls.sr, U, U, cls.project, cls.vendor2),
		)
		frappe.db.sql(
			"""INSERT INTO "tabProcurement Orders" (name, creation, modified, modified_by, owner,
				   docstatus, idx, project, vendor, total_amount, amount_paid, status)
			   VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, 1000000, 0, 'PO Approved')""",
			(cls.po, U, U, cls.project, cls.vendor2),
		)
		frappe.db.commit()

	@classmethod
	def tearDownClass(cls):
		like = f"{P}%"
		frappe.db.sql(f'DELETE FROM "tab{TDS_DOCTYPE}" WHERE project_payment LIKE %s', (like,))
		frappe.db.sql('DELETE FROM "tabVersion" WHERE docname LIKE %s', (like,))
		# A status transition can mint an in-app note; purge any that name a fixture.
		frappe.db.sql('DELETE FROM "tabNirmaan Notifications" WHERE docname LIKE %s', (like,))
		for dt in (PAYMENT, SR, PO, "Vendors", "Projects"):
			frappe.db.sql(f'DELETE FROM "tab{dt}" WHERE name LIKE %s', (like,))
		frappe.db.commit()
		super().tearDownClass()

	def tearDown(self):
		# Each test owns its payments; the deduction rows hang off them.
		frappe.db.sql(
			f'DELETE FROM "tab{TDS_DOCTYPE}" WHERE project_payment LIKE %s', (f"{P}PAY-%",)
		)
		frappe.db.sql(f'DELETE FROM "tab{PAYMENT}" WHERE name LIKE %s', (f"{P}PAY-%",))
		frappe.db.commit()
		super().tearDown()

	# -- helpers ---------------------------------------------------------------------------
	def _pay(self, amount, status="Approved", parent_dt=SR, parent=None, vendor=None):
		name = f"{P}PAY-{frappe.generate_hash(length=8)}"
		frappe.db.sql(
			f"""INSERT INTO "tab{PAYMENT}" (name, creation, modified, modified_by, owner,
					docstatus, idx, project, vendor, amount, status, document_type, document_name)
				VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, %s, %s, %s)""",
			(
				name, U, U, self.project, vendor or self.vendor2, amount, status,
				parent_dt, parent or (self.sr if parent_dt == SR else self.po),
			),
		)
		frappe.db.commit()
		return frappe.get_doc(PAYMENT, name)

	# -- rate ------------------------------------------------------------------------------
	def test_rate_is_read_from_the_vendor(self):
		self.assertEqual(payment_tds.vendor_rate(self.vendor2), 2.0)

	def test_zero_rate_answers_none_not_zero(self):
		"""A 0% vendor must produce NO ROW, not a row claiming zero tax was withheld."""
		self.assertIsNone(payment_tds.vendor_rate(self.vendor0))

	# -- eligibility -----------------------------------------------------------------------
	def test_sr_payment_at_approved_is_deductible(self):
		self.assertTrue(payment_tds.is_deductible(self._pay(4000)))

	def test_po_payment_is_not_deductible(self):
		"""Owner scope 2026-09-10: Service Requests only."""
		self.assertFalse(payment_tds.is_deductible(self._pay(4000, parent_dt=PO)))

	def test_unapproved_payment_is_not_deductible(self):
		for status in ("Requested", "CEO Pending", "Paid", "Rejected"):
			with self.subTest(status=status):
				self.assertFalse(payment_tds.is_deductible(self._pay(4000, status=status)))

	# -- the figures -----------------------------------------------------------------------
	def test_the_owners_worked_case(self):
		"""PAY-00103-283: Rs 38,550 at 2% -> Rs 771.00 withheld -> Rs 37,779.00 is the amount."""
		doc = self._pay(38550)
		row = frappe.get_doc(TDS_DOCTYPE, payment_tds.record_deduction(doc))
		self.assertEqual(row.gross_amount, 38550)
		self.assertEqual(row.tds_percentage, 2)
		self.assertEqual(row.tds_amount, 771)
		self.assertEqual(row.document_type, SR)
		self.assertEqual(row.document_name, self.sr)
		self.assertEqual(frappe.db.get_value(PAYMENT, doc.name, "amount"), 37779)

	def test_payment_amount_is_rewritten_to_net(self):
		"""Owner ruling 2026-09-10: the stored amount becomes what leaves the bank."""
		doc = self._pay(4000)
		payment_tds.record_deduction(doc)
		self.assertEqual(frappe.db.get_value(PAYMENT, doc.name, "amount"), 3920)
		self.assertEqual(doc.amount, 3920, "db_set must update the in-memory doc too")

	def test_gross_survives_only_on_the_deduction_row(self):
		"""The rewrite destroys the original; `gross_amount` is the sole record of it."""
		doc = self._pay(4000)
		row = frappe.get_doc(TDS_DOCTYPE, payment_tds.record_deduction(doc))
		self.assertEqual(row.gross_amount, 4000)
		self.assertEqual(frappe.db.get_value(PAYMENT, doc.name, "amount"), 3920)

	def test_rounding_is_two_decimals(self):
		doc = self._pay(1333.33)
		row = frappe.get_doc(TDS_DOCTYPE, payment_tds.record_deduction(doc))
		self.assertEqual(row.tds_amount, 26.67)
		self.assertEqual(frappe.db.get_value(PAYMENT, doc.name, "amount"), 1306.66)

	def test_zero_rate_vendor_writes_nothing(self):
		doc = self._pay(4000, vendor=self.vendor0)
		self.assertIsNone(payment_tds.record_deduction(doc))
		self.assertEqual(frappe.db.count(TDS_DOCTYPE, {"project_payment": doc.name}), 0)

	def test_non_positive_amount_writes_nothing(self):
		self.assertIsNone(payment_tds.record_deduction(self._pay(0)))
		self.assertIsNone(payment_tds.record_deduction(self._pay(-500)))

	# -- idempotence -----------------------------------------------------------------------
	def test_recording_twice_yields_one_row_and_one_reduction(self):
		"""An approved payment can be re-saved; a second reduction would corrupt the amount."""
		doc = self._pay(4000)
		first = payment_tds.record_deduction(doc)
		second = payment_tds.record_deduction(doc)
		self.assertEqual(first, second)
		self.assertEqual(frappe.db.count(TDS_DOCTYPE, {"project_payment": doc.name}), 1)
		self.assertEqual(frappe.db.get_value(PAYMENT, doc.name, "amount"), 3920)

	def test_eligible_wrapper_swallows_failures(self):
		"""It rides alongside an approval a person just performed and must never undo it."""
		doc = self._pay(4000)
		doc.vendor = "TEST-PTDS-VEN-DOES-NOT-EXIST"
		self.assertIsNone(payment_tds.record_deduction_if_eligible(doc))

	def test_update_modified_false_leaves_the_payment_untouched(self):
		"""What the backfill patch relies on: net the amount without stamping a human editor.

		A bumped `modified` would raise TimestampMismatchError under anyone holding the payment
		open, and would claim a person edited a record nothing edited.
		"""
		doc = self._pay(4000)
		before = frappe.db.get_value(PAYMENT, doc.name, ["modified", "modified_by"], as_dict=True)

		payment_tds.record_deduction(doc, update_modified=False)
		after = frappe.db.get_value(PAYMENT, doc.name, ["modified", "modified_by", "amount"], as_dict=True)

		self.assertEqual(after.amount, 3920, "the amount must still be rewritten")
		self.assertEqual(after.modified, before.modified)
		self.assertEqual(after.modified_by, before.modified_by)

	def test_update_modified_defaults_to_stamping(self):
		"""The hook path keeps the ordinary behaviour - only the patch opts out."""
		doc = self._pay(4000)
		payment_tds.record_deduction(doc)
		self.assertEqual(frappe.db.get_value(PAYMENT, doc.name, "amount"), 3920)

	# -- the parent total ------------------------------------------------------------------
	def test_total_counts_paid_payments_only(self):
		"""Mirrors `amount_paid`: an Approved deduction is real, but not yet withheld."""
		approved = self._pay(4000)
		payment_tds.record_deduction(approved)
		self.assertEqual(payment_tds.total_tds_of(SR, self.sr), 0.0)

		frappe.db.set_value(PAYMENT, approved.name, "status", "Paid")
		frappe.db.commit()
		self.assertEqual(payment_tds.total_tds_of(SR, self.sr), 80.0)

	def test_total_sums_several_payments(self):
		for amount in (4000, 10000):  # -> 80 + 200
			doc = self._pay(amount)
			payment_tds.record_deduction(doc)
			frappe.db.set_value(PAYMENT, doc.name, "status", "Paid")
		frappe.db.commit()
		self.assertEqual(payment_tds.total_tds_of(SR, self.sr), 280.0)

	def test_total_honours_exclude_payment(self):
		"""`on_trash` passes it because the row is still in the database at that moment."""
		doc = self._pay(4000)
		payment_tds.record_deduction(doc)
		frappe.db.set_value(PAYMENT, doc.name, "status", "Paid")
		frappe.db.commit()
		self.assertEqual(payment_tds.total_tds_of(SR, self.sr), 80.0)
		self.assertEqual(payment_tds.total_tds_of(SR, self.sr, exclude_payment=doc.name), 0.0)

	def test_deleting_the_payment_deletes_the_deduction(self):
		"""No reversal exists, so the row does not outlive its payment. It must also not BLOCK
		the delete: the Link would refuse it, and Frappe checks links AFTER on_trash."""
		doc = self._pay(4000)
		payment_tds.record_deduction(doc)
		frappe.delete_doc(PAYMENT, doc.name, force=False, ignore_permissions=True)
		frappe.db.commit()
		self.assertEqual(frappe.db.count(TDS_DOCTYPE, {"project_payment": doc.name}), 0)
		self.assertFalse(frappe.db.exists(PAYMENT, doc.name))

	def test_total_is_zero_for_a_non_deductible_parent(self):
		self.assertEqual(payment_tds.total_tds_of(PO, self.po), 0.0)

	def test_sync_writes_the_field(self):
		doc = self._pay(4000)
		payment_tds.record_deduction(doc)
		frappe.db.set_value(PAYMENT, doc.name, "status", "Paid")
		frappe.db.commit()
		payment_tds.sync_total_tds(SR, self.sr)
		self.assertEqual(frappe.db.get_value(SR, self.sr, "total_tds"), 80.0)

	def test_sync_no_ops_for_a_procurement_order(self):
		"""A PO has no `total_tds` column; writing one would raise."""
		self.assertEqual(payment_tds.sync_total_tds(PO, self.po), 0.0)

	# -- the boundary ----------------------------------------------------------------------
	def test_hook_records_on_approval_transition(self):
		"""The controller wiring itself: a real `doc.save()` into Approved must mint the row.

		Unit-testing the service and unit-testing the controller separately would leave the JOIN
		untested — the case where the call exists but sits below an early `return`.
		"""
		doc = self._pay(4000, status="CEO Pending")
		doc.status = "Approved"
		doc.save(ignore_permissions=True)
		frappe.db.commit()
		self.assertEqual(frappe.db.count(TDS_DOCTYPE, {"project_payment": doc.name}), 1)

	def test_hook_does_not_fire_for_a_po_payment(self):
		doc = self._pay(4000, status="CEO Pending", parent_dt=PO)
		doc.status = "Approved"
		doc.save(ignore_permissions=True)
		frappe.db.commit()
		self.assertEqual(frappe.db.count(TDS_DOCTYPE, {"project_payment": doc.name}), 0)

	def test_amount_paid_recompute_moves_total_tds_with_it(self):
		"""The two totals are written in one pass, so they can never describe different sets.

		⚠️ IT DRIVES `update_parent_amount_paid` DIRECTLY RATHER THAN SAVING INTO `Paid`, AND THAT
		IS NOT A SHORTCUT. The Approved -> Paid transition fires a "Payment Fulfilled" push, and
		unlike the accountant notification on the Approved transition that one is NOT project-
		scoped — it reaches admins and the CEO. An earlier revision of this test used `doc.save()`
		and sent a real push about a fixture payment to a real person. The recompute is what this
		test is about; the notification is somebody else's behaviour.
		"""
		doc = self._pay(4000)
		payment_tds.record_deduction(doc)
		frappe.db.set_value(PAYMENT, doc.name, "status", "Paid")
		frappe.db.commit()

		frappe.get_doc(PAYMENT, doc.name).update_parent_amount_paid()
		frappe.db.commit()
		# amount_paid is the NET sum now; amount_due closes only because total_tds is subtracted too.
		self.assertEqual(frappe.db.get_value(SR, self.sr, "amount_paid"), 3920)
		self.assertEqual(frappe.db.get_value(SR, self.sr, "total_tds"), 80.0)
		total = frappe.db.get_value(SR, self.sr, "total_amount")
		self.assertEqual(frappe.db.get_value(SR, self.sr, "amount_due"), total - 3920 - 80)
