# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""A suite that leaves an existing Expense Type's ledger flags changed fails, and the flags are put back (#1677).

Each case runs a small inner suite through `unittest` and reads its result. The "existing" type is a made-up one
this test inserts before the inner suite starts, so no real type is ever touched.

Run:
  devenv.sh test --module nirmaan_stack.services.test_expense_type_flag_guard
"""

import io
import unittest

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.expense_type_flag_guard import ExpenseTypeFlagGuard


def _run(case_class) -> unittest.TestResult:
	suite = unittest.defaultTestLoader.loadTestsFromTestCase(case_class)
	return unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(suite)


def _flags(name):
	return tuple(frappe.db.get_value("Expense Type", name, ["project", "non_project"]))


class TestExpenseTypeFlagGuard(FrappeTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		self.existing = f"etfg_test_{frappe.generate_hash(length=6)}"
		frappe.get_doc({"doctype": "Expense Type", "expense_name": self.existing,
		                "project": 0, "non_project": 1}).insert(ignore_permissions=True)
		frappe.db.commit()
		self.addCleanup(self._drop, self.existing)

	@staticmethod
	def _drop(name):
		frappe.db.rollback()
		frappe.set_user("Administrator")
		if frappe.db.exists("Expense Type", name):
			frappe.delete_doc("Expense Type", name, force=True, ignore_permissions=True)
		frappe.db.commit()

	def test_a_suite_that_leaves_a_flag_changed_fails_and_the_flag_is_put_back(self):
		existing = self.existing

		class Leaks(ExpenseTypeFlagGuard, FrappeTestCase):
			def test_flips(self):
				frappe.db.set_value("Expense Type", existing, "project", 1)
				frappe.db.commit()

		result = _run(Leaks)

		self.assertFalse(result.wasSuccessful())
		self.assertIn(existing, "".join(text for _case, text in result.errors))
		self.assertEqual(_flags(existing), (0, 1))

	def test_a_suite_that_restores_what_it_changed_passes(self):
		existing = self.existing

		class Restores(ExpenseTypeFlagGuard, FrappeTestCase):
			def test_flips_and_restores(self):
				frappe.db.set_value("Expense Type", existing, "project", 1)
				frappe.db.commit()
				self.addCleanup(lambda: (frappe.db.set_value("Expense Type", existing, "project", 0),
				                         frappe.db.commit()))

		self.assertTrue(_run(Restores).wasSuccessful())

	def test_a_change_never_committed_is_not_a_leak(self):
		existing = self.existing

		class RollsBack(ExpenseTypeFlagGuard, FrappeTestCase):
			def test_flips_uncommitted(self):
				frappe.db.set_value("Expense Type", existing, "non_project", 0)

		self.assertTrue(_run(RollsBack).wasSuccessful())
		self.assertEqual(_flags(existing), (0, 1))

	def test_a_type_the_suite_made_itself_is_its_own_to_change(self):
		made = []

		class OwnType(ExpenseTypeFlagGuard, FrappeTestCase):
			def test_makes_and_flips(self):
				name = f"etfg_own_{frappe.generate_hash(length=6)}"
				frappe.get_doc({"doctype": "Expense Type", "expense_name": name,
				                "non_project": 1}).insert(ignore_permissions=True)
				frappe.db.commit()
				made.append(name)
				frappe.db.set_value("Expense Type", name, "project", 1)
				frappe.db.commit()

		result = _run(OwnType)
		for name in made:
			self._drop(name)
		self.assertTrue(result.wasSuccessful())
