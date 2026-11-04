# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A hand Link counts as the spend's one Expense (#1601, spec #1585; extends #1588).

    DEVENV test --module nirmaan_stack.api.outflow_import.test_cashbook_link_holds_txn_id

Two batches holding the same Txn Id are staged from one plan, as in `test_cashbook_one_expense_per_txn`. One
line of batch B is made workable by hand (Mismatched, as Unreconcile or Unskip leaves it) and Linked to an
existing Reconciliation Pending expense the test plants. B's line carries one rupee more than A's twin -- an
overlapping export whose figure disagrees -- so the recorded-money guard, which matches on the amount too, lets
it through; the database's one-Expense-per-Txn-Id index is then what decides.

    * Case 1, Link first and the job later: the job's line becomes the "Already imported" skip naming the
      linked Expense, and no second Expense is created.
    * Case 2, the job first and a Link later: the Link is refused with a sentence naming the job's Expense,
      through both Link endpoints.

⚠️ RUNS AGAINST THE SITE DATABASE AND COMMITS, like `test_cashbook_import`; every batch is purged with the
expenses it made (`test_cashbook_import._purge`), and every planted expense is deleted with its File and
Version rows.
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.outflow_import.expenses import (
    AlreadyImportedError,
    AlreadyLinkedError,
    create_expense,
    settle_row,
)
from nirmaan_stack.api.outflow_import.cashbook_link_fixture import (
    delete_planted_expense,
    open_line_by_hand,
    plant_pending_expense,
    settled_expenses_for,
)
from nirmaan_stack.api.outflow_import.link_lines import link_rows_to_expense
from nirmaan_stack.api.outflow_import.test_cashbook_one_expense_per_txn import TwoBatchesOneTxnIdCase
from nirmaan_stack.api.outflow_import.unreconcile import unreconcile_row
from nirmaan_stack.patches.v3_0 import outflow_match_one_expense_per_cashbook_txn as patch_module
from nirmaan_stack.services.outflow_import.import_created_expense import IMPORT_CREATED_EXPENSE_INDEX
from nirmaan_stack.services.outflow_import.ledgers import NON_PROJECT_EXPENSE_DOCTYPE, RECONCILIATION_PENDING
from nirmaan_stack.services.outflow_import.skip_kinds import SKIP_KIND_ALREADY_IMPORTED
from nirmaan_stack.services.outflow_import.sources import CASHBOOK_SOURCE
from nirmaan_stack.services.outflow_import.status import (
    ROW_MISMATCHED,
    ROW_SETTLED,
    ROW_SKIPPED,
    SKIP_ORIGIN_SYSTEM,
)

ROW_DOCTYPE = "Outflow Import Row"
MATCH_DOCTYPE = "Outflow Row Match"
RAW_DATABASE_WORDS = ("UniqueViolation", "duplicate key", "IntegrityError", IMPORT_CREATED_EXPENSE_INDEX)


class LinkOneTxnIdCase(TwoBatchesOneTxnIdCase):
    def setUp(self):
        super().setUp()
        self.txn = self.txn_ids[0]

    def _plant(self, amount) -> str:
        name = plant_pending_expense(amount)
        self.addCleanup(delete_planted_expense, name)
        return name

    def _open_b_and_plant(self) -> tuple:
        """B's twin of `self.txn`, opened by hand, and an expense that fits it exactly."""
        line = self._twin(self.b, self.txn)
        return line, self._plant(open_line_by_hand(line.name))

    def _link(self, line, expense):
        return link_rows_to_expense(json.dumps([line.name]), NON_PROJECT_EXPENSE_DOCTYPE, expense)

    def _assert_no_raw_database_words(self, message: str):
        for word in RAW_DATABASE_WORDS:
            self.assertNotIn(word, message)


