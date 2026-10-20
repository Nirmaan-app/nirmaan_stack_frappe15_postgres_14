# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""An Expense made from a request is raised by the requester (spec #1494, owner ruling 2026-10-20).

Drives the patch `patches/v3_0/backfill_expense_owner_from_request` on fixture rows, scoped to them so
it never touches a real one, and reads back each Expense's `owner`.

⚠️ RUNS AGAINST THE ENV DATABASE (each test commits). Every row is inserted raw with a TESTEOB name
and deleted after the test.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.payees.payee_fixture import delete_each
from nirmaan_stack.patches.v3_0.backfill_expense_owner_from_request import backfill_expense_owners

REQUESTER = "testeob_pm@example.com"
REVIEWER = "testeob_hr@example.com"


class TestBackfillExpenseOwnerFromRequest(FrappeTestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        self.rows: list[tuple[str, str]] = []
        self.addCleanup(self._delete_rows)

    def _delete_rows(self):
        # Rolls back first, then deletes each row in its own scope and names any that failed
        # (CODING_STANDARDS § Writing tests), so a failed test never strands a TESTEOB row.
        delete_each(reversed(self.rows), raw={doctype for doctype, _ in self.rows})

    def _insert(self, doctype: str, owner: str, **values) -> str:
        name = f"TESTEOB-{frappe.generate_hash(length=8)}"
        columns = "".join(f", {column}" for column in values)
        marks = "".join(", %s" for _ in values)
        frappe.db.sql(
            f"""INSERT INTO "tab{doctype}" (name, creation, modified, modified_by, owner, docstatus, idx{columns})
                VALUES (%s, NOW(), NOW(), %s, %s, 0, 0{marks})""",
            (name, owner, owner, *values.values()),
        )
        frappe.db.commit()
        self.rows.append((doctype, name))
        return name

    def _run(self, expenses: list[str]) -> dict:
        result = backfill_expense_owners(expenses=expenses)
        frappe.db.commit()
        return result

    @staticmethod
    def _owner(doctype: str, name: str) -> str:
        return frappe.db.get_value(doctype, name, "owner")

    def test_an_expense_owned_by_its_reviewer_is_handed_to_the_requester(self):
        request = self._insert("Expense Request", REQUESTER, status="Approved")
        project = self._insert("Project Expenses", REVIEWER, request_id=request, status="Approved")
        non_project = self._insert("Non Project Expenses", REVIEWER, request_id=request, status="Approved")

        self._run([project, non_project])

        self.assertEqual(self._owner("Project Expenses", project), REQUESTER)
        self.assertEqual(self._owner("Non Project Expenses", non_project), REQUESTER)

    def test_an_expense_with_no_request_keeps_its_owner(self):
        expense = self._insert("Non Project Expenses", REVIEWER, status="Paid")

        self._run([expense])

        self.assertEqual(self._owner("Non Project Expenses", expense), REVIEWER)

    def test_a_second_run_changes_nothing(self):
        request = self._insert("Expense Request", REQUESTER, status="Approved")
        expense = self._insert("Project Expenses", REVIEWER, request_id=request, status="Approved")
        modified = frappe.db.get_value("Project Expenses", expense, "modified")

        first = self._run([expense])
        second = self._run([expense])

        self.assertEqual(first, {"Project Expenses": 1, "Non Project Expenses": 0})
        self.assertEqual(second, {"Project Expenses": 0, "Non Project Expenses": 0})
        self.assertEqual(self._owner("Project Expenses", expense), REQUESTER)
        self.assertEqual(frappe.db.get_value("Project Expenses", expense, "modified"), modified)
