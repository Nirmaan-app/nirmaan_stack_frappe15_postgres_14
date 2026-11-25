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
from nirmaan_stack.services.outflow_import.project_match import build_project_index

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


MADE_UP_PROJECT = ("SEEDTEST-PROJ-1", "Zarvonite Glasshouse")


def _seeded_rules():
    """The seed's rules this site can hold: one naming an expense type the site lacks is skipped by the seed."""
    return [rule for rule in seed.RULES if frappe.db.exists("Expense Type", rule[2])]


class TestTheSeedIsWired(FrappeTestCase):
    def test_migrate_runs_the_seed_once_after_the_doctypes_exist(self):
        """Its two tables are doctypes, so the seed belongs after model sync, and listed once."""
        sections = _patch_sections()
        self.assertTrue(SEED in sections["post_model_sync"], "the seed is not under [post_model_sync]")
        self.assertFalse(SEED in sections["pre_model_sync"], "the seed runs before its doctypes exist")
        # configparser would refuse a repeated line before any count of it; count the raw lines instead.
        self.assertEqual([line.strip() for line in PATCHES_TXT.read_text().splitlines()].count(SEED), 1)


class _SeededInATransaction(FrappeTestCase):
    def setUp(self):
        super().setUp()
        frappe.db.rollback()
        self.addCleanup(frappe.db.rollback)
        commit = mock.patch.object(frappe.db, "commit")
        commit.start()
        self.addCleanup(commit.stop)
        seed.execute()

    def _plan(self, *remarks, index=None):
        rows = [_spend(i, r) for i, r in enumerate(remarks, 1)]
        return plan_statement(rows, index or project_index(), load_expense_rules()).rows


class TestTheSeedReachesTheCashbookPlan(_SeededInATransaction):
    def test_every_rule_is_in_the_table(self):
        """The owner's 42 rules, each under its own ledger. A row someone already changed counts by its key."""
        self.assertEqual(len(seed.RULES), 42)
        keys_held = {
            (row.keyword.lower(), row.ledger)
            for row in frappe.get_all(seed.RULE_DOCTYPE, fields=["keyword", "ledger"])
        }
        for keyword, ledger, _ in _seeded_rules():
            self.assertIn((keyword, ledger), keys_held)

    def test_a_keyword_gives_the_seeded_type_on_each_ledger(self):
        """The same word, two types: decided by whether a project was named. The project is made up and in memory."""
        if not {"Material Transportation Charges", "Postage & Courier"} <= {r[2] for r in _seeded_rules()}:
            self.skipTest("this site lacks an expense type the courier rules name")
        index = build_project_index([MADE_UP_PROJECT])
        on_project, no_project = self._plan(
            f"Courier charges {MADE_UP_PROJECT[1]}", "Speed post charges", index=index
        )
        self.assertEqual(on_project.ledger, PROJECT_LEDGER)
        self.assertEqual(on_project.project, MADE_UP_PROJECT[0])
        self.assertEqual(on_project.expense_type, "Material Transportation Charges")
        self.assertEqual(no_project.ledger, NON_PROJECT_LEDGER)
        self.assertEqual(no_project.expense_type, "Postage & Courier")

    def test_each_nickname_places_a_spend_on_its_project(self):
        """The four aliases, each on the project the seed found by name. One whose project the site lacks is skipped
        by the seed, so it is skipped here; one found but not Won is never placed, and fails here."""
        for phrase, project_name in seed.ALIASES:
            with self.subTest(phrase=phrase):
                project = frappe.db.get_value("Projects", {"project_name": project_name}, "name")
                if not project:
                    self.skipTest(f"no project named {project_name!r} on this site")
                (row,) = self._plan(f"labour charges {phrase} site")
                self.assertEqual(row.project, project)
                self.assertEqual(row.expense_type, "Labour Charges")


class TestARerunLeavesEditsAlone(_SeededInATransaction):
    def test_a_rule_moved_to_another_type_stays_moved(self):
        non_project = [rule for rule in _seeded_rules() if rule[1] == "Non Project"]
        if len({rule[2] for rule in non_project}) < 2:
            self.skipTest("this site holds too few non-project types to move a rule between")
        keyword, ledger, old_type = non_project[0]
        new_type = next(rule[2] for rule in non_project if rule[2] != old_type)
        name = frappe.db.get_value(seed.RULE_DOCTYPE, {"keyword": keyword, "ledger": ledger}, "name")
        rule = frappe.get_doc(seed.RULE_DOCTYPE, name)
        rule.expense_type = new_type
        rule.save(ignore_permissions=True)

        seed.execute()

        self.assertEqual(frappe.db.get_value(seed.RULE_DOCTYPE, name, "expense_type"), new_type)
        self.assertEqual(frappe.db.count(seed.RULE_DOCTYPE, {"keyword": keyword, "ledger": ledger}), 1)

    def test_a_retired_alias_stays_retired(self):
        phrase = seed.ALIASES[0][0]
        name = frappe.db.get_value(seed.ALIAS_DOCTYPE, {"keyword": phrase}, "name")
        if not name:
            self.skipTest(f"the alias {phrase!r} was not seeded on this site")
        frappe.db.set_value(seed.ALIAS_DOCTYPE, name, "active", 0)  # no doc_events on this doctype

        seed.execute()

        self.assertEqual(frappe.db.get_value(seed.ALIAS_DOCTYPE, name, "active"), 0)
        self.assertEqual(frappe.db.count(seed.ALIAS_DOCTYPE, {"keyword": phrase}), 1)
