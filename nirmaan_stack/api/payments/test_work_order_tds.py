# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The Work Order page's TDS label, as a Procurement user sees it (#1451, walk story 27).

`Payment TDS Deduction` is readable only by the accountants, so the page cannot read who bore a Work
Order's tax off the deductions itself: a Procurement user got a 403 and the page fell back to the
category rule, labelling a vendor-withheld Misc-only Work Order "TDS (paid by company)". The page now
asks `get_work_order_tds`, which checks read on the Work Order and reads the deductions on its Paid
payments only, the same population `total_tds` (the figure beside the label) counts. The same answer
carries each payment's own deduction for the transactions table's TDS column, so the page reads the
doctype nowhere.

⚠️ RUNS AGAINST THE SITE DATABASE. Everything is `TEST-TWO-*`, purged by `TaxedWorkOrderFixture`; the
user is created and deleted here.
"""

import frappe
from frappe.permissions import add_user_permission

from nirmaan_stack.api.payments.work_order_tds import get_paid_work_order_payment_tds, get_work_order_tds
from nirmaan_stack.services.test_tds_borne_by import MISC, MISC_AND_ELECTRICAL, BorneByFixture

PTD = "Payment TDS Deduction"
SR = "Service Requests"
PROCUREMENT = "Nirmaan Procurement Executive"
PROJECT_LEAD = "Nirmaan Project Lead"


class TestTheWorkOrderTdsAsProcurement(BorneByFixture):
	def setUp(self):
		super().setUp()
		self.email = f"test-1451-wo-tds-{frappe.generate_hash(length=6)}@example.com"
		frappe.get_doc({
			"doctype": "User", "email": self.email, "first_name": "WO TDS", "send_welcome_email": 0,
			"roles": [{"role": PROCUREMENT}],
		}).insert(ignore_permissions=True)
		frappe.db.commit()
		self.addCleanup(self._drop_user)

	def _drop_user(self):
		frappe.set_user("Administrator")
		frappe.db.rollback()
		frappe.db.delete("User Permission", {"user": self.email})
		frappe.delete_doc("User", self.email, force=True, ignore_permissions=True)
		for contact in frappe.get_all("Contact", {"email_id": self.email}, pluck="name"):
			frappe.delete_doc("Contact", contact, force=True, ignore_permissions=True)
		frappe.db.commit()

	def _as_procurement(self, wo):
		frappe.set_user(self.email)
		try:
			return get_work_order_tds(wo)
		finally:
			frappe.set_user("Administrator")

	def _label(self, wo):
		"""The details card's part of the answer: who bore the paid tax."""
		answer = self._as_procurement(wo)
		return {key: answer[key] for key in ("withheld", "company", "kind")}

	def test_procurement_cannot_read_the_deductions_themselves(self):
		"""The premise: the page's own list read is refused, which is why it asks the server."""
		frappe.set_user(self.email)
		try:
			self.assertFalse(frappe.has_permission(PTD, "read"))
		finally:
			frappe.set_user("Administrator")

	def test_a_vendor_withheld_misc_work_order_reads_withheld(self):
		"""SR-00105-000908: approved while ordinary, tax cut from the vendor; Misc-only now."""
		wo = self._wo(MISC_AND_ELECTRICAL)
		made = self._approve(wo, 10000)
		self._pay(made.name)
		self._set_categories(wo, MISC)

		self.assertEqual(self._label(wo), {"withheld": 200.0, "company": 0.0, "kind": "withheld"})

	def test_a_kept_whole_work_order_reads_company(self):
		wo = self._wo(MISC)
		made = self._approve(wo, 10000)
		self._pay(made.name)

		self.assertEqual(self._label(wo), {"withheld": 0.0, "company": 200.0, "kind": "company"})

	def test_a_work_order_with_both_kinds_reads_part(self):
		"""SR-00107-001055: 120 withheld, then 282.40 paid on top."""
		wo = self._wo(MISC_AND_ELECTRICAL, total=20120)
		withheld = self._approve(wo, 6000)
		self._set_categories(wo, MISC)
		kept_whole = self._approve(wo, 14120)
		self._pay(withheld.name)
		self._pay(kept_whole.name)

		self.assertEqual(self._label(wo), {"withheld": 120.0, "company": 282.4, "kind": "part"})

	def test_only_paid_payments_count_like_total_tds(self):
		"""A kept-whole payment still Approved is outside `total_tds`, so outside the label too."""
		wo = self._wo(MISC_AND_ELECTRICAL, total=20120)
		withheld = self._approve(wo, 6000)
		self._set_categories(wo, MISC)
		self._approve(wo, 14120)
		self._pay(withheld.name)

		self.assertEqual(self._label(wo), {"withheld": 120.0, "company": 0.0, "kind": "withheld"})

	def test_with_nothing_paid_the_category_rule_says_who_would_bear_it(self):
		self.assertEqual(self._label(self._wo(MISC))["kind"], "company")
		self.assertEqual(self._label(self._wo(MISC_AND_ELECTRICAL))["kind"], "withheld")

	def test_each_payment_carries_its_own_deduction_for_the_table(self):
		"""SR-00107-001055's two payments, the kept-whole one not yet Paid: the table's TDS column shows
		every payment's own tax whatever its status; the label still counts the Paid ones only."""
		wo = self._wo(MISC_AND_ELECTRICAL, total=20120)
		withheld = self._approve(wo, 6000)
		self._set_categories(wo, MISC)
		kept_whole = self._approve(wo, 14120)
		self._pay(withheld.name)

		answer = self._as_procurement(wo)

		self.assertEqual(answer["payments"], {
			withheld.name: {"tds_amount": 120.0, "borne_by": "Vendor"},
			kept_whole.name: {"tds_amount": 282.4, "borne_by": "Company"},
		})
		self.assertEqual(answer["kind"], "withheld")

	def test_a_work_order_with_no_deductions_has_no_payment_rows(self):
		self.assertEqual(self._as_procurement(self._wo(MISC))["payments"], {})

	def test_procurement_limited_to_another_project_is_refused(self):
		"""Read is checked on the Work Order itself, so a User Permission naming another project holds."""
		wo = self._wo(MISC)
		add_user_permission("Projects", self.fx.project(), self.email, ignore_permissions=True)
		frappe.db.commit()
		frappe.set_user(self.email)
		try:
			self.assertTrue(frappe.has_permission(SR, "read"))
			with self.assertRaises(frappe.PermissionError):
				get_work_order_tds(wo)
		finally:
			frappe.set_user("Administrator")

	def test_a_user_who_cannot_read_the_work_order_is_refused(self):
		wo = self._wo(MISC)
		frappe.set_user("Guest")
		try:
			with self.assertRaises(frappe.PermissionError):
				get_work_order_tds(wo)
		finally:
			frappe.set_user("Administrator")


