# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""A paid challan links to the TDS Payment expense that records it (#1544, spec #1528 story 72).

Driven as an Accountant through both doors: the challan list's link action (`set_challan_expense`) and a
challan saved in Desk. The warning for a
challan with no expense is the screen's; what the server owns is which expense may be linked:
a non-project *TDS Payment* expense that isn't Rejected, and never one already on another challan.

⚠️ RUNS AGAINST THE SITE DATABASE. Every challan, expense and the Accountant user made here are removed
in cleanup.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import nowdate

from nirmaan_stack.api.tds_challan.challan_expense import set_challan_expense

CHALLAN = "TDS Challan Attachment"
EXPENSE = "Non Project Expenses"
ACCOUNTANT = "Nirmaan Accountant"


class TestChallanExpenseLink(FrappeTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		self.challans: list[str] = []
		self.expenses: list[str] = []
		self.addCleanup(self._drop_records)
		self.email = f"test-1544-acct-{frappe.generate_hash(length=6)}@example.com"
		frappe.get_doc({
			"doctype": "User", "email": self.email, "first_name": "Challan Link", "send_welcome_email": 0,
			"roles": [{"role": ACCOUNTANT}],
		}).insert(ignore_permissions=True)
		frappe.db.commit()
		self.addCleanup(self._drop_user)

	# -- cleanup ----------------------------------------------------------------------------------
	def _drop_user(self):
		frappe.set_user("Administrator")
		frappe.db.rollback()
		frappe.delete_doc("User", self.email, force=True, ignore_permissions=True)
		for contact in frappe.get_all("Contact", {"email_id": self.email}, pluck="name"):
			frappe.delete_doc("Contact", contact, force=True, ignore_permissions=True)
		frappe.db.commit()

	def _drop_records(self):
		frappe.set_user("Administrator")
		frappe.db.rollback()
		failures = []
		for doctype, names in ((CHALLAN, self.challans), (EXPENSE, self.expenses)):
			if not names:
				continue
			try:
				frappe.db.delete("Version", {"ref_doctype": doctype, "docname": ["in", names]})
				frappe.db.delete(doctype, {"name": ["in", names]})
				frappe.db.commit()
			except Exception as error:  # noqa: BLE001 - report every scope, strand none silently
				frappe.db.rollback()
				failures.append(f"{doctype}: {error}")
		if failures:
			raise AssertionError("cleanup failed: " + "; ".join(failures))

	# -- arrangement ------------------------------------------------------------------------------
	def _expense(self, type="TDS Payment", status="Paid"):
		"""An expense as the expense screens leave it. Raw, because how it got there isn't under test."""
		doc = frappe.new_doc(EXPENSE)
		doc.update({"type": type, "status": status, "amount": 1000, "payment_date": nowdate()})
		doc.name = f"TEST-1544-{frappe.generate_hash(length=10)}"
		doc.db_insert()
		frappe.db.commit()
		self.expenses.append(doc.name)
		return doc.name

	def _as_accountant(self, action, *args):
		frappe.set_user(self.email)
		try:
			return action(*args)
		finally:
			frappe.set_user("Administrator")

	def _new_challan(self, expense=None):
		"""An Accountant records a challan, optionally naming its expense in the same save."""
		key = frappe.generate_hash(length=8)
		doc = frappe.get_doc({
			"doctype": CHALLAN, "financial_year": "2026-27", "amount": 1000, "date_of_deposit": nowdate(),
			"bank_reference_number": f"T1544{key}", "bsr_code": "0006900", "challan_no": key,
			"challan_attachment": "/private/files/test-1544-challan.pdf", "tds_payment_expense": expense,
		})
		doc.insert()
		frappe.db.commit()
		self.challans.append(doc.name)
		return doc.name

	def _link(self, challan, expense):
		"""What the challan list's Link / Unlink does."""
		return set_challan_expense(challan, expense)

	def _linked(self, challan):
		return frappe.db.get_value(CHALLAN, challan, "tds_payment_expense")

	def assertRefused(self, *naming, action, args):
		with self.assertRaises(frappe.ValidationError) as caught:
			self._as_accountant(action, *args)
		frappe.db.rollback()
		for text in naming:
			self.assertIn(text, str(caught.exception))

	# -- behaviour --------------------------------------------------------------------------------
	def test_an_accountant_links_a_challan_to_its_tds_payment_expense(self):
		challan = self._as_accountant(self._new_challan)
		self.assertFalse(self._linked(challan))
		expense = self._expense()

		self._as_accountant(self._link, challan, expense)

		self.assertEqual(self._linked(challan), expense)

	def test_one_expense_cannot_be_linked_to_two_challans(self):
		expense = self._expense()
		first = self._as_accountant(self._new_challan, expense)
		second = self._as_accountant(self._new_challan)

		self.assertRefused(expense, first, action=self._link, args=(second, expense))
		self.assertFalse(self._linked(second))
		self.assertEqual(self._linked(first), expense)

	def test_a_new_challan_cannot_take_an_expense_already_on_another(self):
		expense = self._expense()
		first = self._as_accountant(self._new_challan, expense)

		self.assertRefused(first, action=self._new_challan, args=(expense,))
		self.assertEqual(frappe.db.count(CHALLAN, {"tds_payment_expense": expense}), 1)

	def test_a_challan_keeps_its_own_expense_on_a_later_save(self):
		expense = self._expense()
		challan = self._as_accountant(self._new_challan, expense)

		def edit_bank():
			doc = frappe.get_doc(CHALLAN, challan)
			doc.bank_name = "Test Bank"
			doc.save()
			frappe.db.commit()

		self._as_accountant(edit_bank)

		self.assertEqual(self._linked(challan), expense)

	def test_only_a_tds_payment_expense_can_be_linked(self):
		challan = self._as_accountant(self._new_challan)
		expense = self._expense(type="GST Payment")

		self.assertRefused(expense, "TDS Payment", action=self._link, args=(challan, expense))
		self.assertFalse(self._linked(challan))

	def test_a_rejected_expense_cannot_be_linked(self):
		challan = self._as_accountant(self._new_challan)
		expense = self._expense(status="Rejected")

		self.assertRefused(expense, "Rejected", action=self._link, args=(challan, expense))
		self.assertFalse(self._linked(challan))

	def test_a_linked_expense_cannot_be_deleted(self):
		expense = self._expense()
		challan = self._as_accountant(self._new_challan, expense)

		self.assertRefused(challan, action=frappe.delete_doc, args=(EXPENSE, expense))

		self.assertTrue(frappe.db.exists(EXPENSE, expense))
		self.assertEqual(self._linked(challan), expense)

	def test_a_project_manager_cannot_link_an_expense(self):
		challan = self._as_accountant(self._new_challan)
		expense = self._expense()
		manager = f"test-1544-pm-{frappe.generate_hash(length=6)}@example.com"
		frappe.get_doc({
			"doctype": "User", "email": manager, "first_name": "Challan Link PM", "send_welcome_email": 0,
			"roles": [{"role": "Nirmaan Project Manager"}],
		}).insert(ignore_permissions=True)
		frappe.db.commit()
		self.addCleanup(lambda: (frappe.set_user("Administrator"), frappe.db.rollback(),
			frappe.delete_doc("User", manager, force=True, ignore_permissions=True), frappe.db.commit()))

		frappe.set_user(manager)
		try:
			with self.assertRaises(frappe.PermissionError):
				self._link(challan, expense)
		finally:
			frappe.set_user("Administrator")
		frappe.db.rollback()

		self.assertFalse(self._linked(challan))

	def test_unlinking_leaves_the_challan_without_an_expense(self):
		expense = self._expense()
		challan = self._as_accountant(self._new_challan, expense)

		self._as_accountant(self._link, challan, None)

		self.assertFalse(self._linked(challan))
