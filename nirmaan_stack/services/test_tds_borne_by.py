# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Who bears a Work Order's TDS is stored on each deduction, `Payment TDS Deduction.borne_by` (#1451).

"Vendor": the tax was withheld from the vendor's payment (the payment was cut to the net).
"Company": the company paid it on top (the payment was kept whole). The category rule
(`payment_tds.is_company_borne`) decides it once, when the deduction is created; every reader after
that reads the field: the Amount Due writer, the mismatch judge, an amount edit, the request cap.

Driven through the real doors: approval by `ceo_approve_payment` (`TaxedWorkOrderFixture`), Paid by
a payment save, delete by `frappe.delete_doc`. Categories are changed by `set_value` to stand in for
an amend: the categories are this suite's input, not what it tests.

⚠️ RUNS AGAINST THE SITE DATABASE. Everything is `TEST-TWO-*`, purged by `TaxedWorkOrderFixture`.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.services.amount_paid import write_amount_paid
from nirmaan_stack.services.amount_paid_drift import mismatches
from nirmaan_stack.services.order_payments import work_order_summary

PAYMENT = "Project Payments"
PTD = "Payment TDS Deduction"
SR = "Service Requests"
MISC = ["Miscellaneous Services"]
MISC_AND_ELECTRICAL = ["Miscellaneous Services", "Electrical Services"]