class TestTheVoucherReportTdsAsProjectLead(BorneByFixture):
	"""Reports > WO > Payment Voucher Uploads, as a Project Lead (#1543, owner ruling Q31-A): its TDS column
	read `Payment TDS Deduction` itself, which only the accountants may read, so it was blank for anyone
	else. It now asks `get_paid_work_order_payment_tds`, which answers for every Paid Work Order payment
	whose Work Order the caller may read (User Permissions included)."""

	def setUp(self):
		super().setUp()
		self.email = f"test-1543-voucher-{frappe.generate_hash(length=6)}@example.com"
		frappe.get_doc({
			"doctype": "User", "email": self.email, "first_name": "Voucher TDS", "send_welcome_email": 0,
			"roles": [{"role": PROJECT_LEAD}],
		}).insert(ignore_permissions=True)
		frappe.db.commit()
		self.addCleanup(self._drop_user)

	_drop_user = TestTheWorkOrderTdsAsProcurement._drop_user

	def _as_project_lead(self):
		frappe.set_user(self.email)
		try:
			return get_paid_work_order_payment_tds()
		finally:
			frappe.set_user("Administrator")

	def _limit_to(self, project):
		add_user_permission("Projects", project, self.email, ignore_permissions=True)
		frappe.db.commit()

	def test_the_project_lead_cannot_read_the_deductions_themselves(self):
		"""The premise: the report's own read of the doctype is refused."""
		frappe.set_user(self.email)
		try:
			self.assertFalse(frappe.has_permission(PTD, "read"))
		finally:
			frappe.set_user("Administrator")

	def test_each_paid_payment_on_a_readable_work_order_carries_its_tax_and_who_bore_it(self):
		wo = self._wo(MISC_AND_ELECTRICAL, total=20120)
		withheld = self._approve(wo, 6000)
		self._set_categories(wo, MISC)
		kept_whole = self._approve(wo, 14120)
		self._pay(withheld.name)
		self._pay(kept_whole.name)
		self._limit_to(self.project)

		answer = self._as_project_lead()

		self.assertEqual(answer.get(withheld.name), {"tds_amount": 120.0, "borne_by": "Vendor"})
		self.assertEqual(answer.get(kept_whole.name), {"tds_amount": 282.4, "borne_by": "Company"})

	def test_a_payment_not_yet_paid_is_not_on_the_report_and_not_in_the_answer(self):
		wo = self._wo(MISC_AND_ELECTRICAL)
		approved = self._approve(wo, 10000)
		self._limit_to(self.project)

		self.assertNotIn(approved.name, self._as_project_lead())

	def test_a_work_order_on_another_project_is_left_out(self):
		"""Read is checked on the Work Order: a Project Lead limited to another project learns nothing of its tax."""
		wo = self._wo(MISC_AND_ELECTRICAL)
		made = self._approve(wo, 10000)
		self._pay(made.name)
		self._limit_to(self.fx.project())

		self.assertNotIn(made.name, self._as_project_lead())

	def test_a_user_who_cannot_read_work_orders_is_refused(self):
		frappe.set_user("Guest")
		try:
			with self.assertRaises(frappe.PermissionError):
				get_paid_work_order_payment_tds()
		finally:
			frappe.set_user("Administrator")
