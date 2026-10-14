# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""The request's payee picker (spec #1420 ticket #1429, ADR-0033): search, add, the vendor's Payee,
and changing an Expense's Payee until it is Paid.

Anyone who can raise an Expense Request may search Payees and add one from the request; nobody else.

Run:
  devenv.sh test --module nirmaan_stack.api.expense_requests.test_request_payees
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.expense_requests.payees import (
	add_request_payee,
	check_request_payee,
	get_vendor_payee,
	search_payees,
)
from nirmaan_stack.api.expense_requests.test_expense_requests import _make_user
from nirmaan_stack.api.payees.payee_fixture import TEST_IFSC, PayeeFixture
from nirmaan_stack.services import expense_request_routing as routing
from nirmaan_stack.services.payees.expense_payee import change_expense_payee

PM_USER = "exr_test_pyepm@example.com"
NOBODY = "exr_test_pyenobody@example.com"
PM_PROFILE = "Nirmaan Project Manager Profile"
NPE = "Non Project Expenses"


class TestRequestPayees(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		_make_user(PM_USER, PM_PROFILE, ("Nirmaan Project Manager",))
		# A signed-in user with no role profile: they can see no expense type, so raise nothing.
		_make_user(NOBODY, None, ("Nirmaan Project Manager",))
		# The PM must be able to raise SOME type: one of their own, removed after.
		cls.expense_type = f"exr_test_pye_{frappe.generate_hash(length=6)}"
		d = frappe.new_doc("Expense Type")
		d.update({"expense_name": cls.expense_type, "non_project": 1,
		          "expense_category": "Uncategorized", "payee_rule": "Required"})
		d.set("allowed_roles", [{"role_profile": PM_PROFILE}])
		d.insert(ignore_permissions=True)
		frappe.db.commit()

	@classmethod
	def tearDownClass(cls):
		frappe.set_user("Administrator")
		frappe.delete_doc("Expense Type", cls.expense_type, force=True, ignore_permissions=True)
		for email in (PM_USER, NOBODY):
			for dt in ("Nirmaan Users", "User"):
				if frappe.db.exists(dt, email):
					frappe.delete_doc(dt, email, force=True, ignore_permissions=True)
		frappe.db.commit()
		super().tearDownClass()

	def setUp(self):
		frappe.set_user("Administrator")
		routing.clear_cache()
		self.payees = PayeeFixture.attach(self)

	def tearDown(self):
		routing.clear_cache()
		frappe.set_user("Administrator")

	# --- helpers -------------------------------------------------------------

	def _as(self, user, fn, **kw):
		frappe.set_user(user)
		try:
			return fn(**kw)
		finally:
			frappe.set_user("Administrator")

	def _expense(self, payee=None, status="Approved", vendor=None, doctype=NPE) -> str:
		"""An expense row inserted raw (no hooks), deleted after the test."""
		name = f"exr-test-pye-{frappe.generate_hash(length=8)}"
		extra = ", vendor" if vendor else ""
		frappe.db.sql(
			f"""INSERT INTO "tab{doctype}" (name, creation, modified, modified_by, owner, docstatus, idx,
			                                type, amount, status, payee{extra})
			   VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, 100, %s, %s
			           {", %s" if vendor else ""})""",
			(name, self.expense_type, status, payee, *((vendor,) if vendor else ())),
		)
		frappe.db.commit()

		def _drop():
			frappe.db.delete(doctype, {"name": name})
			frappe.db.commit()
		self.addCleanup(_drop)
		return name

	def _vendor(self, payee=None) -> str:
		name = f"TESTPYE-VEN-{frappe.generate_hash(length=8)}"
		frappe.db.sql(
			"""INSERT INTO "tabVendors" (name, creation, modified, modified_by, owner, docstatus, idx,
			                             vendor_name, payee)
			   VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, %s)""",
			(name, f"TESTPYE Vendor {name}", payee),
		)
		frappe.db.commit()

		def _drop():
			frappe.db.delete("Vendors", {"name": name})
			frappe.db.commit()
		self.addCleanup(_drop)
		return name

	def _search(self, text):
		return {r["name"]: r for r in self._as(PM_USER, search_payees, text=text)}

	# --- search --------------------------------------------------------------

	def test_a_raiser_finds_a_payee_by_holder_name_with_how_often_it_was_paid(self):
		holder = self.payees.holder("Ramesh Yadav")
		payee = self.payees.payee(holder=holder)
		self._expense(payee, status="Paid")
		self._expense(payee, status="Paid")
		self._expense(payee, status="Approved")  # not paid yet: not counted

		found = self._search(holder.split(" ", 1)[1].lower())
		self.assertIn(payee, found)
		row = found[payee]
		self.assertEqual(row["account_name"], holder)
		self.assertEqual(row["ifsc"], TEST_IFSC)
		self.assertEqual(row["bank_name"], "Test Bank")
		self.assertEqual(row["times_paid"], 2)

	def test_a_raiser_finds_a_payee_by_account_number_ignoring_spaces_and_leading_zeros(self):
		number = self.payees.account_number()
		payee = self.payees.payee(account_number=number)
		self.assertIn(payee, self._search(f"00{number[:5]} {number[5:]}"))

	def test_an_inactive_payee_is_not_offered(self):
		holder = self.payees.holder("Gone")
		payee = self.payees.payee(holder=holder)
		frappe.db.set_value("Payee", payee, "status", "Inactive")
		frappe.db.commit()
		self.assertNotIn(payee, self._search(holder))

	def test_someone_who_can_raise_no_request_cannot_search_or_add(self):
		with self.assertRaises(frappe.PermissionError):
			self._as(NOBODY, search_payees, text="TESTPYE")
		with self.assertRaises(frappe.PermissionError):
			self._as(NOBODY, add_request_payee, account_name=self.payees.holder(),
			         account_number=self.payees.account_number(), ifsc=TEST_IFSC)
		with self.assertRaises(frappe.PermissionError):
			self._as(NOBODY, check_request_payee, account_number="1234", ifsc=TEST_IFSC)

	# --- add -----------------------------------------------------------------

	def test_a_raiser_adds_a_payee_from_the_request(self):
		holder = self.payees.holder("New")
		out = self._as(PM_USER, add_request_payee, account_name=holder,
		               account_number=self.payees.account_number(), ifsc=TEST_IFSC)
		created = out["payee"]
		self.assertEqual(frappe.db.get_value("Payee", created["name"], "account_name"), holder)
		self.assertEqual(created["status"], "Active")

	def test_adding_an_account_already_on_record_points_at_that_payee(self):
		number = self.payees.account_number()
		existing = self.payees.payee(account_number=number)
		before = frappe.db.count("Payee")
		out = self._as(PM_USER, add_request_payee, account_name=self.payees.holder(),
		               account_number=f"0{number}", ifsc=TEST_IFSC)
		self.assertEqual(out["duplicate"]["name"], existing)
		self.assertIn(existing, out["message"])
		self.assertEqual(frappe.db.count("Payee"), before)

		checked = self._as(PM_USER, check_request_payee, account_number=number, ifsc=TEST_IFSC)
		self.assertEqual(checked["duplicate"]["name"], existing)

	# --- the vendor's Payee --------------------------------------------------

	def test_a_raiser_reads_the_vendors_payee(self):
		payee = self.payees.payee()
		out = self._as(PM_USER, get_vendor_payee, vendor=self._vendor(payee))
		self.assertEqual(out["payee"]["name"], payee)
		self.assertIsNone(self._as(PM_USER, get_vendor_payee, vendor=self._vendor())["payee"])

	# --- changing an Expense's Payee -----------------------------------------

	def test_an_expense_payee_can_change_until_it_is_paid(self):
		first, second = self.payees.payee(), self.payees.payee()
		approved = self._expense(first)
		change_expense_payee(NPE, approved, second)
		self.assertEqual(frappe.db.get_value(NPE, approved, "payee"), second)

		paid = self._expense(first, status="Paid")
		with self.assertRaises(frappe.ValidationError):
			change_expense_payee(NPE, paid, second)
		self.assertEqual(frappe.db.get_value(NPE, paid, "payee"), first)

	def test_an_expense_payee_change_obeys_the_request_rules(self):
		first = self.payees.payee()
		expense = self._expense(first)
		# Required type: can't be left without one.
		with self.assertRaises(frappe.ValidationError):
			change_expense_payee(NPE, expense, None)
		# Inactive: can't be newly picked.
		inactive = self.payees.payee()
		frappe.db.set_value("Payee", inactive, "status", "Inactive")
		with self.assertRaises(frappe.ValidationError):
			change_expense_payee(NPE, expense, inactive)
		# A Project Expense with a vendor is paid into the vendor's Payee only.
		vendor_payee = self.payees.payee()
		project_expense = self._expense(vendor_payee, vendor=self._vendor(vendor_payee),
		                                doctype="Project Expenses")
		with self.assertRaises(frappe.ValidationError):
			change_expense_payee("Project Expenses", project_expense, first)
		self.assertEqual(frappe.db.get_value(NPE, expense, "payee"), first)
