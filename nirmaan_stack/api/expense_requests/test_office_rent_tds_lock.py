# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""A withheld Office Rent expense keeps its amount, and its tax record goes only with it (spec #1522, #1526).

⚠️ "TDS" HERE IS TAX DEDUCTED AT SOURCE, not a Technical Data Sheet.

Driven through the real endpoints, on the fixture of `test_office_rent_tds`: HR raises the rent, Admin
and the CEO approve it (its tax withheld, its amount the net), then Accounts and Admin edit it through
`frappe.client.set_value` (the save Desk and the app's `updateDoc` make), a bank line settles it
(`link_rows_to_expense`), Pay TDS puts its tax on a challan (`create_challan_and_pay`) and Admin deletes
it through `frappe.client.delete` (the delete Desk and the app's `deleteDoc` make).

Run:
  devenv.sh test --module nirmaan_stack.api.expense_requests.test_office_rent_tds_lock
"""

import json

import frappe
from frappe.client import delete as client_delete
from frappe.client import set_value as client_set_value

from nirmaan_stack.api.expense_requests.test_expense_requests import _make_user
from nirmaan_stack.api.expense_requests.test_office_rent_tds import (
	ACCOUNTANT,
	ADMIN,
	NPE,
	TDS,
	OfficeRentCase,
)
from nirmaan_stack.api.outflow_import.link_lines import link_rows_to_expense
from nirmaan_stack.api.tds_challan import test_pay_tds
from nirmaan_stack.api.tds_challan.pay_tds import create_challan_and_pay

ACCOUNTANT_LEAD = "xrtds_accountant_lead@example.com"
CHALLAN = "TDS Challan Attachment"


class TestAWithheldOfficeRentIsLocked(OfficeRentCase):
	def setUp(self):
		super().setUp()
		_make_user(ACCOUNTANT_LEAD, "Nirmaan Accountant Lead Profile", ("Nirmaan Accountant Lead",))

	# -- helpers --------------------------------------------------------------------------------
	def _withheld(self) -> tuple[str, str, str]:
		"""Rs 1,00,000 of rent, approved by Admin then the CEO: (request, expense, its tax record)."""
		request, name = self._raise(100000)
		self._approve_by_admin_then_ceo(name)
		self.assertEqual(self._expense(name), {"status": "Approved", "amount": 90000})
		[record] = self._records(name)
		return request, name, record.name

	def _set_as(self, user, name, field, value):
		frappe.set_user(user)
		try:
			return client_set_value(NPE, name, field, value)
		finally:
			frappe.set_user("Administrator")

	def _delete_as(self, user, name):
		frappe.set_user(user)
		try:
			client_delete(NPE, name)
		finally:
			frappe.set_user("Administrator")

	def _on_a_challan(self, record) -> str:
		data = test_pay_tds.TestPayTds._challan_data(25000, "RENT")
		return create_challan_and_pay(deductions=frappe.as_json([record]),
		                              challan_data=frappe.as_json(data))["created_challan"]

	# -- the amount is locked -------------------------------------------------------------------
	def test_every_role_is_refused_an_amount_change_and_the_amount_stays_the_net(self):
		_request, name, record = self._withheld()
		for status in ("Approved", "Reconciliation Pending"):
			if status == "Reconciliation Pending":
				self._decide(ACCOUNTANT, name, "mark_done")
			for user in (ACCOUNTANT, ACCOUNTANT_LEAD, ADMIN, "Administrator"):
				with self.subTest(status=status, user=user):
					with self.assertRaises(frappe.ValidationError) as refused:
						self._set_as(user, name, "amount", 100000)
					self.assertIn("tax has been withheld", str(refused.exception))
					self.assertEqual(self._expense(name), {"status": status, "amount": 90000})
		self.assertEqual(frappe.db.get_value(TDS, record, ["gross_amount", "tds_amount"]), (100000, 10000))

	def test_a_system_save_cannot_change_it_either(self):
		_request, name, _record = self._withheld()
		doc = frappe.get_doc(NPE, name)
		doc.amount = 95000
		with self.assertRaises(frappe.ValidationError) as refused:
			doc.save(ignore_permissions=True)
		self.assertIn("tax has been withheld", str(refused.exception))
		self.assertEqual(self._expense(name)["amount"], 90000)

	def test_a_comment_or_description_edit_still_saves(self):
		_request, name, _record = self._withheld()

		self._set_as(ACCOUNTANT, name, "comment", "xrtds paid on the 5th")
		self._set_as(ACCOUNTANT, name, "description", "xrtds rent for October")

		self.assertEqual(frappe.db.get_value(NPE, name, ["comment", "description", "amount"]),
		                 ("xrtds paid on the 5th", "xrtds rent for October", 90000))

	def test_an_office_rent_with_no_tax_record_keeps_an_editable_amount(self):
		# Rs 1,00,000 waits at Requested: nothing is withheld yet.
		_request, name = self._raise(100000)
		self._set_as(ACCOUNTANT, name, "amount", 99000)
		self.assertEqual(self._expense(name), {"status": "Requested", "amount": 99000})

	# -- the one exemption: a bank line's few rupees ----------------------------------------------
	def test_a_bank_line_a_little_short_corrects_the_amount_and_leaves_the_tax_as_withheld(self):
		_request, name, record = self._withheld()
		self._decide(ACCOUNTANT, name, "mark_done")
		line = self._bank_line(89998)

		link_rows_to_expense(rows=json.dumps([line]), target_doctype=NPE, target_name=name)

		self.assertEqual(self._expense(name), {"status": "Paid", "amount": 89998})
		self.assertEqual(frappe.db.get_value(TDS, record, ["gross_amount", "tds_amount", "status"]),
		                 (100000, 10000, "Pending"))

	# -- delete ---------------------------------------------------------------------------------
	def test_deleting_it_while_its_tax_is_on_no_challan_deletes_its_record_too(self):
		request, name, record = self._withheld()

		self._delete_as(ADMIN, name)

		self.assertFalse(frappe.db.exists(NPE, name))
		self.assertFalse(frappe.db.exists(TDS, record))
		self.assertFalse(frappe.db.exists("Expense Request", request), "its request goes with it")

	def test_deleting_it_once_its_tax_is_on_a_challan_is_refused_naming_the_challan(self):
		request, name, record = self._withheld()
		challan = self._on_a_challan(record)
		used = frappe.db.get_value(CHALLAN, challan, "reconciled_amount")
		self.assertEqual(used, 10000)

		for user in (ADMIN, "Administrator"):
			with self.subTest(user=user):
				with self.assertRaises(frappe.ValidationError) as refused:
					self._delete_as(user, name)
				self.assertIn(challan, str(refused.exception))

		self.assertTrue(frappe.db.exists(NPE, name))
		self.assertEqual(frappe.db.get_value(TDS, record, ["tds_challan", "status"]), (challan, "Paid"))
		self.assertTrue(frappe.db.exists("Expense Request", request))
		self.assertEqual(frappe.db.get_value(CHALLAN, challan, "reconciled_amount"), used)
