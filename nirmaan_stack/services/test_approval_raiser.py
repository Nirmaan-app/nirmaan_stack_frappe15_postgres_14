# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""A step the raiser already holds is not asked again (owner, 2026-09-21) -- end to end.

Runs against the LIVE site: raw fixtures inside ONE transaction whose commits are stubbed, rolled
back in `tearDown`. FCM pushes and realtime events are stubbed too, so no real user is notified.
The fixture users are real accounts read from the site; a test is skipped if one is missing.
"""

import unittest

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from nirmaan_stack.api.expense_requests.convert import target_status
from nirmaan_stack.api.payments.project_payments import create_payment_request_for_service
from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER
from nirmaan_stack.integrations.controllers import project_payments as ppc
from nirmaan_stack.services.approval_raiser import raiser_level
from nirmaan_stack.services.approval_tiers import RAISER_CEO, RAISER_L1

ADMIN_PROFILE = "Nirmaan Admin Profile"


def _raw(doctype, **fields):
	doc = frappe.new_doc(doctype)
	doc.update(fields)
	doc.name = frappe.generate_hash(length=12)
	doc.db_insert()
	return doc.name


def _user_with_profile(profile, exclude=()):
	for row in frappe.get_all("Nirmaan Users", filters={"role_profile": profile}, pluck="name"):
		if row not in exclude and frappe.db.exists("User", {"name": row, "enabled": 1}):
			return row
	return None


class _Stubbed(FrappeTestCase):
	def setUp(self):
		self._real = {
			"commit": frappe.db.commit,
			"publish_realtime": frappe.publish_realtime,
			"PrNotification": ppc.PrNotification,
		}
		frappe.db.commit = lambda *a, **k: None
		frappe.publish_realtime = lambda *a, **k: None
		ppc.PrNotification = lambda *a, **k: None
		frappe.set_user("Administrator")

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.commit = self._real["commit"]
		frappe.publish_realtime = self._real["publish_realtime"]
		ppc.PrNotification = self._real["PrNotification"]
		frappe.db.rollback()


class TestRaiserLevelLookup(_Stubbed):
	def test_levels(self):
		self.assertEqual(raiser_level(CEO_AUTHORIZED_USER), RAISER_CEO)
		self.assertEqual(raiser_level("Administrator"), RAISER_L1)
		admin = _user_with_profile(ADMIN_PROFILE, exclude=(CEO_AUTHORIZED_USER,))
		if admin:
			self.assertEqual(raiser_level(admin), RAISER_L1)
		self.assertIsNone(raiser_level(f"nobody-{frappe.generate_hash(length=6)}@example.com"))
		self.assertIsNone(raiser_level(None))
		accountant = _user_with_profile("Nirmaan Accountant Profile")
		if accountant:
			self.assertIsNone(raiser_level(accountant), "an Accountant is not L1 here")


class TestPaymentsAreBornPastTheRaisersStep(_Stubbed):
	def setUp(self):
		super().setUp()
		self.project = _raw("Projects", project_name=f"TEST_RAISER_{frappe.generate_hash(length=6)}",
		                    tendering_status="Won")
		self.sr = _raw("Service Requests", project=self.project, total_amount=500000, gst="false")

	def _raise(self, user, amount):
		frappe.set_user(user)
		try:
			out = frappe.parse_json(create_payment_request_for_service(frappe.as_json({
				"doctype": "Service Requests", "docname": self.sr, "amount": amount,
			})))
		finally:
			frappe.set_user("Administrator")
		return frappe.db.get_value(
			"Project Payments", out["name"],
			["status", "auto_approved", "approval_date", "ceo_approval_date"], as_dict=True,
		)

	def test_the_ceo_clears_both_steps(self):
		if not frappe.db.exists("User", CEO_AUTHORIZED_USER):
			raise unittest.SkipTest("CEO user missing on this site")
		p = self._raise(CEO_AUTHORIZED_USER, 80000)
		self.assertEqual(p.status, "Approved")
		self.assertEqual(p.auto_approved, 0)
		self.assertTrue(p.approval_date and p.ceo_approval_date)

	def test_an_l1_approver_clears_l1_only(self):
		admin = _user_with_profile(ADMIN_PROFILE, exclude=(CEO_AUTHORIZED_USER,))
		if not admin:
			raise unittest.SkipTest("no non-CEO Admin on this site")
		big = self._raise(admin, 80000)
		self.assertEqual(big.status, "CEO Pending")
		self.assertTrue(big.approval_date)
		self.assertFalse(big.ceo_approval_date)
		mid = self._raise(admin, 30000)
		self.assertEqual(mid.status, "Approved")
		self.assertEqual(mid.auto_approved, 0)

	def test_anyone_else_takes_the_normal_path(self):
		# The routing both creation endpoints share, read as a Procurement user. (Creating the
		# payment itself as that user is refused on the fixture project by user permissions,
		# which is not what this test is about.)
		from nirmaan_stack.api.payments.project_payments import _route_new_payment

		other = _user_with_profile("Nirmaan Procurement Executive Profile")
		if not other:
			raise unittest.SkipTest("no Procurement user on this site")
		frappe.set_user(other)
		try:
			self.assertEqual(_route_new_payment(30000), ("Requested", False, False))
			self.assertEqual(_route_new_payment(80000), ("Requested", False, False))
		finally:
			frappe.set_user("Administrator")

	def test_the_auto_band_is_unchanged(self):
		p = self._raise("Administrator", 5000)
		self.assertEqual(p.status, "Approved")
		self.assertEqual(p.auto_approved, 1)


class TestExpensesFollowTheRequestsRaiser(_Stubbed):
	"""The ledger row is inserted by the REVIEWER; the raiser is the Expense Request's owner."""

	def _request_raised_by(self, user, amount):
		frappe.set_user(user)
		try:
			name = _raw("Expense Request", amount=amount, status="Approved")
		finally:
			frappe.set_user("Administrator")
		return name

	def _born(self, doctype, request, amount):
		# Inserted as a DIFFERENT user (the reviewer), exactly as convert.create_ledger_row does.
		reviewer = _user_with_profile("Nirmaan Procurement Executive Profile") or "Administrator"
		frappe.set_user(reviewer)
		try:
			doc = frappe.get_doc({"doctype": doctype, "amount": amount, "request_id": request,
			                      "description": "raiser fixture"}).insert(ignore_permissions=True)
		finally:
			frappe.set_user("Administrator")
		return frappe.db.get_value(doctype, doc.name,
		                           ["status", "auto_approved", "approval_date", "ceo_approval_date"], as_dict=True)

	def test_the_ceos_request_is_born_approved_on_both_ledgers(self):
		if not frappe.db.exists("User", CEO_AUTHORIZED_USER):
			raise unittest.SkipTest("CEO user missing on this site")
		for doctype in ("Project Expenses", "Non Project Expenses"):
			with self.subTest(doctype=doctype):
				row = self._born(doctype, self._request_raised_by(CEO_AUTHORIZED_USER, 80000), 80000)
				self.assertEqual(row.status, "Approved")
				self.assertEqual(row.auto_approved, 0)
				self.assertTrue(row.approval_date and row.ceo_approval_date)

	def test_an_l1_approvers_request_skips_l1(self):
		admin = _user_with_profile(ADMIN_PROFILE, exclude=(CEO_AUTHORIZED_USER,))
		if not admin:
			raise unittest.SkipTest("no non-CEO Admin on this site")
		row = self._born("Project Expenses", self._request_raised_by(admin, 80000), 80000)
		self.assertEqual(row.status, "CEO Pending")
		self.assertTrue(row.approval_date)
		self.assertFalse(row.ceo_approval_date)

	def test_anyone_elses_request_takes_the_normal_path(self):
		other = _user_with_profile("Nirmaan Procurement Executive Profile")
		if not other:
			raise unittest.SkipTest("no Procurement user on this site")
		row = self._born("Non Project Expenses", self._request_raised_by(other, 30000), 30000)
		self.assertEqual(row.status, "Requested")
		self.assertFalse(row.approval_date)

	def test_the_review_preview_says_the_same(self):
		if not frappe.db.exists("User", CEO_AUTHORIZED_USER):
			raise unittest.SkipTest("CEO user missing on this site")
		req = frappe.get_doc("Expense Request", self._request_raised_by(CEO_AUTHORIZED_USER, 80000))
		self.assertEqual(target_status(req), "Approved")
		self.assertEqual(flt(req.amount), 80000)
