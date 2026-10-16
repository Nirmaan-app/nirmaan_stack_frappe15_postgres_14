# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""The request's payee picker (spec #1420 tickets #1429, #1434, #1436, ADR-0033): search (by holder
name), add, the vendor's Payee, and changing an Expense's account.

Anyone who can raise an Expense Request may search Payees and add one from the request; nobody else.

Run:
  devenv.sh test --module nirmaan_stack.api.expense_requests.test_request_payees
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.expense_requests.payees import (
	add_request_payee,
	check_request_payee,
	search_payees,
)
from nirmaan_stack.api.expense_requests.test_expense_requests import _make_user
from nirmaan_stack.api.payees.payee_fixture import TEST_IFSC, PayeeFixture, delete_each
from nirmaan_stack.api.payees.vendor_payee import get_vendor_account
from nirmaan_stack.services import expense_request_routing as routing
from nirmaan_stack.services.payees.expense_payee import change_expense_account

PM_USER = "exr_test_pyepm@example.com"
NOBODY = "exr_test_pyenobody2@example.com"
# Can record an expense (Frappe create on both expense doctypes) but raise no request: no role profile.
PROCUREMENT = "exr_test_pyeproc@example.com"
USERS = (PM_USER, NOBODY, PROCUREMENT)
PM_PROFILE = "Nirmaan Project Manager Profile"
NPE = "Non Project Expenses"


class TestRequestPayees(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		_make_user(PM_USER, PM_PROFILE, ("Nirmaan Project Manager",))
		# A signed-in user with no role profile (so no expense type to raise) and no create right on
		# either expense doctype (HR Lead holds read only): they may name no Payee.
		_make_user(NOBODY, None, ("Nirmaan HR Lead",))
		_make_user(PROCUREMENT, None, ("Nirmaan Procurement Executive",))
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
		scopes = [("Expense Type", cls.expense_type)] + [
			(dt, email) for email in USERS for dt in ("Nirmaan Users", "User")
		]
		delete_each(scopes)
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

	def _expense(self, status="Approved", doctype=NPE) -> str:
		"""An expense row with no account, inserted raw (no hooks), deleted after the test."""
		name = f"exr-test-pye-{frappe.generate_hash(length=8)}"
		frappe.db.sql(
			f"""INSERT INTO "tab{doctype}" (name, creation, modified, modified_by, owner, docstatus, idx,
			                                type, amount, status)
			   VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, 100, %s)""",
			(name, self.expense_type, status),
		)
		frappe.db.commit()

		self.addCleanup(delete_each, [(doctype, name)], raw={doctype})
		return name

	def _search(self, text):
		return {r["name"]: r for r in self._as(PM_USER, search_payees, text=text)}

	# --- search --------------------------------------------------------------

	def test_a_raiser_finds_a_payee_by_holder_name(self):
		holder = self.payees.holder("Ramesh Yadav")
		payee = self.payees.payee(holder=holder)

		found = self._search(holder.split(" ", 1)[1].lower())
		self.assertIn(payee, found)
		row = found[payee]
		self.assertEqual(row["account_name"], holder)
		self.assertEqual(row["ifsc"], TEST_IFSC)
		self.assertEqual(row["bank_name"], "Test Bank")
		# An address book entry: no status, and nothing paid counts (#1434).
		self.assertNotIn("times_paid", row)
		self.assertNotIn("status", row)

	def test_matches_come_by_holder_name(self):
		tag = frappe.generate_hash(length=6)
		zubair = self.payees.payee(holder=f"TESTPYE {tag} Zubair Traders")
		anil = self.payees.payee(holder=f"TESTPYE {tag} Anil Verma")
		mehta = self.payees.payee(holder=f"TESTPYE {tag} Mehta Rentals")

		found = [r["name"] for r in self._as(PM_USER, search_payees, text=tag)]
		self.assertEqual([n for n in found if n in (zubair, anil, mehta)], [anil, mehta, zubair])

	def test_a_raiser_finds_a_payee_by_account_number_ignoring_spaces_and_leading_zeros(self):
		number = self.payees.account_number()
		payee = self.payees.payee(account_number=number)
		self.assertIn(payee, self._search(f"00{number[:5]} {number[5:]}"))

	def test_someone_who_can_record_an_expense_but_raise_no_request_searches_checks_and_adds(self):
		"""The Add Expense dialogs name who gets paid through these endpoints too (#1471)."""
		number = self.payees.account_number()
		existing = self.payees.payee(account_number=number)
		self.assertIn(existing, [r["name"] for r in self._as(PROCUREMENT, search_payees, text=number)])
		checked = self._as(PROCUREMENT, check_request_payee, account_number=number, ifsc=TEST_IFSC)
		self.assertEqual(checked["duplicate"]["name"], existing)
		holder = self.payees.holder("Procurement")
		out = self._as(PROCUREMENT, add_request_payee, account_name=holder,
		               account_number=self.payees.account_number(), ifsc=TEST_IFSC)
		self.assertEqual(frappe.db.get_value("Payee", out["payee"]["name"], "account_name"), holder)

	def test_someone_who_can_neither_raise_a_request_nor_record_an_expense_cannot_search_or_add(self):
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
		self.assertEqual(created["account_name"], holder)

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

	def test_a_raiser_reads_the_vendors_payee_as_every_screen_does(self):
		"""The request dialog reads the picked vendor's account through the vendor screens' endpoint:
		a raiser can, because the vendor picker already needs Vendors read."""
		payee = self.payees.payee()
		vendor = self.payees.vendor(payee, vendor_name="TESTPYE Raiser Vendor")
		out = self._as(PM_USER, get_vendor_account, vendor=vendor)
		self.assertEqual((out["vendor_name"], out["payee"]["name"]), ("TESTPYE Raiser Vendor", payee))
		self.assertIsNone(self._as(PM_USER, get_vendor_account, vendor=self.payees.vendor())["payee"])

	# --- changing an Expense's account ---------------------------------------

	def test_changing_an_expenses_account_copies_it_paid_or_not(self):
		"""Change account copies the Payee's account onto the expense (#1436, #1438). Whether it may
		still change once paid is a screen rule, not a server refusal."""
		first, second = self.payees.payee(), self.payees.payee()
		for status in ("Approved", "Paid"):
			with self.subTest(status=status):
				expense = self._expense(status=status)
				change_expense_account(NPE, expense, first)
				change_expense_account(NPE, expense, second)
				self.assertEqual(
					frappe.db.get_value(NPE, expense, ["pay_to_account_name", "pay_to_account_number", "pay_to_ifsc"]),
					frappe.db.get_value("Payee", second, ["account_name", "account_number", "ifsc"]),
				)
