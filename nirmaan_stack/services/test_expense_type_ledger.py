# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Every ledger write refuses an expense type that does not belong in that ledger (spec #1494, #1496).

A Project Expense takes a project-flagged type and a Non Project Expense a non-project-flagged one. Both
ledgers ask `services/expense_type_ledger` on validate, so every path is covered: the request intake,
the imports, the PO-adjustment ad-hoc expense, Desk and data import.

Run:
  devenv.sh test --module nirmaan_stack.services.test_expense_type_ledger
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.payees.payee_fixture import delete_each
from nirmaan_stack.api.po_adjustments.adjustment_logic import execute_adjustment

U = "Administrator"
PE = "Project Expenses"
NPE = "Non Project Expenses"
# Flagged for both ledgers in the shipped fixture (`fixtures/expense_type.json`).
BOTH_LEDGER_TYPES = ("Petty Cash", "Material Transportation Charges")


class TestExpenseTypeLedger(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user(U)
        cls.types = {}
        for side, project in (("project", 1), ("non_project", 0)):
            doc = frappe.new_doc("Expense Type")
            doc.update({"expense_name": f"etl_test_{side}_{frappe.generate_hash(length=5)}",
                        "project": project, "non_project": 1 - project,
                        "expense_category": "Uncategorized"})
            doc.insert(ignore_permissions=True)
            cls.types[side] = doc.name
        # Raw, like the Direct Expense suite: `Projects.after_insert` builds work milestones.
        cls.project = f"TEST-ETL-{frappe.generate_hash(length=8)}"
        frappe.db.sql(
            """INSERT INTO "tabProjects" (name, creation, modified, modified_by, owner, docstatus, idx,
                                          project_name)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s)""",
            (cls.project, U, U, cls.project),
        )
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.set_user(U)
        try:
            delete_each([("Expense Type", n) for n in cls.types.values()] + [("Projects", cls.project)],
                        raw={"Projects"})
        finally:
            super().tearDownClass()

    def setUp(self):
        frappe.set_user(U)
        self.tag = f"etl test {frappe.generate_hash(length=8)}"
        self.addCleanup(self._purge)

    def _purge(self):
        scopes = [(doctype, name) for doctype in (PE, NPE)
                  for name in frappe.get_all(doctype, {"description": ["like", f"{self.tag}%"]}, pluck="name")]
        delete_each(scopes, raw={PE, NPE})
        frappe.db.commit()

    def _save(self, doctype, expense_type):
        doc = frappe.new_doc(doctype)
        doc.update({"type": expense_type, "amount": 2500, "description": self.tag,
                    **({"projects": self.project} if doctype == PE else {})})
        doc.insert(ignore_permissions=True)
        return doc

    def test_a_project_expense_refuses_a_non_project_type(self):
        with self.assertRaisesRegex(frappe.ValidationError, "not an expense type for Project Expenses"):
            self._save(PE, self.types["non_project"])

    def test_a_non_project_expense_refuses_a_project_type(self):
        with self.assertRaisesRegex(frappe.ValidationError, "not an expense type for Non Project Expenses"):
            self._save(NPE, self.types["project"])

    def test_each_ledger_takes_its_own_type(self):
        self.assertEqual(self._save(PE, self.types["project"]).type, self.types["project"])
        self.assertEqual(self._save(NPE, self.types["non_project"]).type, self.types["non_project"])

    def test_a_type_flagged_for_both_ledgers_saves_on_either(self):
        for expense_type in BOTH_LEDGER_TYPES:
            for doctype in (PE, NPE):
                with self.subTest(expense_type=expense_type, doctype=doctype):
                    self.assertTrue(self._save(doctype, expense_type).name)

    def test_changing_the_type_to_one_from_the_other_ledger_is_refused(self):
        doc = self._save(PE, self.types["project"])
        doc.type = self.types["non_project"]
        with self.assertRaisesRegex(frappe.ValidationError, "not an expense type for Project Expenses"):
            doc.save(ignore_permissions=True)

    def test_an_old_row_whose_type_no_longer_fits_still_saves_while_its_type_is_unchanged(self):
        """A legacy row is not stranded by the check: only a new row or a changed type is asked."""
        doc = self._save(PE, self.types["project"])
        frappe.db.set_value("Expense Type", self.types["project"], "project", 0)
        self.addCleanup(frappe.db.set_value, "Expense Type", self.types["project"], "project", 1)
        doc.reload()
        doc.comment = "edited later"
        doc.save(ignore_permissions=True)
        self.assertEqual(frappe.db.get_value(PE, doc.name, "comment"), "edited later")


class TestPOAdjustmentAdhocType(FrappeTestCase):
    """The PO-adjustment ad-hoc expense is a Project Expense, so a non-project type is refused.

    No fixtures here: `execute_adjustment` rolls back on any error, and the refusal comes before it
    reads a PO, so it is asked against a PO that does not exist."""

    def test_an_adhoc_expense_with_a_non_project_type_is_refused_before_anything_is_written(self):
        frappe.set_user(U)
        entry = {"return_type": "Ad-hoc", "amount": 500, "ad-hoc_type": "Travel Expenses (Bus)",
                 "ad-hoc_description": "etl test"}
        with self.assertRaisesRegex(frappe.ValidationError,
                                    "'Travel Expenses \\(Bus\\)' is not an expense type for Project Expenses"):
            execute_adjustment("PO/ETL/NO-SUCH-PO", json.dumps([entry]))
