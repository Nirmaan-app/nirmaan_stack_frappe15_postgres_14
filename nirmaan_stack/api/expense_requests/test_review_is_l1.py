# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""An Admin's review of an Expense Request is the L1 step (#1499; ADR-0016, 2026-10-19 amendment, 3).

Every case goes through the review call (seam 2) and reads what the user would see: the Expense
it created and that Expense's status. Every fixture is namespaced `exr_l1_` and torn down.

Run:
  DEVENV test --module nirmaan_stack.api.expense_requests.test_review_is_l1
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.expense_requests.create import create_expense_request
from nirmaan_stack.api.expense_requests.read import get_my_expense_requests
from nirmaan_stack.api.expense_requests.review import (
	approve_expense_request,
	reject_expense_request,
)
from nirmaan_stack.api.expense_requests.test_expense_requests import _make_user
from nirmaan_stack.api.expense_requests.test_records_without_review import _listed, _write_list
from nirmaan_stack.services import expense_request_routing as routing

PM_USER = "exr_l1_pm@example.com"
ADMIN_USER = "exr_l1_admin@example.com"
HRL_USER = "exr_l1_hrl@example.com"
ACC_USER = "exr_l1_acc@example.com"
USERS = (PM_USER, ADMIN_USER, HRL_USER, ACC_USER)

PM_PROFILE = "Nirmaan Project Manager Profile"
HRL_PROFILE = "Nirmaan HR Lead Profile"
NON_PROJECT_TYPE = "Travel Expenses (Bus)"     # project=0, non_project=1


