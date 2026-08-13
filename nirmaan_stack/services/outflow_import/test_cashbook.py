# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Tests for the Cashbook plan -- what a petty-cash statement will create.

The keywords and project names below are the REAL ones, because the whole module is a set of
judgements about how people actually write remarks. A made-up vocabulary would test the arithmetic
and prove nothing about whether a statement can be read.
"""

import unittest
from datetime import date
from decimal import Decimal

from nirmaan_stack.services.outflow_import.cashbook import (
    ACTION_CREATE,
    ACTION_SKIP,
    FALLBACK_EXPENSE_TYPE,
    SKIP_ALREADY_IMPORTED,
    SKIP_NOT_A_SPEND,
    SKIP_NOT_SUCCESSFUL,
    SKIP_NO_AMOUNT,
    SKIP_REPEATED_IN_FILE,
    CashbookPlan,
    group_plan,
    pick_expense_type,
    plan_statement,
)
from nirmaan_stack.services.outflow_import.duplicates import row_identity
from nirmaan_stack.services.outflow_import.parser import RawRow
from nirmaan_stack.services.outflow_import.project_match import build_project_index

PROJECT_LEDGER = "Project Expenses"
NON_PROJECT_LEDGER = "Non Project Expenses"

TELUS, VR_MALL, PAYTM = "P-TELUS", "P-VRMALL", "P-PAYTM"
PROJECTS = [
    (TELUS, "Telus GIFT City"),
    (VR_MALL, "VR Mall Food Court"),
    (PAYTM, "Paytm Bangalore"),
]
ALIASES = [("VR Mall", VR_MALL)]

RULES = {
    "Project": (
        ("locally purchased", "Material Purchases"),
        ("transport", "Material Transportation Charges"),
        ("printout", "Project Printing Charges"),
        ("courier", "Material Transportation Charges"),
        ("unload", "Loading & Unloading Charges"),
        ("print", "Project Printing Charges"),
    ),
    "Non Project": (
        ("business card", "Printing & Stationery"),
        ("blinkit", "Staff Welfare Expenses"),
        ("courier", "Postage & Courier"),
        ("print", "Printing & Stationery"),
        ("cake", "Staff Welfare Expenses"),
        ("food", "Staff Welfare Expenses"),
    ),
}


def _row(number=1, transfer_id="OBO1", amount="100", remarks="", kind="Wallet Spend",
         status="SUCCESS", payee="A Payee", spender="A Spender", added_on=date(2026, 8, 1)):
    """A parsed Cashbook row. Uses the real `RawRow` so the plan is tested against what it will get."""
    from datetime import datetime

    return RawRow(
        row_number=number,
        transfer_id=transfer_id,
        reference_id="",
        added_on=datetime(added_on.year, added_on.month, added_on.day) if added_on else None,
        amount=Decimal(amount),
        status_raw=status,
        beneficiary_name=payee,
        beneficiary_id="",
        bank_account="",
        ifsc="",
        remarks=remarks,
        bank_reference_no="",
        service_charge=Decimal("0"),
        service_tax=Decimal("0"),
        added_by_raw=spender,
        normalized_account="",
        normalized_reference="",
        row_kind=kind,
    )


def _plan(rows, already=None):
    index = build_project_index(PROJECTS, aliases=ALIASES)
    return plan_statement(rows, index, RULES, already_imported=already)


class TestWhatIsNotImported(unittest.TestCase):
    """Four ways a row is skipped. Each carries its own sentence -- none is a silent drop."""

    def test_a_wallet_top_up_is_skipped_as_a_movement_not_a_spend(self):
        row = _plan([_row(kind="VA → Wallet", amount="10000")]).rows[0]
        self.assertEqual(row.action, ACTION_SKIP)
        self.assertEqual(row.reason, SKIP_NOT_A_SPEND)

    def test_a_bank_load_and_a_refund_are_skipped_the_same_way(self):
        plan = _plan([_row(kind="Bank → VA"), _row(number=2, transfer_id="OBO2", kind="Wallet Credit")])
        self.assertEqual([r.reason for r in plan.rows], [SKIP_NOT_A_SPEND, SKIP_NOT_A_SPEND])

    def test_a_spend_that_failed_at_the_wallet_is_skipped(self):
        row = _plan([_row(status="FAILED")]).rows[0]
        self.assertEqual(row.reason, SKIP_NOT_SUCCESSFUL)

    def test_a_spend_with_no_amount_is_skipped_rather_than_reaching_the_writer(self):
        """⚠️ `settle.create_expense_from_row` THROWS on an amount of zero or less.

        Reaching it would fail one row's slot in a batch of a hundred over something visible here,
        where it costs a sentence instead.
        """
        row = _plan([_row(amount="0")]).rows[0]
        self.assertEqual(row.reason, SKIP_NO_AMOUNT)

    def test_a_transfer_seen_in_an_earlier_import_names_that_import(self):
        """Naming the batch is what makes the message actionable rather than merely true."""
        raw = _row(transfer_id="OBO9", amount="250")
        already = {row_identity("OBO9", Decimal("250"), date(2026, 8, 1)): "OFI-26-00007"}
        row = _plan([raw], already=already).rows[0]
        self.assertEqual(row.reason, SKIP_ALREADY_IMPORTED.format(batch="OFI-26-00007"))

    def test_a_transfer_repeated_within_one_file_creates_once(self):
        plan = _plan([_row(transfer_id="OBO5"), _row(number=2, transfer_id="OBO5")])
        self.assertEqual(plan.rows[0].action, ACTION_CREATE)
        self.assertEqual(plan.rows[1].reason, SKIP_REPEATED_IN_FILE)

    def test_two_spends_alike_but_for_their_transfer_id_both_create(self):
        """Measured on a real export: two porter payments minutes apart, same payee and amount."""
        plan = _plan([_row(transfer_id="OBO5"), _row(number=2, transfer_id="OBO6")])
        self.assertEqual([r.action for r in plan.rows], [ACTION_CREATE, ACTION_CREATE])

    def test_the_order_of_the_tests_is_the_message(self):
        """⚠️ A FAILED TOP-UP IS BOTH THINGS, AND ONLY ONE READING HELPS.

        Reporting it as "did not succeed" sends somebody looking for a failed payment that never
        existed -- it was never a payment. Kind is asked first, deliberately.
        """
        row = _plan([_row(kind="VA → Wallet", status="FAILED", amount="0")]).rows[0]
        self.assertEqual(row.reason, SKIP_NOT_A_SPEND)


class TestWhichLedger(unittest.TestCase):
    def test_a_remark_naming_a_project_becomes_a_project_expense(self):
        row = _plan([_row(remarks="Porter charges telus project")]).rows[0]
        self.assertEqual(row.ledger, PROJECT_LEDGER)
        self.assertEqual(row.project, TELUS)
        self.assertEqual(row.project_name, "Telus GIFT City")

    def test_a_remark_naming_none_becomes_a_non_project_expense(self):
        row = _plan([_row(remarks="Blinkit Payment")]).rows[0]
        self.assertEqual(row.ledger, NON_PROJECT_LEDGER)
        self.assertIsNone(row.project)

    def test_an_alias_reaches_a_project_no_rule_could(self):
        row = _plan([_row(remarks="Locally purchased for VR mall")]).rows[0]
        self.assertEqual(row.project, VR_MALL)

    def test_a_blank_remark_still_creates_rather_than_holding_the_row_back(self):
        """⚠️ AN OWNER RULING, and it is the one place this module decides something it cannot know.

        A blank remark is not evidence that a spend was non-project -- it is no evidence at all --
        but the ruling is that every importable row is booked, so there is no third outcome.
        """
        row = _plan([_row(remarks="", amount="6000")]).rows[0]
        self.assertEqual(row.action, ACTION_CREATE)
        self.assertEqual(row.ledger, NON_PROJECT_LEDGER)
        self.assertEqual(row.expense_type, FALLBACK_EXPENSE_TYPE)

    def test_every_created_row_carries_a_ledger_and_a_type(self):
        plan = _plan([_row(remarks=r, number=i, transfer_id=f"OBO{i}")
                      for i, r in enumerate(["", "Blinkit", "telus transport", "nonsense zzz"], 1)])
        for row in plan.creating:
            self.assertTrue(row.ledger)
            self.assertTrue(row.expense_type)


class TestPickingTheExpenseType(unittest.TestCase):
    def test_a_keyword_matches_at_the_start_of_a_longer_word(self):
        """People write "unloading" where the rule says "unload", and "printout" where it says
        "print". A whole-word test would miss most of a real statement."""
        self.assertEqual(pick_expense_type("Unloading charges", RULES["Project"])[0],
                         "Loading & Unloading Charges")
        self.assertEqual(pick_expense_type("Printq business card", RULES["Non Project"])[0],
                         "Printing & Stationery")

    def test_a_keyword_does_not_match_inside_a_word(self):
        """⚠️ THE OTHER HALF, and the reason a bare substring test was rejected. "print" sits
        inside "blueprint" and "footprint"."""
        self.assertEqual(pick_expense_type("blueprint copies", RULES["Non Project"])[0],
                         FALLBACK_EXPENSE_TYPE)

    def test_the_longest_matching_keyword_wins(self):
        expense_type, keyword = pick_expense_type(
            "printout charges for the site", RULES["Project"]
        )
        self.assertEqual(expense_type, "Project Printing Charges")
        self.assertEqual(keyword, "printout")

    def test_two_types_matching_at_the_same_length_take_the_fallback(self):
        """The "exactly one, or nothing" rule this feature applies everywhere else."""
        rules = (("aaaa", "Type One"), ("bbbb", "Type Two"))
        self.assertEqual(pick_expense_type("aaaa and bbbb", rules)[0], FALLBACK_EXPENSE_TYPE)

    def test_two_keywords_of_one_length_agreeing_is_not_a_tie(self):
        """"cake" and "food" both meaning Staff Welfare is agreement, not ambiguity."""
        expense_type, _ = pick_expense_type("cake and food for the team", RULES["Non Project"])
        self.assertEqual(expense_type, "Staff Welfare Expenses")

    def test_nothing_matching_falls_back_and_says_no_rule_chose_it(self):
        expense_type, keyword = pick_expense_type("zzz nothing here", RULES["Project"])
        self.assertEqual(expense_type, FALLBACK_EXPENSE_TYPE)
        self.assertEqual(keyword, "")

    def test_the_keyword_that_chose_the_type_is_reported(self):
        """So a surprising expense type can be traced to the word that caused it."""
        row = _plan([_row(remarks="Locally purchased for telus")]).rows[0]
        self.assertEqual(row.expense_type, "Material Purchases")
        self.assertEqual(row.matched_keyword, "locally purchased")

    def test_the_same_word_means_different_types_on_the_two_ledgers(self):
        """⚠️ THE REASON LEDGER IS DECIDED FIRST. `Material Transportation Charges` does not exist
        for a Non-Project Expense at all, so the type cannot be chosen before the ledger is."""
        plan = _plan([
            _row(remarks="Courier charges telus project"),
            _row(number=2, transfer_id="OBO2", remarks="Courier charges"),
        ])
        self.assertEqual(plan.rows[0].expense_type, "Material Transportation Charges")
        self.assertEqual(plan.rows[1].expense_type, "Postage & Courier")


class TestThePreviewGrouping(unittest.TestCase):
    def setUp(self):
        self.plan = _plan([
            _row(1, "A", "1000", "telus transport"),
            _row(2, "B", "500", "telus printout"),
            _row(3, "C", "9000", "paytm transport"),
            _row(4, "D", "50", "Blinkit Payment"),
            _row(5, "E", "70", "cake"),
            _row(6, "F", "10000", "VA top up", kind="VA → Wallet"),
        ])

    def test_project_rows_group_by_project_and_non_project_rows_by_type(self):
        """⚠️ DIFFERENT AXES ON PURPOSE. A project expense is checked by asking whether that
        project has work this month; a non-project one has no project to check, so the only useful
        question is what kind of spending it is."""
        groups = {(g.ledger, g.label): g for g in group_plan(self.plan)}
        self.assertIn((PROJECT_LEDGER, "Telus GIFT City"), groups)
        self.assertIn((PROJECT_LEDGER, "Paytm Bangalore"), groups)
        self.assertIn((NON_PROJECT_LEDGER, "Staff Welfare Expenses"), groups)

    def test_a_group_carries_its_count_and_its_value(self):
        telus = next(g for g in group_plan(self.plan) if g.label == "Telus GIFT City")
        self.assertEqual(telus.count, 2)
        self.assertEqual(telus.value, Decimal("1500"))

    def test_groups_run_largest_value_first_within_a_ledger(self):
        """⚠️ NOT A PRESENTATION CHOICE. It is what pushes the one-row groups into a block at the
        bottom, which is the shape a wrong project match takes and the only reason a read-only
        preview is worth reading."""
        values = [g.value for g in group_plan(self.plan) if g.ledger == PROJECT_LEDGER]
        self.assertEqual(values, sorted(values, reverse=True))

    def test_a_skipped_row_is_in_no_group(self):
        grouped = sum(g.count for g in group_plan(self.plan))
        self.assertEqual(grouped, len(self.plan.creating))
        self.assertEqual(len(self.plan.skipping), 1)

    def test_the_totals_add_up_to_the_plan(self):
        self.assertEqual(sum(g.value for g in group_plan(self.plan)), self.plan.total_value)


class TestPlanShape(unittest.TestCase):
    def test_an_empty_statement_plans_nothing_rather_than_raising(self):
        plan = _plan([])
        self.assertEqual(plan.rows, ())
        self.assertEqual(plan.total_value, Decimal("0"))
        self.assertEqual(group_plan(plan), ())

    def test_the_value_counts_only_what_will_be_created(self):
        plan = _plan([_row(amount="100"), _row(2, "B", "9999", kind="Bank → VA")])
        self.assertEqual(plan.total_value, Decimal("100"))

    def test_who_spent_it_is_carried_separately_from_who_was_paid(self):
        row = _plan([_row(payee="Hanuman Hardware", spender="Sowmya T P")]).rows[0]
        self.assertEqual(row.beneficiary_name, "Hanuman Hardware")
        self.assertEqual(row.spent_by, "Sowmya T P")


class TestPurity(unittest.TestCase):
    def test_it_imports_no_frappe(self):
        """Same property `matcher.py` and `project_match.py` protect: the whole decision stays
        testable against a real statement with no bench, no site and no fixtures."""
        import inspect

        from nirmaan_stack.services.outflow_import import cashbook

        for line in inspect.getsource(cashbook).splitlines():
            stripped = line.strip()
            if stripped.startswith(("import ", "from ")):
                self.assertNotIn("frappe", stripped)

    def test_it_does_not_reach_the_settlement_matcher(self):
        """⚠️ THIS MODULE MUST NOT BE ABLE TO SETTLE ANYTHING.

        It decides what to CREATE. `matcher`, `disambiguate`, `status` and `claims` decide what
        existing approved record a transfer PAYS, under an amount window this module has no
        equivalent of. The same fence `partial_settle` and `similarity` are held behind.
        """
        import inspect

        from nirmaan_stack.services.outflow_import import cashbook

        source = inspect.getsource(cashbook)
        for forbidden in ("matcher", "disambiguate", "claims", "stacks", "settle"):
            self.assertNotIn(f"import {forbidden}", source)
            self.assertNotIn(f"outflow_import.{forbidden}", source)


if __name__ == "__main__":
    unittest.main()
