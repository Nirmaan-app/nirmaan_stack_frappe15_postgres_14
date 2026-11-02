# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""`Expense Type` is NOT a fixture (owner, 2026-11-02), and a new site still gets its types.

Until 2026-11-02 every `bench migrate` re-imported `fixtures/expense_type.json`, which undid every type
edited in the app and brought back a misspelled `Reimbursments` beside `Reimbursements`. Frappe imports
EVERY `.json` file in `fixtures/` on migrate, whatever `hooks.py` lists, so both must stay clear of it.

A new site gets the types once, from `services/expense_types_seed.json` (`services/expense_type_seed`).

Run:
  devenv.sh test --module nirmaan_stack.api.expense_requests.test_fixture_completeness
"""

import os

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.expense_type_seed import seed_expense_types, seed_rows


def _fixture_path(doctype: str) -> str:
	return os.path.join(frappe.get_app_path("nirmaan_stack"), "fixtures", frappe.scrub(doctype) + ".json")


def _listed_fixtures() -> set:
	return {f if isinstance(f, str) else f.get("dt") for f in frappe.get_hooks("fixtures") or []}


class TestExpenseTypeIsNotAFixture(FrappeTestCase):
	def test_no_migrate_re_imports_the_expense_types(self):
		self.assertNotIn("Expense Type", _listed_fixtures())
		self.assertFalse(os.path.exists(_fixture_path("Expense Type")),
		                 "fixtures/expense_type.json would overwrite every type on each migrate")

	def test_the_expense_category_is_gone_from_the_fixtures(self):
		"""`Expense Category` was removed (owner, 2026-10-27); a leftover fixture would fail the migrate."""
		self.assertFalse(os.path.exists(_fixture_path("Expense Category")))
		self.assertNotIn("Expense Category", _listed_fixtures())


class TestANewSiteGetsTheSeedTypes(FrappeTestCase):
	def tearDown(self):
		frappe.db.rollback()

	def test_the_seed_runs_after_install(self):
		self.assertIn("nirmaan_stack.services.expense_type_seed.seed_expense_types",
		              frappe.get_hooks("after_sync", app_name="nirmaan_stack"))

	def test_the_seed_carries_no_misspelled_type(self):
		names = {row["name"] for row in seed_rows()}
		self.assertLessEqual({"Reimbursements", "Software Charges"}, names)
		self.assertFalse({"Reimbursments", "Software Chagres"} & names)

	def test_a_missing_type_is_added_and_an_existing_one_is_left_as_it_is(self):
		tag = frappe.generate_hash(length=6)
		kept = frappe.get_doc({"doctype": "Expense Type", "expense_name": f"Seed kept {tag}",
		                       "non_project": 1, "payee_rule": "Required"}).insert(ignore_permissions=True)
		rows = [
			{"name": kept.name, "expense_name": kept.name, "non_project": 1, "payee_rule": "Not asked"},
			{"name": f"Seed new {tag}", "expense_name": f"Seed new {tag}", "project": 1,
			 "allowed_roles": [{"role_profile": "Nirmaan Accountant Profile"}]},
		]

		self.assertEqual(seed_expense_types(rows), [f"Seed new {tag}"])

		self.assertEqual(frappe.db.get_value("Expense Type", kept.name, "payee_rule"), "Required")
		added = frappe.get_doc("Expense Type", f"Seed new {tag}")
		self.assertEqual([r.role_profile for r in added.allowed_roles], ["Nirmaan Accountant Profile"])
		self.assertEqual(seed_expense_types(rows), [])