class BorneByFixture(FrappeTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		self.fx = TaxedWorkOrderFixture.attach(self)
		self.project = self.fx.project()
		self.vendor = self.fx.vendor(2.0)

	def _wo(self, categories, total=100000):
		return self.fx.service_request(self.project, self.vendor, total=total, categories=categories)

	def _approve(self, wo, gross):
		return self.fx.payment(gross, project=self.project, vendor=self.vendor, service_request=wo)

	def _set_categories(self, wo, categories):
		frappe.db.set_value(SR, wo, "service_category_list", frappe.as_json({"list": [{"name": c} for c in categories]}))
		frappe.db.commit()

	def _pay(self, payment):
		doc = frappe.get_doc(PAYMENT, payment)
		doc.status = "Paid"
		doc.save(ignore_permissions=True)
		frappe.db.commit()

	def _borne_by(self, made):
		return frappe.db.get_value(PTD, made.deduction, "borne_by")

	def _wo_figures(self, wo):
		row = frappe.db.get_value(SR, wo, ["amount_paid", "total_tds", "amount_due"], as_dict=True)
		return flt(row.amount_paid, 2), flt(row.total_tds, 2), flt(row.amount_due, 2)


class TestTheDeductionRecordsWhoBearsTheTax(BorneByFixture):
	def test_an_ordinary_work_order_withholds_it_from_the_vendor(self):
		made = self._approve(self._wo(MISC_AND_ELECTRICAL), 10000)
		self.assertEqual((made.net, made.tds, self._borne_by(made)), (9800.0, 200.0, "Vendor"))

	def test_a_misc_only_work_order_pays_it_on_top(self):
		made = self._approve(self._wo(MISC), 10000)
		self.assertEqual((made.net, made.tds, self._borne_by(made)), (10000.0, 200.0, "Company"))


class TestAWorkOrderWithBothKinds(BorneByFixture):
	"""SR-00107-001055: one payment had 120 withheld (approved while the WO was ordinary), one was kept
	whole with 282.40 paid on top. Paid 5,880 + 120 withheld + 14,120 on a 20,120 order: nothing is due."""

	def setUp(self):
		super().setUp()
		self.wo = self._wo(MISC_AND_ELECTRICAL, total=20120)
		self.withheld = self._approve(self.wo, 6000)
		self._set_categories(self.wo, MISC)
		self.kept_whole = self._approve(self.wo, 14120)
		self._pay(self.withheld.name)
		self._pay(self.kept_whole.name)

	def test_each_deduction_keeps_its_own_kind(self):
		self.assertEqual((self.withheld.net, self.withheld.tds), (5880.0, 120.0))
		self.assertEqual((self.kept_whole.net, self.kept_whole.tds), (14120.0, 282.4))
		self.assertEqual((self._borne_by(self.withheld), self._borne_by(self.kept_whole)), ("Vendor", "Company"))

	def test_amount_paid_counts_only_the_tax_withheld_from_the_vendor(self):
		self.assertEqual(self._wo_figures(self.wo), (20120.0, 402.4, 0.0))
		self.assertEqual(mismatches(SR, [self.wo]), [])

	def test_the_request_cap_counts_each_payment_at_what_was_requested(self):
		# 5,880 + 120 withheld, and 14,120 kept whole: 20,120 committed, nothing left.
		summary = work_order_summary(frappe.get_doc(SR, self.wo))
		self.assertEqual(summary["lines"]["paid"], 20120.0)
		self.assertEqual(summary["left"], 0.0)

	def test_deleting_the_kept_whole_payment_takes_its_tax_out(self):
		# `on_trash` recounts with the payment still in the table (`exclude_payment`): its 282.40 must
		# leave `total_tds` with it. What stays paid is 5,880 + the 120 withheld.
		frappe.delete_doc(PAYMENT, self.kept_whole.name, force=True, ignore_permissions=True)
		frappe.db.commit()
		self.assertEqual(self._wo_figures(self.wo), (6000.0, 120.0, 14120.0))
		self.assertEqual(mismatches(SR, [self.wo]), [])


class TestLaterChangesDoNotMoveAnOldDeduction(BorneByFixture):
	def test_an_amount_edit_of_a_withheld_payment_keeps_it_withheld(self):
		"""The WO became Misc-only after the payment was approved. The edited 4,900 is still a net:
		4,900 / 0.98 = 5,000 gross, 100 withheld, not 4,900 gross with 98 paid on top."""
		wo = self._wo(MISC_AND_ELECTRICAL)
		made = self._approve(wo, 10000)
		self._set_categories(wo, MISC)

		doc = frappe.get_doc(PAYMENT, made.name)
		doc.amount = 4900
		doc.save(ignore_permissions=True)
		frappe.db.commit()

		row = frappe.db.get_value(PTD, made.deduction, ["gross_amount", "tds_amount", "borne_by"], as_dict=True)
		self.assertEqual((flt(row.gross_amount), flt(row.tds_amount), row.borne_by), (5000.0, 100.0, "Vendor"))

	def test_an_amount_edit_of_a_kept_whole_payment_keeps_it_on_the_company(self):
		"""And the other way: the WO gained Electrical after approval. 10,000 kept whole, edited to
		5,000, is still the gross: 100 paid on top."""
		wo = self._wo(MISC)
		made = self._approve(wo, 10000)
		self._set_categories(wo, MISC_AND_ELECTRICAL)

		doc = frappe.get_doc(PAYMENT, made.name)
		doc.amount = 5000
		doc.save(ignore_permissions=True)
		frappe.db.commit()

		row = frappe.db.get_value(PTD, made.deduction, ["gross_amount", "tds_amount", "borne_by"], as_dict=True)
		self.assertEqual((flt(row.gross_amount), flt(row.tds_amount), row.borne_by), (5000.0, 100.0, "Company"))
		self.assertEqual(flt(frappe.db.get_value(PAYMENT, made.name, "amount")), 5000.0)

	def test_adding_a_category_later_changes_nothing_already_paid(self):
		wo = self._wo(MISC, total=10000)
		made = self._approve(wo, 10000)
		self._pay(made.name)
		before = self._wo_figures(wo)
		self.assertEqual(before, (10000.0, 200.0, 0.0))

		self._set_categories(wo, MISC_AND_ELECTRICAL)
		write_amount_paid(SR, wo)
		frappe.db.commit()

		self.assertEqual(self._wo_figures(wo), before)
		self.assertEqual(self._borne_by(made), "Company")
		self.assertEqual(mismatches(SR, [wo]), [])
		self.assertEqual(work_order_summary(frappe.get_doc(SR, wo))["left"], 0.0)


class TestTheBackfillReadsEachOldDeductionOffItsPayment(BorneByFixture):
	"""`patches/v3_0/backfill_payment_tds_borne_by`: rows written before the field existed. A payment
	still at the deduction's gross was kept whole; one at gross - tds had the tax withheld. Only a
	company-borne Work Order's payment was ever kept whole."""

	def _plant(self, wo, amount, gross, tds, status="Paid"):
		"""A payment and its deduction as an old row left them: no `borne_by` decided."""
		payment = self.fx._name("PAY")
		frappe.db.sql(
			"""INSERT INTO "tabProject Payments" (name, creation, modified, modified_by, owner, docstatus,
				   idx, project, vendor, amount, status, document_type, document_name)
			   VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, %s, %s, %s, %s, %s)""",
			(payment, self.project, self.vendor, amount, status, SR, wo),
		)
		self.fx.payments.append(payment)
		deduction = self.fx._name("PTD")
		frappe.db.sql(
			f"""INSERT INTO "tab{PTD}" (name, creation, modified, modified_by, owner, docstatus, idx,
				   project_payment, document_type, document_name, vendor, project, gross_amount,
				   tds_percentage, tds_amount, payment_approved_on, borne_by)
			   VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, %s, %s, %s, %s,
				   %s, 1, %s, CURRENT_DATE, NULL)""",
			(deduction, payment, SR, wo, self.vendor, self.project, gross, tds),
		)
		frappe.db.commit()
		return deduction

	def test_each_row_gets_the_kind_its_payment_shows(self):
		from nirmaan_stack.patches.v3_0.backfill_payment_tds_borne_by import backfill

		misc, ordinary = self._wo(MISC), self._wo(MISC_AND_ELECTRICAL)
		rows = {
			# SR-00041-000138: Misc-only, paid in 2025 net of its tax.
			"withheld on a misc WO": (self._plant(misc, 24552, 24800, 248), "Vendor"),
			# SR-00203-001113: Misc-only, approved after the rule, kept whole.
			"kept whole on a misc WO": (self._plant(misc, 12000, 12000, 240), "Company"),
			# The outflow import wrote the bank's figure, a few rupees off the gross: still kept whole.
			"kept whole, bank rounding": (self._plant(misc, 12003, 12000, 240), "Company"),
			# Not yet Paid: the row is decided all the same.
			"kept whole, still Approved": (self._plant(misc, 5000, 5000, 100, status="Approved"), "Company"),
			# SR-00190-001007: ordinary, its deduction restated off its payment, so nearer its gross.
			"ordinary WO nearer its gross": (self._plant(ordinary, 9990, 10000, 200), "Vendor"),
			"withheld on an ordinary WO": (self._plant(ordinary, 9800, 10000, 200), "Vendor"),
		}

		backfill([name for name, _ in rows.values()])
		frappe.db.commit()

		self.assertEqual(
			{case: frappe.db.get_value(PTD, name, "borne_by") for case, (name, _) in rows.items()},
			{case: expected for case, (_, expected) in rows.items()},
		)
