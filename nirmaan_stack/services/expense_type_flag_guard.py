# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A test suite must leave every Expense Type that existed before it with the ledger flags it had (#1677).

`project` and `non_project` say which ledger a type is for, and these suites run against a live site's
database: a suite that flips a real type's flag and does not put it back fails other suites on that site
for a reason none of them caused (`Travel Expenses (Bus)` left at `project = 1`).

`ExpenseTypeFlagGuard` is a mixin for a `FrappeTestCase` that writes Expense Types:

    class TestSomething(ExpenseTypeFlagGuard, FrappeTestCase): ...

It reads every type's flags when the class sets up, and when the class is done it puts back any flag that
changed on a type from before the suite and fails the suite, naming each one. A type the suite made itself
is the suite's to change. Only committed changes count: the guard rolls back before it reads.
"""

import frappe

FLAGS = ("project", "non_project")


def flag_snapshot() -> dict[str, tuple[int, int]]:
	return {r.name: (r.project, r.non_project)
	        for r in frappe.get_all("Expense Type", fields=["name", *FLAGS])}


def restore_changed_flags(before: dict[str, tuple[int, int]]) -> dict[str, tuple[tuple, tuple]]:
	"""Put back the flags of each type in `before` that changed; returns {name: (was, found)}."""
	frappe.db.rollback()
	now = flag_snapshot()
	changed = {name: (was, now[name]) for name, was in before.items() if name in now and now[name] != was}
	for name, (was, _found) in changed.items():
		# Raw on purpose: the Expense Type `on_update` hook prunes Records without review by ROLES, which
		# a flag write never changes, and a restore must not stamp `modified` as if a person edited it.
		frappe.db.set_value("Expense Type", name, dict(zip(FLAGS, was)), update_modified=False)
	frappe.db.commit()
	return changed


class ExpenseTypeFlagGuard:
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.addClassCleanup(cls._check_expense_type_flags, flag_snapshot())

	@classmethod
	def _check_expense_type_flags(cls, before):
		changed = restore_changed_flags(before)
		if changed:
			lines = "; ".join(f"{name}: (project, non_project) was {was}, left {found}"
			                  for name, (was, found) in sorted(changed.items()))
			raise AssertionError(f"{cls.__name__} left Expense Type flags changed (put back now): {lines}")