class TestLinkFirstThenTheJob(LinkOneTxnIdCase):
    """Case 1 (#1601): no race needed."""

    def test_the_job_creates_no_second_expense_and_its_line_is_already_imported_naming_the_link(self):
        line, expense = self._open_b_and_plant()
        self._link(line, expense)
        self.assertEqual(self._twin(self.b, self.txn).row_status, ROW_SETTLED)

        self._run_job(self.a)

        self.assertEqual(settled_expenses_for(self.txn), [expense])
        job_line = self._twin(self.a, self.txn)
        self.assertEqual(job_line.row_status, ROW_SKIPPED, job_line.outcome_note)
        self.assertEqual(job_line.skip_kind, SKIP_KIND_ALREADY_IMPORTED)
        self.assertEqual(job_line.skip_origin, SKIP_ORIGIN_SYSTEM)
        self.assertIn("Already imported", job_line.outcome_note)
        self.assertIn(expense, job_line.outcome_note)
        self.assertIn(self.b, job_line.outcome_note)

    def test_the_job_still_creates_every_other_txn_id(self):
        line, expense = self._open_b_and_plant()
        self._link(line, expense)
        self._run_job(self.a)
        for txn in self.txn_ids[1:]:
            with self.subTest(txn=txn):
                self.assertEqual(self._twin(self.a, txn).row_status, ROW_SETTLED)
                self.assertEqual(len(settled_expenses_for(txn)), 1)

    def test_a_hand_create_of_the_linked_txn_id_is_refused_naming_the_linked_expense(self):
        line, expense = self._open_b_and_plant()
        self._link(line, expense)
        other = self._twin(self.a, self.txn)
        open_line_by_hand(other.name, extra_rupees=2)

        with self.assertRaises(AlreadyImportedError) as refused:
            create_expense(
                row=other.name,
                doctype=other.suggested_doctype,
                expense_type=other.suggested_expense_type,
                project=other.resolved_project,
            )
        frappe.db.commit()
        self.assertIn(expense, str(refused.exception))
        self.assertEqual(settled_expenses_for(self.txn), [expense])


class TestTheJobFirstThenALink(LinkOneTxnIdCase):
    """Case 2 (#1601): the job already created the Txn Id's Expense."""

    def setUp(self):
        super().setUp()
        self._run_job(self.a)
        (self.holder,) = settled_expenses_for(self.txn)

    def _assert_refused_and_nothing_linked(self, attempt, line, expense):
        with self.assertRaises(AlreadyImportedError) as refused:
            attempt()
        frappe.db.commit()
        message = str(refused.exception)
        self.assertIn(self.holder, message)
        self.assertIn(self.txn, message)
        self._assert_no_raw_database_words(message)
        self.assertEqual(settled_expenses_for(self.txn), [self.holder])
        self.assertEqual(self._twin(self.b, self.txn).row_status, ROW_MISMATCHED)
        self.assertEqual(
            frappe.db.get_value(NON_PROJECT_EXPENSE_DOCTYPE, expense, "status"), RECONCILIATION_PENDING
        )
        self.assertFalse(frappe.db.exists(MATCH_DOCTYPE, {"import_row": line.name}))

    def test_a_link_of_many_lines_is_refused_naming_the_expense_that_holds_the_txn_id(self):
        line, expense = self._open_b_and_plant()
        self._assert_refused_and_nothing_linked(lambda: self._link(line, expense), line, expense)

    def test_a_one_line_link_from_decide_is_refused_the_same_way(self):
        line, expense = self._open_b_and_plant()
        self._assert_refused_and_nothing_linked(
            lambda: settle_row(line.name, NON_PROJECT_EXPENSE_DOCTYPE, expense), line, expense
        )

    def test_a_link_of_a_line_with_another_txn_id_is_untouched(self):
        """Only the held Txn Id is refused: B's line of a Txn Id nobody holds still links."""
        free = next(
            line for line in self._lines(self.b)
            if line.transfer_id not in self.txn_ids and line.row_status != ROW_SETTLED
        )
        expense = self._plant(open_line_by_hand(free.name))
        self._link(free, expense)
        self.assertEqual(self._twin(self.b, free.transfer_id).row_status, ROW_SETTLED)


