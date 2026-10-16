# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The Work Order page's TDS label, as a Procurement user sees it (#1451, walk story 27).

`Payment TDS Deduction` is readable only by the accountants, so the page cannot read who bore a Work
Order's tax off the deductions itself: a Procurement user got a 403 and the page fell back to the
category rule, labelling a vendor-withheld Misc-only Work Order "TDS (paid by company)". The page now
asks `get_work_order_tds`, which checks read on the Work Order and reads the deductions on its Paid
payments only, the same population `total_tds` (the figure beside the label) counts.

⚠️ RUNS AGAINST THE SITE DATABASE. Everything is `TEST-TWO-*`, purged by `TaxedWorkOrderFixture`; the
user is created and deleted here.
"""

import frappe

from nirmaan_stack.api.payments.work_order_tds import get_work_order_tds
from nirmaan_stack.services.test_tds_borne_by import MISC, MISC_AND_ELECTRICAL, BorneByFixture

PTD = "Payment TDS Deduction"
PROCUREMENT = "Nirmaan Procurement Executive"


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

		self.assertEqual(self._as_procurement(wo), {"withheld": 200.0, "company": 0.0, "kind": "withheld"})

	def test_a_kept_whole_work_order_reads_company(self):
		wo = self._wo(MISC)
		made = self._approve(wo, 10000)
		self._pay(made.name)

		self.assertEqual(self._as_procurement(wo), {"withheld": 0.0, "company": 200.0, "kind": "company"})

	def test_a_work_order_with_both_kinds_reads_part(self):
		"""SR-00107-001055: 120 withheld, then 282.40 paid on top."""
		wo = self._wo(MISC_AND_ELECTRICAL, total=20120)
		withheld = self._approve(wo, 6000)
		self._set_categories(wo, MISC)
		kept_whole = self._approve(wo, 14120)
		self._pay(withheld.name)
		self._pay(kept_whole.name)

		self.assertEqual(self._as_procurement(wo), {"withheld": 120.0, "company": 282.4, "kind": "part"})

	def test_only_paid_payments_count_like_total_tds(self):
		"""A kept-whole payment still Approved is outside `total_tds`, so outside the label too."""
		wo = self._wo(MISC_AND_ELECTRICAL, total=20120)
		withheld = self._approve(wo, 6000)
		self._set_categories(wo, MISC)
		self._approve(wo, 14120)
		self._pay(withheld.name)

		self.assertEqual(self._as_procurement(wo), {"withheld": 120.0, "company": 0.0, "kind": "withheld"})

	def test_with_nothing_paid_the_category_rule_says_who_would_bear_it(self):
		self.assertEqual(self._as_procurement(self._wo(MISC))["kind"], "company")
		self.assertEqual(self._as_procurement(self._wo(MISC_AND_ELECTRICAL))["kind"], "withheld")

	def test_a_user_who_cannot_read_the_work_order_is_refused(self):
		wo = self._wo(MISC)
		frappe.set_user("Guest")
		try:
			with self.assertRaises(frappe.PermissionError):
				get_work_order_tds(wo)
		finally:
			frappe.set_user("Administrator")
