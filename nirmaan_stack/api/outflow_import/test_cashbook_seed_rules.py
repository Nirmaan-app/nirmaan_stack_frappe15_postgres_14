# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The Cashbook seed (`patches/v3_0/seed_cashbook_import_rules`) is wired, and what it seeds reaches the plan (#1756).

⚠️ RUNS AGAINST THE SITE DATABASE, AND WRITES NOTHING THAT OUTLIVES A TEST. The seed commits; each test here runs
it with `frappe.db.commit` stubbed out and rolls the whole transaction back afterwards, so a site whose tables are
empty stays empty and a site already seeded keeps exactly the rows its people left.
"""

import configparser
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from unittest import mock

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.outflow_import.cashbook import project_index
from nirmaan_stack.patches.v3_0 import seed_cashbook_import_rules as seed
from nirmaan_stack.services.outflow_import.candidates import load_expense_rules
from nirmaan_stack.services.outflow_import.cashbook import plan_statement
from nirmaan_stack.services.outflow_import.parser import RawRow

SEED = "nirmaan_stack.patches.v3_0.seed_cashbook_import_rules"
PATCHES_TXT = Path(frappe.get_app_path("nirmaan_stack", "patches.txt"))
PROJECT_LEDGER = "Project Expenses"
NON_PROJECT_LEDGER = "Non Project Expenses"


def _patch_sections() -> dict[str, list[str]]:
    """`patches.txt` read the way `bench migrate` reads it: an INI file whose keys are the patch lines."""
    parser = configparser.ConfigParser(allow_no_value=True, delimiters="\n")
    parser.optionxform = str
    parser.read_string(PATCHES_TXT.read_text())
    return {section: list(parser[section]) for section in parser.sections()}


def _spend(number, remarks):
    """A Cashbook `Wallet Spend` line with a made-up payee and spender."""
    return RawRow(
        row_number=number,
        transfer_id=f"SEEDTEST{number}{frappe.generate_hash(length=6)}",
        reference_id="",
        added_on=datetime(2026, 8, 1),  # on or after the Cashbook cutoff, or the plan leaves the line out
        amount=Decimal("250"),
        status_raw="SUCCESS",
        beneficiary_name="A Made Up Shop",
        beneficiary_id="",
        bank_account="",
        ifsc="",
        remarks=remarks,
        bank_reference_no="",
        service_charge=Decimal("0"),
        service_tax=Decimal("0"),
        added_by_raw="A Made Up Spender",
        normalized_account="",
        normalized_reference="",
        row_kind="Wallet Spend",
    )


class TestTheSeedIsWired(FrappeTestCase):
    def test_migrate_runs_the_seed_once_after_the_doctypes_exist(self):
        """Its two tables are doctypes, so the seed belongs after model sync, and listed once."""
        sections = _patch_sections()
        self.assertEqual(sections["post_model_sync"].count(SEED), 1)
        self.assertNotIn(SEED, sections["pre_model_sync"])


class _SeededInATransaction(FrappeTestCase):
    def setUp(self):
        super().setUp()
        frappe.db.rollback()
        self.addCleanup(frappe.db.rollback)
        commit = mock.patch.object(frappe.db, "commit")
        commit.start()
        self.addCleanup(commit.stop)
        seed.execute()

    def _plan(self, *remarks):
        rows = [_spend(i, r) for i, r in enumerate(remarks, 1)]
        return plan_statement(rows, project_index(), load_expense_rules()).rows


class TestTheSeedReachesTheCashbookPlan(_SeededInATransaction):
    def test_every_rule_is_in_the_table(self):
        """The owner's 42 rules, each under its own ledger. A row someone already changed counts by its key."""
        held = {
            (r.keyword.lower(), r.ledger)
            for r in frappe.get_all(seed.RULE_DOCTYPE, fields=["keyword", "ledger"])
        }
        self.assertEqual(len(seed.RULES), 42)
        for keyword, ledger, _ in seed.RULES:
            self.assertIn((keyword, ledger), held)

    def test_a_keyword_gives_the_seeded_type_on_each_ledger(self):
        """The same word, two types: decided by whether a project was named."""
        on_project, alone = self._plan(f"Courier charges {seed.ALIASES[0][0]}", "Speed post charges")
        self.assertEqual(on_project.ledger, PROJECT_LEDGER)
        self.assertEqual(on_project.expense_type, "Material Transportation Charges")
        self.assertEqual(alone.ledger, NON_PROJECT_LEDGER)
        self.assertEqual(alone.expense_type, "Postage & Courier")

    def test_each_nickname_places_a_spend_on_its_project(self):
        """The four aliases. One whose project this site lacks is skipped by the seed, so it is skipped here."""
        for phrase, project_name in seed.ALIASES:
            with self.subTest(phrase=phrase):
                project = frappe.db.get_value(
                    "Projects", {"project_name": project_name, "tendering_status": "Won"}, "name"
                )
                if not project:
                    self.skipTest(f"no Won project named {project_name!r} on this site")
                (row,) = self._plan(f"labour charges {phrase} site")
                self.assertEqual(row.project, project)
                self.assertEqual(row.expense_type, "Labour Charges")


class TestARerunLeavesEditsAlone(_SeededInATransaction):
    def test_a_rule_moved_to_another_type_stays_moved(self):
        name = frappe.db.get_value(seed.RULE_DOCTYPE, {"keyword": "water", "ledger": "Non Project"}, "name")
        rule = frappe.get_doc(seed.RULE_DOCTYPE, name)
        rule.expense_type = "Petty Cash"
        rule.save(ignore_permissions=True)

        seed.execute()

        self.assertEqual(frappe.db.get_value(seed.RULE_DOCTYPE, name, "expense_type"), "Petty Cash")
        self.assertEqual(frappe.db.count(seed.RULE_DOCTYPE, {"keyword": "water", "ledger": "Non Project"}), 1)

    def test_a_retired_alias_stays_retired(self):
        phrase = seed.ALIASES[0][0]
        name = frappe.db.get_value(seed.ALIAS_DOCTYPE, {"keyword": phrase}, "name")
        if not name:
            self.skipTest(f"the alias {phrase!r} was not seeded on this site")
        frappe.db.set_value(seed.ALIAS_DOCTYPE, name, "active", 0)  # no doc_events on this doctype

        seed.execute()

        self.assertEqual(frappe.db.get_value(seed.ALIAS_DOCTYPE, name, "active"), 0)
        self.assertEqual(frappe.db.count(seed.ALIAS_DOCTYPE, {"keyword": phrase}), 1)