class TestAnAdminsReviewIsTheFirstApproval(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		_make_user(PM_USER, PM_PROFILE, ("Nirmaan Project Manager",))
		_make_user(ADMIN_USER, "Nirmaan Admin Profile", ("System Manager",))
		_make_user(HRL_USER, HRL_PROFILE, ("Nirmaan HR Executive", "Nirmaan HR Lead"))
		_make_user(ACC_USER, "Nirmaan Accountant Profile", ("Nirmaan Accountant",))

		# Who may raise a type is master data; grant the profiles for the run and remove exactly
		# the rows added.
		cls.granted_roles = []
		for profile in (PM_PROFILE, HRL_PROFILE):
			if frappe.db.exists("Expense Type Role", {"parent": NON_PROJECT_TYPE,
			                                          "parenttype": "Expense Type",
			                                          "role_profile": profile}):
				continue
			row = frappe.get_doc({
				"doctype": "Expense Type Role", "name": frappe.generate_hash(length=10),
				"parent": NON_PROJECT_TYPE, "parenttype": "Expense Type",
				"parentfield": "allowed_roles", "role_profile": profile, "idx": 99,
			})
			row.db_insert()
			cls.granted_roles.append(row.name)
		frappe.db.commit()

	@classmethod
	def tearDownClass(cls):
		frappe.set_user("Administrator")
		for n in cls.granted_roles:
			frappe.db.delete("Expense Type Role", {"name": n})
		for r in frappe.get_all("Expense Request", filters={"owner": ["in", list(USERS)]}):
			for dt in ("Project Expenses", "Non Project Expenses"):
				for e in frappe.get_all(dt, filters={"request_id": r.name}):
					frappe.delete_doc(dt, e.name, force=True, ignore_permissions=True)
			if frappe.db.exists("Expense Request", r.name):
				frappe.db.delete("Nirmaan Notifications",
				                 {"document": "Expense Request", "docname": r.name})
				frappe.delete_doc("Expense Request", r.name, force=True, ignore_permissions=True)
		for email in USERS:
			for dt in ("Nirmaan Users", "User"):
				if frappe.db.exists(dt, email):
					frappe.delete_doc(dt, email, force=True, ignore_permissions=True)
		frappe.db.commit()
		super().tearDownClass()

	def setUp(self):
		frappe.set_user("Administrator")
		routing.clear_cache()

	def tearDown(self):
		routing.clear_cache()
		frappe.set_user("Administrator")

	# --- helpers -------------------------------------------------------------

	def _as(self, user, fn, *args, **kw):
		frappe.set_user(user)
		try:
			return fn(*args, **kw)
		finally:
			frappe.set_user("Administrator")

	def _raise(self, amount, user=PM_USER):
		return self._as(user, create_expense_request, expense_type=NON_PROJECT_TYPE, amount=amount,
		                source_data={"responses": {"detail": {"description": "bus to site"}}})["name"]

	def _reviewed_by(self, reviewer, amount):
		"""Raise a PM's request, approve it as `reviewer`, and return the Expense it created."""
		out = self._as(reviewer, approve_expense_request, self._raise(amount))
		return frappe.db.get_value(
			out["created_expense_doctype"], out["created_expense"],
			["status", "approval_date", "ceo_approval_date", "auto_approved"], as_dict=True)

	# --- the L1 step ---------------------------------------------------------

	def test_an_admins_review_of_22000_gives_an_approved_expense(self):
		for admin in (ADMIN_USER, "Administrator"):
			with self.subTest(reviewer=admin):
				expense = self._reviewed_by(admin, 22000)
				self.assertEqual(expense.status, "Approved")
				self.assertTrue(expense.approval_date)       # the review is the L1 step, dated
				self.assertFalse(expense.auto_approved)      # a person approved it, not the band

	def test_an_hr_or_accounts_review_of_22000_still_waits_for_an_admin(self):
		for reviewer in (HRL_USER, ACC_USER):
			with self.subTest(reviewer=reviewer):
				expense = self._reviewed_by(reviewer, 22000)
				self.assertEqual(expense.status, "Requested")
				self.assertFalse(expense.approval_date)

	def test_an_admins_review_of_60000_gives_ceo_pending_with_l1_done(self):
		expense = self._reviewed_by(ADMIN_USER, 60000)
		self.assertEqual(expense.status, "CEO Pending")
		self.assertTrue(expense.approval_date)
		self.assertFalse(expense.ceo_approval_date)

	def test_an_hr_review_of_60000_starts_at_the_admin(self):
		expense = self._reviewed_by(HRL_USER, 60000)
		self.assertEqual(expense.status, "Requested")
		self.assertFalse(expense.approval_date)

	def test_under_15000_any_review_gives_an_auto_approved_expense(self):
		for reviewer in (ADMIN_USER, HRL_USER):
			with self.subTest(reviewer=reviewer):
				expense = self._reviewed_by(reviewer, 10000)
				self.assertEqual(expense.status, "Approved")
				self.assertTrue(expense.auto_approved)

	def _landing_for(self, reviewer, name):
		rows = self._as(reviewer, get_my_expense_requests)["requests"]
		return next(r for r in rows if r["name"] == name)["target_status"]

	def test_the_dialog_is_told_what_this_reviewer_would_land_it_at(self):
		"""The reviewer dialog's "lands at" is per caller: an Admin and HR are told different outcomes."""
		name = self._raise(22000)
		self.assertEqual(self._landing_for(ADMIN_USER, name), "Approved")
		self.assertEqual(self._landing_for(HRL_USER, name), "Requested")
		self.assertEqual(self._landing_for(ADMIN_USER, self._raise(60000)), "CEO Pending")

	# --- unchanged guards ----------------------------------------------------

	def test_nobody_reviews_their_own_request(self):
		# An HR Lead on Records without review (#1498) has nothing left to review: their request is
		# approved on submit. Taken off the list here, so the request waits and the guard is reached.
		listed = _listed()
		_write_list([p for p in listed if p != "Nirmaan HR Lead Profile"])
		self.addCleanup(_write_list, listed)
		name = self._raise(22000, user=HRL_USER)
		with self.assertRaises(frappe.PermissionError):
			self._as(HRL_USER, approve_expense_request, name)
		with self.assertRaises(frappe.PermissionError):
			self._as(HRL_USER, reject_expense_request, name, comment="mine")
		self.assertEqual(frappe.db.get_value("Expense Request", name, "status"), "Pending Approval")
		self.assertFalse(frappe.db.exists("Non Project Expenses", {"request_id": name}))

	def test_an_admin_does_not_review_their_own_request_either(self):
		"""Story 35: nobody reviews their own request, an Admin included. An Admin's new request is
		approved on submit, so this is one that waits from before (raised, then its raiser made Admin)."""
		name = self._raise(22000)
		# `set_value` skips the request's hooks, which is safe here: `owner` is no field a hook derives
		# anything from, and the request is still Pending Approval with no Expense to mirror.
		frappe.db.set_value("Expense Request", name, "owner", ADMIN_USER, update_modified=False)
		row = next(r for r in self._as(ADMIN_USER, get_my_expense_requests)["requests"] if r["name"] == name)
		self.assertFalse(row["can_review"])
		with self.assertRaises(frappe.PermissionError):
			self._as(ADMIN_USER, approve_expense_request, name)
		with self.assertRaises(frappe.PermissionError):
			self._as(ADMIN_USER, reject_expense_request, name, comment="mine")
		self.assertEqual(frappe.db.get_value("Expense Request", name, "status"), "Pending Approval")
		self.assertFalse(frappe.db.exists("Non Project Expenses", {"request_id": name}))
		# Another Admin still reviews it.
		other = next(r for r in self._as("Administrator", get_my_expense_requests)["requests"]
		             if r["name"] == name)
		self.assertTrue(other["can_review"])
		self.assertEqual(self._as("Administrator", approve_expense_request, name)["status"], "Approved")

	def test_a_reject_without_a_reason_is_refused(self):
		name = self._raise(22000)
		for reviewer in (ADMIN_USER, HRL_USER):
			with self.subTest(reviewer=reviewer), self.assertRaises(frappe.ValidationError):
				self._as(reviewer, reject_expense_request, name, comment="  ")
		self.assertEqual(frappe.db.get_value("Expense Request", name, "status"), "Pending Approval")

	def test_a_failed_approval_leaves_no_reviewer_behind(self):
		"""The request is saved before its Expense is inserted, so a failed insert must undo both."""
		name = self._raise(22000)
		with patch("nirmaan_stack.api.expense_requests.convert.create_ledger_row",
		           side_effect=frappe.ValidationError("insert failed")):
			with self.assertRaises(frappe.ValidationError):
				self._as(ADMIN_USER, approve_expense_request, name)
		req = frappe.db.get_value("Expense Request", name, ["status", "reviewed_by"], as_dict=True)
		self.assertEqual(req.status, "Pending Approval")
		self.assertFalse(req.reviewed_by)
		self.assertFalse(frappe.db.exists("Non Project Expenses", {"request_id": name}))
