# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Cashbook import's two lookup tables and their loaders (slice 3).

    bench --site localhost run-tests --app nirmaan_stack \
        --module nirmaan_stack.api.outflow_import.test_cashbook_rules

⚠️ THESE TABLES ARE OPERATIONAL DATA -- somebody is expected to edit them in Desk -- so this suite
plants its OWN rows and asserts behaviour on those, never on the seeded content. A test asserting
"there are 42 rules" would fail the first time an accountant adds one, which is the opposite of
what these tables are for. The one exception is `Petty Cash`, which is asserted directly because it
ships as a fixture and nothing works without it.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.outflow_import.candidates import (
    load_expense_rules,
    load_project_aliases,
)
from nirmaan_stack.services.outflow_import.project_match import build_project_index

RULE = "Outflow Import Expense Rule"
ALIAS = "Outflow Import Project Alias"


class TestPettyCashExists(FrappeTestCase):
    """The fallback every unmatched row lands on. Without it a Cashbook import writes nothing."""

    def test_it_is_available_on_both_ledgers(self):
        """⚠️ UNUSUAL BUT NOT NOVEL, and the whole design depends on it.

        A row that finds no project becomes a Non-Project Expense and a row that finds one becomes
        a Project Expense; both fall back to this type, and `settle._assert_type_scope` refuses a
        type lacking the flag for its side. `Travel Expenses (Bus)` and `(Train)` already carry
        both, so the "the two flags are disjoint" line in the root CLAUDE.md was describing a
        convention rather than a constraint.
        """
        row = frappe.db.get_value(
            "Expense Type", "Petty Cash", ["project", "non_project"], as_dict=True
        )
        self.assertIsNotNone(row, "the Petty Cash expense type is missing")
        self.assertTrue(row.project, "Petty Cash must be available to Project Expenses")
        self.assertTrue(row.non_project, "Petty Cash must be available to Non Project Expenses")


class TestExpenseRuleRefusesAnInertMapping(FrappeTestCase):
    """A rule pointing at the wrong side of the ledger can never fire.

    `settle._assert_type_scope` would refuse the type at write time and the row would drop to the
    fallback, with nothing on screen explaining why the rule its author wrote never applied. The
    guard turns a silent no-op into a message at the moment of writing.
    """

    def test_a_project_rule_cannot_name_a_non_project_only_type(self):
        with self.assertRaises(frappe.ValidationError) as caught:
            frappe.get_doc(
                {
                    "doctype": RULE,
                    "keyword": f"zz{frappe.generate_hash(length=6)}",
                    "ledger": "Project",
                    "expense_type": "Staff Welfare Expenses",
                }
            ).insert(ignore_permissions=True)
        self.assertIn("not available for a Project expense", str(caught.exception))

    def test_a_non_project_rule_cannot_name_a_project_only_type(self):
        with self.assertRaises(frappe.ValidationError) as caught:
            frappe.get_doc(
                {
                    "doctype": RULE,
                    "keyword": f"zz{frappe.generate_hash(length=6)}",
                    "ledger": "Non Project",
                    "expense_type": "Material Purchases",
                }
            ).insert(ignore_permissions=True)
        self.assertIn("not available for a Non Project expense", str(caught.exception))

    def test_a_type_carrying_both_flags_is_accepted_on_either_side(self):
        for ledger in ("Project", "Non Project"):
            keyword = f"zz{frappe.generate_hash(length=6)}"
            doc = frappe.get_doc(
                {
                    "doctype": RULE,
                    "keyword": keyword,
                    "ledger": ledger,
                    "expense_type": "Petty Cash",
                }
            ).insert(ignore_permissions=True)
            self.addCleanup(frappe.delete_doc, RULE, doc.name, force=True)
            self.assertEqual(doc.expense_type, "Petty Cash")

    def test_one_keyword_may_mean_different_types_on_the_two_ledgers(self):
        """The reason `ledger` is part of the rule rather than a filter over it.

        A courier charge on a project is Material Transportation Charges; off a project it is
        Postage & Courier, because the first type does not exist on that side at all.
        """
        keyword = f"zz{frappe.generate_hash(length=6)}"
        for ledger, expense_type in (
            ("Project", "Material Transportation Charges"),
            ("Non Project", "Postage & Courier"),
        ):
            doc = frappe.get_doc(
                {"doctype": RULE, "keyword": keyword, "ledger": ledger, "expense_type": expense_type}
            ).insert(ignore_permissions=True)
            self.addCleanup(frappe.delete_doc, RULE, doc.name, force=True)

        rules = load_expense_rules()
        self.assertIn((keyword, "Material Transportation Charges"), rules["Project"])
        self.assertIn((keyword, "Postage & Courier"), rules["Non Project"])


