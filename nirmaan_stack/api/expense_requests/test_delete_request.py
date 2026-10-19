# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Deleting a rejected Expense Request (#1505): who may, and when the list offers the trash button.

Every fixture is namespaced `exr_del_` and torn down.

Run:
  DEVENV test --module nirmaan_stack.api.expense_requests.test_delete_request
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.expense_requests.create import create_expense_request
from nirmaan_stack.api.expense_requests.delete import delete_expense_request
from nirmaan_stack.api.expense_requests.read import get_my_expense_requests
from nirmaan_stack.api.expense_requests.review import (
	approve_expense_request,
	reject_expense_request,
)
from nirmaan_stack.api.expense_requests.test_expense_requests import _make_user
from nirmaan_stack.services import expense_request_routing as routing

PM_USER = "exr_del_pm@example.com"
PM2_USER = "exr_del_pm2@example.com"
HR_USER = "exr_del_hr@example.com"
USERS = (PM_USER, PM2_USER, HR_USER)

PM_PROFILE = "Nirmaan Project Manager Profile"
NON_PROJECT_TYPE = "Travel Expenses (Bus)"     # project=0, non_project=1


class TestDeleteExpenseRequest(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		_make_user(PM_USER, PM_PROFILE, ("Nirmaan Project Manager",))
		_make_user(PM2_USER, PM_PROFILE, ("Nirmaan Project Manager",))
		_make_user(HR_USER, "Nirmaan HR Executive Profile", ("Nirmaan HR Executive",))

		# Who may raise a type is master data; grant the PM profile for the run and remove
		# exactly the row added.
		cls.granted_role = None
		if not frappe.db.exists("Expense Type Role", {"parent": NON_PROJECT_TYPE,
		                                              "parenttype": "Expense Type",
		                                              "role_profile": PM_PROFILE}):
			row = frappe.get_doc({
				"doctype": "Expense Type Role", "name": frappe.generate_hash(length=10),
				"parent": NON_PROJECT_TYPE, "parenttype": "Expense Type",
				"parentfield": "allowed_roles", "role_profile": PM_PROFILE, "idx": 99,
			})
			row.db_insert()
			cls.granted_role = row.name
		frappe.db.commit()

	@classmethod
	def tearDownClass(cls):
		frappe.set_user("Administrator")
		if cls.granted_role:
			frappe.db.delete("Expense Type Role", {"name": cls.granted_role})
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

	def _raise(self, user=PM_USER):
		return self._as(user, create_expense_request, expense_type=NON_PROJECT_TYPE, amount=4300,
		                source_data={"responses": {"detail": {"description": "exr_del bus"}}})["name"]

	def _rejected(self, user=PM_USER):
		name = self._raise(user)
		reject_expense_request(name, "not needed")
		return name

	def _row(self, user, name):
		rows = self._as(user, get_my_expense_requests)["requests"]
		return next(r for r in rows if r["name"] == name)

	def _notes(self, name):
		return frappe.get_all("Nirmaan Notifications",
		                      filters={"document": "Expense Request", "docname": name})

	def _rejected_with_an_expense(self):
		"""A rejected request whose Expense still exists.

		Today rejection happens before any Expense exists; once the request mirrors an L1 or
		CEO rejection of its Expense, it reads Rejected with the Expense still linked. Set
		the status directly to stand in for that mirror.
		"""
		name = self._raise()
		approve_expense_request(name)
		frappe.db.set_value("Expense Request", name, "status", "Rejected")
		return name

	# --- the delete call -----------------------------------------------------

	def test_the_raiser_deletes_their_rejected_request_and_its_notifications(self):
		name = self._rejected()
		self.assertTrue(self._notes(name))   # the rejection told the raiser

		self._as(PM_USER, delete_expense_request, name)

		self.assertFalse(frappe.db.exists("Expense Request", name))
		self.assertEqual(self._notes(name), [])

	def test_an_admin_deletes_someone_elses_rejected_request(self):
		name = self._rejected()
		delete_expense_request(name)
		self.assertFalse(frappe.db.exists("Expense Request", name))

	def test_anyone_else_is_refused(self):
		name = self._rejected()
		for user in (PM2_USER, HR_USER):
			with self.subTest(user=user):
				with self.assertRaises(frappe.PermissionError):
					self._as(user, delete_expense_request, name)
		self.assertTrue(frappe.db.exists("Expense Request", name))

	def test_a_request_that_is_not_rejected_is_refused(self):
		pending = self._raise()
		approved = self._raise()
		approve_expense_request(approved)
		for name in (pending, approved):
			with self.subTest(name=name):
				with self.assertRaises(frappe.ValidationError):
					self._as(PM_USER, delete_expense_request, name)
				with self.assertRaises(frappe.ValidationError):
					delete_expense_request(name)
				self.assertTrue(frappe.db.exists("Expense Request", name))

	def test_a_rejected_request_with_an_expense_is_refused(self):
		name = self._rejected_with_an_expense()
		for user in (PM_USER, "Administrator"):
			with self.subTest(user=user):
				with self.assertRaises(frappe.ValidationError):
					self._as(user, delete_expense_request, name)
		self.assertTrue(frappe.db.exists("Expense Request", name))
		self.assertTrue(frappe.db.exists("Non Project Expenses", {"request_id": name}))

	# --- the list's can_delete -----------------------------------------------

	def test_the_list_offers_delete_exactly_where_the_call_allows_it(self):
		rejected = self._rejected()
		pending = self._raise()
		linked = self._rejected_with_an_expense()

		self.assertTrue(self._row(PM_USER, rejected)["can_delete"])
		self.assertTrue(self._row("Administrator", rejected)["can_delete"])
		self.assertFalse(self._row(PM2_USER, rejected)["can_delete"])
		self.assertFalse(self._row(HR_USER, rejected)["can_delete"])
		self.assertFalse(self._row(PM_USER, pending)["can_delete"])
		self.assertFalse(self._row(PM_USER, linked)["can_delete"])
		self.assertFalse(self._row("Administrator", linked)["can_delete"])
