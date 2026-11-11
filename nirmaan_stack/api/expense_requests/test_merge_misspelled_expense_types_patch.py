# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""`patches/v3_0/merge_misspelled_expense_types.py` against real rows.

⚠️ RUNS AGAINST THE SITE DATABASE, so it calls `merge_into` with types it creates -- never `execute()`,
which would merge the site's real types and commit. Every test rolls back.

Run:
  devenv.sh test --module nirmaan_stack.api.expense_requests.test_merge_misspelled_expense_types_patch
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.patches.v3_0.merge_misspelled_expense_types import MISSPELLED, merge_into
from nirmaan_stack.services.expense_type_flag_guard import ExpenseTypeFlagGuard


def _type(name, **fields):
	doc = frappe.get_doc({"doctype": "Expense Type", "expense_name": name, "non_project": 1, **fields})
	doc.insert(ignore_permissions=True)
	return doc.name


def _raw(doctype, **fields):
	"""An expense row as it sits in the table; its own validation is not what is under test."""
	doc = frappe.new_doc(doctype)
	doc.update(fields)
	doc.name = "TMRG-" + frappe.generate_hash(length=10)
	doc.db_insert()
	return doc.name


class TestMergeMisspelledExpenseTypes(ExpenseTypeFlagGuard, FrappeTestCase):
	def setUp(self):
		tag = frappe.generate_hash(length=6)
		self.old = f"Reimbursmnts {tag}"
		self.new = f"Reimbursements {tag}"

	def tearDown(self):
		frappe.db.rollback()

	def test_the_misspelled_types_are_the_two_found_on_production(self):
		self.assertEqual(MISSPELLED, (("Reimbursments", "Reimbursements"),
		                              ("Software Chagres", "Software Charges")))

	def test_every_expense_moves_to_the_correct_type_and_the_typo_is_gone(self):
		_type(self.old, payee_rule="Not asked")
		_type(self.new, payee_rule="Required")
		npe = [_raw("Non Project Expenses", type=self.old) for _ in range(3)]
		pe = _raw("Project Expenses", type=self.old)
		er = _raw("Expense Request", type=self.old)
		kept = _raw("Non Project Expenses", type=self.new)

		self.assertEqual(merge_into(self.old, self.new), "merged")

		self.assertFalse(frappe.db.exists("Expense Type", self.old))
		for name in npe + [kept]:
			self.assertEqual(frappe.db.get_value("Non Project Expenses", name, "type"), self.new)
		self.assertEqual(frappe.db.get_value("Project Expenses", pe, "type"), self.new)
		self.assertEqual(frappe.db.get_value("Expense Request", er, "type"), self.new)
		# The correct type's own settings win.
		self.assertEqual(frappe.db.get_value("Expense Type", self.new, "payee_rule"), "Required")

	def test_a_typo_with_no_correct_type_is_renamed_name_and_label(self):
		_type(self.old)
		npe = _raw("Non Project Expenses", type=self.old)

		self.assertEqual(merge_into(self.old, self.new), "renamed")

		self.assertEqual(frappe.db.get_value("Expense Type", self.new, "expense_name"), self.new)
		self.assertEqual(frappe.db.get_value("Non Project Expenses", npe, "type"), self.new)

	def test_a_second_run_does_nothing(self):
		_type(self.old)
		_type(self.new)
		merge_into(self.old, self.new)
		self.assertIsNone(merge_into(self.old, self.new))
		self.assertTrue(frappe.db.exists("Expense Type", self.new))