class TestProjectAliasRefusesACollision(FrappeTestCase):
    """Two projects claiming one phrase makes `build_project_index` drop it ENTIRELY.

    That is the right call at match time -- it is the same rule a contested keyword follows -- but
    it is silent, and it takes out the alias that was already working as well as the new one. The
    guard catches it where there is somebody to tell.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        projects = frappe.get_all("Projects", fields=["name"], limit=2)
        cls.project_a, cls.project_b = projects[0].name, projects[1].name
        cls.phrase = f"zzalias{frappe.generate_hash(length=6)}"
        cls.planted = frappe.get_doc(
            {"doctype": ALIAS, "keyword": cls.phrase, "project": cls.project_a}
        ).insert(ignore_permissions=True)

    @classmethod
    def tearDownClass(cls):
        frappe.delete_doc(ALIAS, cls.planted.name, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDownClass()

    def test_the_same_phrase_differently_spaced_and_cased_is_refused(self):
        """⚠️ `unique: 1` DOES NOT CATCH THIS. It compares stored text, and "VR Mall" beside
        "vr  MALL" are two different strings that normalise to one phrase."""
        with self.assertRaises(frappe.ValidationError) as caught:
            frappe.get_doc(
                {
                    "doctype": ALIAS,
                    "keyword": f"  {self.phrase.upper()}  ",
                    "project": self.project_b,
                }
            ).insert(ignore_permissions=True)
        self.assertIn("claimed by two projects", str(caught.exception))

    def test_an_alias_made_only_of_punctuation_is_refused(self):
        """It normalises to nothing, and an empty phrase is inside every remark ever typed."""
        with self.assertRaises(frappe.ValidationError) as caught:
            frappe.get_doc(
                {"doctype": ALIAS, "keyword": " --- ", "project": self.project_a}
            ).insert(ignore_permissions=True)
        self.assertIn("at least one letter or number", str(caught.exception))

    def test_a_planted_alias_reaches_the_matcher(self):
        """The whole point of the table: a phrase in Desk changes what an import recognises."""
        index = build_project_index(
            [(self.project_a, "Totally Unrelated Name")], aliases=load_project_aliases()
        )
        self.assertEqual(index.sole_project(f"spend for {self.phrase} today"), self.project_a)


class TestTheLoaders(FrappeTestCase):
    def test_both_ledgers_are_always_present(self):
        """So a caller never has to guard on a ledger having no rules at all."""
        rules = load_expense_rules()
        self.assertEqual(set(rules), {"Project", "Non Project"})

    def test_rules_arrive_longest_keyword_first(self):
        """⚠️ THE ORDER IS THE RULE, NOT PRESENTATION.

        "print" and "printout charges" can both be in the table, and the more specific phrase has
        to be tried first or it can never win. Sorting here rather than at the call site means
        there is one answer to "which rule applies".
        """
        for pairs in load_expense_rules().values():
            lengths = [len(keyword) for keyword, _ in pairs]
            self.assertEqual(lengths, sorted(lengths, reverse=True))

    def test_keywords_arrive_lowercased_because_that_is_how_they_are_matched(self):
        for pairs in load_expense_rules().values():
            for keyword, _ in pairs:
                self.assertEqual(keyword, keyword.lower())

    def test_an_inactive_rule_is_not_loaded(self):
        keyword = f"zz{frappe.generate_hash(length=6)}"
        doc = frappe.get_doc(
            {
                "doctype": RULE,
                "keyword": keyword,
                "ledger": "Project",
                "expense_type": "Petty Cash",
                "active": 0,
            }
        ).insert(ignore_permissions=True)
        self.addCleanup(frappe.delete_doc, RULE, doc.name, force=True)
        self.assertNotIn(keyword, [k for k, _ in load_expense_rules()["Project"]])

    def test_an_inactive_alias_is_not_loaded(self):
        phrase = f"zzalias{frappe.generate_hash(length=6)}"
        project = frappe.get_all("Projects", fields=["name"], limit=1)[0].name
        doc = frappe.get_doc(
            {"doctype": ALIAS, "keyword": phrase, "project": project, "active": 0}
        ).insert(ignore_permissions=True)
        self.addCleanup(frappe.delete_doc, ALIAS, doc.name, force=True)
        self.assertNotIn(phrase, [p for p, _ in load_project_aliases()])
