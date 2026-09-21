# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""`get_expense_approval_detail` -- what the expense Approve / Reject dialog shows.

Runs against the LIVE site: fixtures inside ONE transaction whose commits are stubbed, rolled back
in `tearDown`.
"""

import json
import unittest

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.approvals.expense_detail import get_expense_approval_detail

AMOUNT = 31237  # odd on purpose, so real rows of the same type rarely share it


def _raw(doctype, **fields):
	doc = frappe.new_doc(doctype)
	doc.update(fields)
	doc.name = frappe.generate_hash(length=12)
	doc.db_insert()
	return doc.name


class TestExpenseApprovalDetail(FrappeTestCase):
	def setUp(self):
		self._commit = frappe.db.commit
		frappe.db.commit = lambda *a, **k: None
		frappe.set_user("Administrator")
		self.type = frappe.db.get_value("Expense Type", {}, "name")
		if not self.type:
			raise unittest.SkipTest("no Expense Type on this site")

		self.raiser = next(iter(frappe.get_all(
			"Nirmaan Users", filters={"role_profile": "Nirmaan Procurement Executive Profile"}, pluck="name",
		)), None) or "Administrator"
		frappe.set_user(self.raiser)
		try:
			self.request = _raw(
				"Expense Request", type=self.type, amount=AMOUNT, status="Approved",
				source_data=json.dumps({"responses": {"detail": {"description": "Diesel for genset"}}}),
			)
		finally:
			frappe.set_user("Administrator")

		self.from_request = frappe.get_doc({
			"doctype": "Project Expenses", "type": self.type, "amount": str(AMOUNT),
			"request_id": self.request, "description": "Diesel for genset · [x]",
		}).insert(ignore_permissions=True).name
		self.direct = frappe.get_doc({
			"doctype": "Non Project Expenses", "type": self.type, "amount": AMOUNT,
			"description": "keyed in directly",
		}).insert(ignore_permissions=True).name

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.commit = self._commit
		frappe.db.rollback()

	def test_a_request_born_row_names_the_requests_owner_and_answers(self):
		d = get_expense_approval_detail("Project Expenses", self.from_request)
		self.assertEqual(d["raised_by"], self.raiser)
		self.assertEqual(d["request"]["name"], self.request)
		self.assertIn("Diesel for genset", [r["value"] for r in d["request"]["detail"]])
		self.assertEqual(d["amount"], AMOUNT)

	def test_similar_lists_the_twin_and_never_the_row_itself(self):
		d = get_expense_approval_detail("Project Expenses", self.from_request)
		names = {(s["doctype"], s["name"]) for s in d["similar"]}
		self.assertIn(("Non Project Expenses", self.direct), names)
		self.assertNotIn(("Project Expenses", self.from_request), names)

		d = get_expense_approval_detail("Non Project Expenses", self.direct)
		names = {(s["doctype"], s["name"]) for s in d["similar"]}
		self.assertIn(("Project Expenses", self.from_request), names)
		self.assertNotIn(("Non Project Expenses", self.direct), names)

	def test_a_direct_row_has_no_request(self):
		d = get_expense_approval_detail("Non Project Expenses", self.direct)
		self.assertIsNone(d["request"])
		self.assertEqual(d["raised_by"], "Administrator")
		self.assertIsNone(d["project"])

	def test_only_the_two_expense_ledgers(self):
		with self.assertRaises(frappe.ValidationError):
			get_expense_approval_detail("Project Payments", self.from_request)