class TestALinkToTheSameExpense(LinkOneTxnIdCase):
    """#1606 (follows #1601): a second line of the Txn Id Linked to the Expense that already holds it. #1601's rule
    never refuses it, but the older `ofm_match_settled_target_unique` (one transfer never settles one record twice,
    every source) does, and the person is told so in a sentence naming the Expense and the line that hold it --
    whichever of the two indexes Postgres checks first."""

    def setUp(self):
        super().setUp()
        self.a_line, self.b_line = self._twin(self.a, self.txn), self._twin(self.b, self.txn)
        a_amount = open_line_by_hand(self.a_line.name)
        b_amount = open_line_by_hand(self.b_line.name)
        self.expense = self._plant(a_amount + b_amount)
        self._link(self.a_line, self.expense)

    def _assert_refused_in_words(self, attempt):
        with self.assertRaises(AlreadyLinkedError) as refused:
            attempt()
        frappe.db.commit()

        message = str(refused.exception)
        self._assert_no_raw_database_words(message)
        self.assertNotIn("ofm_match_settled_target_unique", message)
        self.assertIn(self.txn, message)
        self.assertIn(self.expense, message)
        self.assertIn(self.a_line.name, message)
        self.assertIn(self.a, message)
        self.assertEqual(settled_expenses_for(self.txn), [self.expense])
        self.assertEqual(self._twin(self.b, self.txn).row_status, ROW_MISMATCHED)
        self.assertFalse(frappe.db.exists(MATCH_DOCTYPE, {"import_row": self.b_line.name}))

    def test_a_link_of_many_lines_is_refused_naming_the_expense_and_the_line_that_hold_it(self):
        self._assert_refused_in_words(lambda: self._link(self.b_line, self.expense))

    def test_a_one_line_link_from_decide_is_refused_the_same_way(self):
        self._assert_refused_in_words(lambda: settle_row(self.b_line.name, NON_PROJECT_EXPENSE_DOCTYPE, self.expense))


class TestUnreconcileOfTheLinkedLineFreesTheTxnId(LinkOneTxnIdCase):
    def test_after_unreconcile_the_job_creates_the_txn_id(self):
        line, expense = self._open_b_and_plant()
        self._link(line, expense)
        unreconcile_row(row=line.name, legs="all", reason="linked to the wrong expense")
        frappe.db.commit()
        self.assertEqual(settled_expenses_for(self.txn), [])

        self._run_job(self.a)

        (created,) = settled_expenses_for(self.txn)
        self.assertNotEqual(created, expense)
        self.assertEqual(self._twin(self.a, self.txn).row_status, ROW_SETTLED)

    def test_after_unreconcile_a_link_to_another_expense_succeeds(self):
        line, expense = self._open_b_and_plant()
        self._link(line, expense)
        unreconcile_row(row=line.name, legs="all", reason="linked to the wrong expense")
        frappe.db.commit()

        other = self._twin(self.a, self.txn)
        second = self._plant(open_line_by_hand(other.name, extra_rupees=2))
        self._link(other, second)
        self.assertEqual(settled_expenses_for(self.txn), [second])


class TestAMatchRowCarriesItsLinesSource(LinkOneTxnIdCase):
    def test_a_link_and_a_create_both_write_the_cashbook_source(self):
        line, expense = self._open_b_and_plant()
        self._link(line, expense)
        self._run_job(self.a)
        sources = frappe.get_all(
            MATCH_DOCTYPE, filters={"import_batch": ["in", [self.a, self.b]]}, pluck="source"
        )
        self.assertTrue(sources)
        self.assertEqual(set(sources), {CASHBOOK_SOURCE})


def _index_exists() -> bool:
    return bool(
        frappe.db.sql("""SELECT 1 FROM pg_indexes WHERE indexname = %s""", (IMPORT_CREATED_EXPENSE_INDEX,))
    )


