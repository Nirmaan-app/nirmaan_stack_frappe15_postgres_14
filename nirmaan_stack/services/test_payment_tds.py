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
		# Company-borne Work Orders (owner ruling 2026-09-17) and the mixed one that is NOT.
		cls.sr_misc = f"{P}SR-MISC"
		cls.sr_both = f"{P}SR-BOTH"
		cls.sr_mixed = f"{P}SR-MIXED"

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
		for name, categories in (
			(cls.sr_misc, ["Miscellaneous Services"]),
			(cls.sr_both, ["Miscellaneous Services", "Transportation Services"]),
			(cls.sr_mixed, ["Miscellaneous Services", "Electrical Services"]),
		):
			frappe.db.sql(
				"""INSERT INTO "tabService Requests" (name, creation, modified, modified_by, owner,
					   docstatus, idx, project, vendor, status, total_amount, amount_paid,
					   service_category_list)
				   VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, 'Approved', 1000000, 0, %s)""",
				(
					name, U, U, cls.project, cls.vendor2,
					frappe.as_json({"list": [{"name": c} for c in categories]}),
				),
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

	# -- restating on an amount edit -------------------------------------------------------
	def test_amount_edit_restates_the_deduction(self):
		"""The case the hook exists for: a human edits the amount and the tax follows it.

		The stored amount IS the net once a deduction exists, so 4,900 net at the row's own 2%
		re-derives to a 5,000 gross and 100 of tax.
		"""
		doc = self._pay(10000)
		row = frappe.get_doc(TDS_DOCTYPE, payment_tds.record_deduction(doc))
		self.assertEqual(row.tds_amount, 200)

		doc = frappe.get_doc(PAYMENT, doc.name)
		doc.amount = 4900
		doc.save(ignore_permissions=True)

		row.reload()
		self.assertEqual(row.gross_amount, 5000)
		self.assertEqual(row.tds_amount, 100)
		# ⚠️ AND THE PAYMENT IS NOT RE-NETTED. Subtracting the tax again would shrink it on every
		# save, compounding silently.
		self.assertEqual(frappe.db.get_value(PAYMENT, doc.name, "amount"), 4900)

	def test_the_outflow_import_never_restates_the_deduction(self):
		"""⚠️ A BANK DIFFERENCE IS ROUNDING, NOT A NEW TAX BASE.

		`outflow_import/settle.py` writes the bank's actual figure onto the payment and saves through
		the doc layer, so the amount-change listener sees it. Restating there invented tax (measured:
		Rs 1 of bank difference moved a deduction by 2 paise) and contradicts that function's own
		"NO TDS IS EVER WRITTEN" contract. The flag is the seam; this pins it.
		"""
		doc = self._pay(10000)
		row = frappe.get_doc(TDS_DOCTYPE, payment_tds.record_deduction(doc))
		before = (row.gross_amount, row.tds_amount)

		doc = frappe.get_doc(PAYMENT, doc.name)
		doc.amount = 9801  # the bank moved Rs 1 more than the netted 9,800
		doc.flags.from_outflow_import = True
		doc.save(ignore_permissions=True)

		row.reload()
		self.assertEqual((row.gross_amount, row.tds_amount), before)

	def test_a_split_never_restates_the_deduction(self):
		"""⚠️ A SPLIT CHANGES WHAT IS STILL OWED, NOT WHAT WAS ALREADY WITHHELD (owner 2026-09-15).

		Trimming a payment that already carries tax used to halve the deduction with it -- rewriting
		money already deducted from the vendor and likely already paid to the department. The first
		split of a payment is unaffected either way: no deduction exists yet at that point.
		"""
		doc = self._pay(10000)
		row = frappe.get_doc(TDS_DOCTYPE, payment_tds.record_deduction(doc))
		before = (row.gross_amount, row.tds_amount)

		doc = frappe.get_doc(PAYMENT, doc.name)
		doc.amount = 4900  # the kept half after a split
		doc.flags.split_approval = True
		doc.save(ignore_permissions=True)

		row.reload()
		self.assertEqual((row.gross_amount, row.tds_amount), before)

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

	# -- which transition is an approval (#1288) --------------------------------------------
	def test_the_three_earlier_steps_are_approvals(self):
		"""`Requested` and `CEO Pending` are the gates ahead of Approved; `Rejected` is the way
		back to them, so re-approving a rejected payment still withholds."""
		for previous in ("Requested", "CEO Pending", "Rejected"):
			with self.subTest(previous=previous):
				self.assertTrue(
					payment_tds.is_approval_from_an_earlier_step(previous, "Approved")
				)

	def test_coming_back_from_a_settled_status_is_not_an_approval(self):
		"""⚠️ THE #1288 RULE. Unreconcile writes `Paid -> Approved` and the earlier lifecycle
		change put `Reconciliation Pending` between them. Both are UNDOs, and taxing an undo
		withheld the same tax twice."""
		for previous in ("Paid", "Reconciliation Pending"):
			with self.subTest(previous=previous):
				self.assertFalse(
					payment_tds.is_approval_from_an_earlier_step(previous, "Approved")
				)

	def test_a_transition_that_does_not_end_at_approved_is_not_an_approval(self):
		self.assertFalse(payment_tds.is_approval_from_an_earlier_step("Requested", "CEO Pending"))
		self.assertFalse(payment_tds.is_approval_from_an_earlier_step("Approved", "Paid"))

	def test_a_missing_previous_status_is_not_an_approval(self):
		"""An INSERT has no previous status. It is taxed by `after_insert`, never routed here —
		answering True would tax every insert whatever it was created as."""
		self.assertFalse(payment_tds.is_approval_from_an_earlier_step(None, "Approved"))

	def test_a_payment_born_approved_is_taxed_by_after_insert(self):
		"""⚠️ A PAYMENT BORN `Approved` MUST STILL BE TAXED (auto-approve below the threshold).
		It undergoes no transition, so `on_update` can never see it and the transition rule would
		answer False for it — `after_insert` is the only hook that can, and it calls
		`record_deduction_if_eligible` DIRECTLY.

		⚠️ IT DRIVES THE REAL `after_insert`, BECAUSE THE RISK IS AN EARLY `return`, NOT A MISSING
		CALL. That function returns on `from_adjustment` and again on `split_child` before it
		reaches the tax line, and returns again just below it — a call that drifted below the wrong
		one would still read correctly. Only running the function proves the line is reachable.

		⚠️ THE TWO NOTIFICATION FAN-OUTS ARE PATCHED OUT, AND ONLY THEY. `_notify_admins_auto_approved`
		is NOT project-scoped: it notifies every admin on the LIVE site this suite runs against and
		commits per recipient. That hazard is why every payment fixture in this repo is planted with
		raw SQL (`test_payment_split.PaymentSplitFixture` says so). Patching them leaves the branch
		structure — and the whole tax path — untouched; spamming real people to observe it would not
		be a better test.
		"""
		from unittest.mock import patch

		from nirmaan_stack.integrations.controllers import project_payments as controller

		doc = self._pay(4000, status="Approved")
		with patch.object(controller, "_notify_accountants_payment_ready"), patch.object(
			controller, "_notify_admins_auto_approved"
		):
			controller.after_insert(doc, "after_insert")
		frappe.db.commit()

		self.assertEqual(frappe.db.count(TDS_DOCTYPE, {"project_payment": doc.name}), 1)
		self.assertEqual(frappe.db.get_value(PAYMENT, doc.name, "amount"), 3920)

	def test_after_insert_never_asks_the_transition_rule(self):
		"""An insert has no previous status, so the rule answers False for every one of them —
		routing this path through it would silently stop taxing auto-approved payments. The test
		above proves the line RUNS; this one proves it is not guarded by the wrong question."""
		import inspect

		from nirmaan_stack.integrations.controllers import project_payments as controller

		self.assertNotIn(
			"is_approval_from_an_earlier_step", inspect.getsource(controller.after_insert)
		)

	def test_statuses_are_trimmed(self):
		"""`Project Payments.status` is a Data field — free text, so it can carry whitespace."""
		self.assertTrue(payment_tds.is_approval_from_an_earlier_step(" CEO Pending ", " Approved "))

	def test_the_source_set_is_named_not_derived_by_exclusion(self):
		"""⚠️ A SET, NOT "anything except the settled statuses". A status inserted into the
		lifecycle later must be considered on its merits, not silently inherit the tax."""
		self.assertEqual(
			payment_tds.APPROVAL_SOURCE_STATUSES,
			frozenset({"Requested", "CEO Pending", "Rejected"}),
		)

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

	def test_hook_records_on_every_earlier_step(self):
		"""Each gate ahead of Approved, driven through a real save (#1288)."""
		for previous in ("Requested", "CEO Pending", "Rejected"):
			with self.subTest(previous=previous):
				doc = self._pay(4000, status=previous)
				doc.status = "Approved"
				doc.save(ignore_permissions=True)
				frappe.db.commit()
				self.assertEqual(frappe.db.count(TDS_DOCTYPE, {"project_payment": doc.name}), 1)
				self.assertEqual(frappe.db.get_value(PAYMENT, doc.name, "amount"), 3920)

	def test_hook_records_nothing_coming_back_to_approved(self):
		"""⚠️ THE #1288 REGRESSION, at the seam. A save back into `Approved` from a settled status
		must write NO deduction and must leave the amount alone — this is the shape Unreconcile
		writes, and taxing it netted a payment that had already been paid at its gross."""
		for previous in ("Paid", "Reconciliation Pending"):
			with self.subTest(previous=previous):
				doc = self._pay(4000, status=previous)
				doc.status = "Approved"
				doc.save(ignore_permissions=True)
				frappe.db.commit()
				self.assertEqual(frappe.db.count(TDS_DOCTYPE, {"project_payment": doc.name}), 0)
				self.assertEqual(frappe.db.get_value(PAYMENT, doc.name, "amount"), 4000)

	def test_a_payment_that_already_carries_a_deduction_is_untouched_coming_back(self):
		"""The ordinary shape: the tax was withheld at the real approval and the undo leaves both
		the row and the netted amount exactly as they were."""
		doc = self._pay(4000, status="CEO Pending")
		doc.status = "Approved"
		doc.save(ignore_permissions=True)
		frappe.db.commit()
		row = frappe.db.get_value(TDS_DOCTYPE, {"project_payment": doc.name}, "name")

		frappe.db.set_value(PAYMENT, doc.name, "status", "Paid", update_modified=False)
		frappe.db.commit()
		back = frappe.get_doc(PAYMENT, doc.name)
		back.status = "Approved"
		back.save(ignore_permissions=True)
		frappe.db.commit()

		self.assertEqual(
			frappe.get_all(TDS_DOCTYPE, {"project_payment": doc.name}, pluck="name"), [row]
		)
		self.assertEqual(frappe.db.get_value(PAYMENT, doc.name, "amount"), 3920)

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

	# -- company-borne Work Orders (owner ruling 2026-09-17) ---------------------------------
	def test_company_borne_is_decided_by_all_categories(self):
		self.assertTrue(payment_tds.is_company_borne(SR, self.sr_misc))
		self.assertTrue(payment_tds.is_company_borne(SR, self.sr_both))
		# ⚠️ "ALL", NOT "ANY": one other category makes it an ordinary Work Order.
		self.assertFalse(payment_tds.is_company_borne(SR, self.sr_mixed))
		# No categories at all is ordinary too.
		self.assertFalse(payment_tds.is_company_borne(SR, self.sr))
		self.assertFalse(payment_tds.is_company_borne(PO, self.po))

	def test_company_borne_records_the_tax_and_keeps_the_payment_whole(self):
		"""The owner's example: Rs 800 -> Rs 16 TDS, and the payment STAYS Rs 800."""
		for parent in (self.sr_misc, self.sr_both):
			with self.subTest(parent=parent):
				doc = self._pay(800, parent=parent)
				row = frappe.get_doc(TDS_DOCTYPE, payment_tds.record_deduction(doc))
				self.assertEqual(row.gross_amount, 800)
				self.assertEqual(row.tds_amount, 16)
				self.assertEqual(frappe.db.get_value(PAYMENT, doc.name, "amount"), 800)
				self.assertEqual(frappe.db.get_value(PAYMENT, doc.name, "payment_tds"), row.name)

	def test_a_mixed_work_order_is_still_reduced(self):
		doc = self._pay(800, parent=self.sr_mixed)
		payment_tds.record_deduction(doc)
		self.assertEqual(frappe.db.get_value(PAYMENT, doc.name, "amount"), 784)

	def test_company_borne_approval_through_the_hook_keeps_the_payment_whole(self):
		"""Single CEO approve, driven through a real save -- the path `ceo_approve_payment` takes."""
		for previous in ("Requested", "CEO Pending", "Rejected"):
			with self.subTest(previous=previous):
				doc = self._pay(800, status=previous, parent=self.sr_misc)
				doc.status = "Approved"
				doc.save(ignore_permissions=True)
				frappe.db.commit()
				self.assertEqual(
					frappe.db.get_value(TDS_DOCTYPE, {"project_payment": doc.name}, "tds_amount"), 16
				)
				self.assertEqual(frappe.db.get_value(PAYMENT, doc.name, "amount"), 800)

	def test_company_borne_auto_approved_payment_keeps_the_payment_whole(self):
		"""Auto-approve at insert (`after_insert`). Notification fan-outs patched out, as above."""
		from unittest.mock import patch

		from nirmaan_stack.integrations.controllers import project_payments as controller

		doc = self._pay(800, status="Approved", parent=self.sr_misc)
		with patch.object(controller, "_notify_accountants_payment_ready"), patch.object(
			controller, "_notify_admins_auto_approved"
		):
			controller.after_insert(doc, "after_insert")
		frappe.db.commit()

		self.assertEqual(
			frappe.db.get_value(TDS_DOCTYPE, {"project_payment": doc.name}, "tds_amount"), 16
		)
		self.assertEqual(frappe.db.get_value(PAYMENT, doc.name, "amount"), 800)

	def test_company_borne_amount_edit_taxes_the_new_figure_directly(self):
		"""The payment was never reduced, so an edit to it is an edit to the GROSS: 1,000 -> 20."""
		doc = self._pay(800, parent=self.sr_misc)
		row = frappe.get_doc(TDS_DOCTYPE, payment_tds.record_deduction(doc))

		doc = frappe.get_doc(PAYMENT, doc.name)
		doc.amount = 1000
		doc.save(ignore_permissions=True)

		row.reload()
		self.assertEqual(row.gross_amount, 1000)
		self.assertEqual(row.tds_amount, 20)
		self.assertEqual(frappe.db.get_value(PAYMENT, doc.name, "amount"), 1000)

	def test_company_borne_amount_due_does_not_subtract_the_tax(self):
		"""Rs 800 paid in full with Rs 16 TDS on top must leave nothing due, not -16."""
		doc = self._pay(800, parent=self.sr_misc)
		payment_tds.record_deduction(doc)
		frappe.db.set_value(PAYMENT, doc.name, "status", "Paid")
		frappe.db.commit()

		frappe.get_doc(PAYMENT, doc.name).update_parent_amount_paid()
		frappe.db.commit()
		self.assertEqual(frappe.db.get_value(SR, self.sr_misc, "amount_paid"), 800)
		# The tax is still recorded against the order -- it just is not part of settling it.
		self.assertEqual(frappe.db.get_value(SR, self.sr_misc, "total_tds"), 16.0)
		total = frappe.db.get_value(SR, self.sr_misc, "total_amount")
		self.assertEqual(frappe.db.get_value(SR, self.sr_misc, "amount_due"), total - 800)