def _index_definition() -> str:
    return frappe.db.sql(
        """SELECT indexdef FROM pg_indexes WHERE indexname = %s""", (IMPORT_CREATED_EXPENSE_INDEX,)
    )[0][0]


class TestThePatch(FrappeTestCase):
    """The widening patch, inside this test's transaction: a rollback undoes it, index included."""

    def tearDown(self):
        frappe.db.rollback()
        self.assertTrue(_index_exists(), "the index did not come back after the test's rollback")
        super().tearDown()

    def _match_row(self, transfer_id, target_name, created_by_import, source=CASHBOOK_SOURCE, row_source=None):
        """A raw match row with a real import row (no batch: the patch reads the row's own source)."""
        row = frappe.generate_hash(length=12)
        frappe.db.sql(
            """INSERT INTO "tabOutflow Import Row" (name, transfer_id, source, creation, modified)
               VALUES (%s, %s, %s, NOW(), NOW())""",
            (row, transfer_id, row_source if row_source is not None else source),
        )
        frappe.db.sql(
            """INSERT INTO "tabOutflow Row Match"
               (name, import_row, transfer_id, target_doctype, target_name, match_kind, created_by_import,
                source, creation, modified)
               VALUES (%s, %s, %s, 'Non Project Expenses', %s, 'Settled', %s, %s, NOW(), NOW())""",
            (frappe.generate_hash(length=12), row, transfer_id, target_name, created_by_import, source),
        )

    def test_it_refuses_a_txn_id_held_by_a_created_and_a_linked_expense_and_names_it(self):
        frappe.db.sql(f'DROP INDEX "{IMPORT_CREATED_EXPENSE_INDEX}"')
        self._match_row("TXN-1601-DUP", "NPE-1601-A", created_by_import=1)
        self._match_row("TXN-1601-DUP", "NPE-1601-B", created_by_import=0)
        self._match_row("TXN-1601-ONE", "NPE-1601-C", created_by_import=0)

        with self.assertRaises(frappe.ValidationError) as caught:
            patch_module.execute()

        self.assertIn("TXN-1601-DUP", str(caught.exception))
        self.assertNotIn("TXN-1601-ONE", str(caught.exception))
        self.assertFalse(_index_exists())

    def test_it_backfills_a_blank_source_from_the_line_before_it_checks(self):
        """A match row written before the field existed has a blank source; the patch reads the line's."""
        frappe.db.sql(f'DROP INDEX "{IMPORT_CREATED_EXPENSE_INDEX}"')
        self._match_row("TXN-1601-OLD", "NPE-1601-D", created_by_import=1, source="", row_source=CASHBOOK_SOURCE)
        self._match_row("TXN-1601-OLD", "NPE-1601-E", created_by_import=0, source="", row_source=CASHBOOK_SOURCE)

        with self.assertRaises(frappe.ValidationError) as caught:
            patch_module.execute()
        self.assertIn("TXN-1601-OLD", str(caught.exception))

    def test_two_links_of_another_source_on_one_transfer_do_not_block_it(self):
        """The rule stays Cashbook's: a bank transfer may still be Linked to several existing expenses."""
        frappe.db.sql(f'DROP INDEX "{IMPORT_CREATED_EXPENSE_INDEX}"')
        self._match_row("UTR-1601-FAN", "NPE-1601-F", created_by_import=0, source="ICICI Bank Statement")
        self._match_row("UTR-1601-FAN", "NPE-1601-G", created_by_import=0, source="ICICI Bank Statement")

        patch_module.execute()

        self.assertTrue(_index_exists())
        self.assertIn("Cashbook", _index_definition())

    def test_it_builds_the_widened_index_on_a_clean_database(self):
        patch_module.execute()
        self.assertIn("created_by_import", _index_definition())
        self.assertIn("Cashbook", _index_definition())
