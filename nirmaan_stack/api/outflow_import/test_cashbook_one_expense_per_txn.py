# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""One Expense per wallet Txn Id, enforced by the database (#1588, spec #1585 gap C).

    DEVENV test --module nirmaan_stack.api.outflow_import.test_cashbook_one_expense_per_txn

Two batches holding the same Txn Id are staged straight from one plan (as two overlapping confirms that
planned at the same moment do), then driven through the job (`cb._cashbook_worker`, inline), the hand Create
(`expenses.create_expense`) and Unreconcile (`unreconcile.unreconcile_row`). The patch is run against the
site database inside the test's own transaction, which a rollback undoes.

⚠️ RUNS AGAINST THE SITE DATABASE AND COMMITS, like `test_cashbook_import`; every batch is purged with the
expenses it made (`test_cashbook_import._purge`).
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import.expenses import (
    AlreadyImportedError,
    create_expense,
)
from nirmaan_stack.api.outflow_import.test_cashbook_import import FIXTURE, _purge
from nirmaan_stack.api.outflow_import.unreconcile import unreconcile_row
from nirmaan_stack.nirmaan_stack.doctype.outflow_row_match.outflow_row_match import (
    IMPORT_CREATED_EXPENSE_INDEX,
)
from nirmaan_stack.patches.v3_0 import outflow_match_one_created_expense_per_transfer as patch_module
from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES
from nirmaan_stack.services.outflow_import.parser import parse_statement
from nirmaan_stack.services.outflow_import.skip_kinds import SKIP_KIND_ALREADY_IMPORTED
from nirmaan_stack.services.outflow_import.status import (
    ROW_ERROR,
    ROW_MISMATCHED,
    ROW_PENDING_MATCH,
    ROW_SETTLED,
    ROW_SKIPPED,
    SKIP_ORIGIN_SYSTEM,
)

ACTOR = "Administrator"
STATEMENT_URL = "/private/files/test-statement.csv"
ROW_FIELDS = [
    "name", "transfer_id", "row_status", "outcome_note", "skip_reason", "skip_kind", "skip_origin",
    "suggested_name", "suggested_doctype", "suggested_expense_type", "resolved_project",
]


def _expenses_for(txn_id) -> list:
    """Every Expense, in either ledger, whose payment reference is this Txn Id."""
    return [
        name
        for doctype in EXPENSE_DOCTYPES
        for (name,) in frappe.db.sql(
            f"""SELECT name FROM "tab{doctype}" WHERE BTRIM(payment_ref) = %s""", (txn_id,)
        )
    ]


def _index_exists() -> bool:
    return bool(
        frappe.db.sql("""SELECT 1 FROM pg_indexes WHERE indexname = %s""", (IMPORT_CREATED_EXPENSE_INDEX,))
    )


class TwoBatchesOneTxnIdCase(FrappeTestCase):
    """Batches A and B, staged from ONE plan: every planned line of A has a twin in B with the same Txn Id."""

    def setUp(self):
        super().setUp()
        parsed = parse_statement(FIXTURE.read_bytes(), source="Cashbook")
        plan = cb._build_plan(parsed)
        self.a, self.b = (
            cb._stage(parsed, plan, file_url=STATEMENT_URL, filename="test-statement.csv", user=ACTOR).name
            for _ in range(2)
        )
        frappe.db.commit()
        self.addCleanup(_purge, self.b)
        self.addCleanup(_purge, self.a)
        self.txn_ids = [line.transfer_id for line in self._lines(self.a, row_status=ROW_PENDING_MATCH)]
        self.assertGreaterEqual(len(self.txn_ids), 3, "the fixture plans fewer than three expenses")
        for txn in self.txn_ids:
            self.assertEqual(_expenses_for(txn), [], "an expense already carries a fixture Txn Id")

    def _lines(self, batch, **filters):
        return frappe.get_all(
            "Outflow Import Row",
            filters={"import_batch": batch, **filters},
            fields=ROW_FIELDS,
            order_by="name asc",
        )

    def _twin(self, batch, txn):
        return next(line for line in self._lines(batch) if line.transfer_id == txn)

    def _run_job(self, batch):
        cb._cashbook_worker(batch, ACTOR)
        frappe.db.commit()


class TestTwoBatchesHoldingOneTxnId(TwoBatchesOneTxnIdCase):
    def test_both_jobs_run_and_each_txn_id_ends_with_exactly_one_expense(self):
        self._run_job(self.a)
        self._run_job(self.b)
        self.assertEqual({txn: len(_expenses_for(txn)) for txn in self.txn_ids}, {txn: 1 for txn in self.txn_ids})

    def test_the_second_line_is_an_already_imported_system_skip_naming_the_first_expense(self):
        self._run_job(self.a)
        self._run_job(self.b)
        for txn in self.txn_ids:
            first, second = self._twin(self.a, txn), self._twin(self.b, txn)
            self.assertEqual(first.row_status, ROW_SETTLED)
            self.assertEqual(second.row_status, ROW_SKIPPED, second.outcome_note)
            self.assertEqual(second.skip_kind, SKIP_KIND_ALREADY_IMPORTED)
            self.assertEqual(second.skip_origin, SKIP_ORIGIN_SYSTEM)
            self.assertIn("Already imported", second.outcome_note)
            self.assertIn(first.suggested_name, second.outcome_note)
            self.assertIn(self.a, second.outcome_note)
            self.assertEqual(second.skip_reason, second.outcome_note)

    def test_no_line_of_the_second_batch_is_marked_error(self):
        self._run_job(self.a)
        self._run_job(self.b)
        self.assertEqual([line.name for line in self._lines(self.b, row_status=ROW_ERROR)], [])
        self.assertEqual([line.name for line in self._lines(self.b, row_status=ROW_PENDING_MATCH)], [])

    def test_the_second_batch_counts_its_refused_lines_as_skipped(self):
        self._run_job(self.a)
        self._run_job(self.b)
        status = cb.get_cashbook_status(self.b)
        self.assertEqual(status["created"], 0)
        self.assertEqual(status["failed"], 0)
        self.assertEqual(status["pending"], 0)


class TestAHandCreateOfATxnIdAnotherLineHolds(TwoBatchesOneTxnIdCase):
    """A reopened line of batch B whose Txn Id batch A's job already created. B's line carries a different
    amount -- an overlapping export whose figure disagrees is staged again -- so the recorded-money guard, which
    matches on the amount too, lets it through. The index is then what refuses."""

    def _reopened_twin_at_another_amount(self, txn):
        line = self._twin(self.b, txn)
        amount = frappe.db.get_value("Outflow Import Row", line.name, "amount")
        frappe.db.set_value(
            "Outflow Import Row",
            line.name,
            {"row_status": ROW_MISMATCHED, "amount": float(amount) + 1},
            update_modified=False,
        )
        frappe.db.commit()
        return line

    def _create_by_hand(self, line):
        return create_expense(
            row=line.name,
            doctype=line.suggested_doctype,
            expense_type=line.suggested_expense_type,
            project=line.resolved_project,
        )

    def test_it_is_refused_with_already_imported_and_the_expense_name_and_no_second_expense(self):
        self._run_job(self.a)
        txn = self.txn_ids[0]
        line = self._reopened_twin_at_another_amount(txn)
        holder = self._twin(self.a, txn).suggested_name

        with self.assertRaises(AlreadyImportedError) as refused:
            self._create_by_hand(line)
        frappe.db.commit()

        self.assertIn("Already imported", str(refused.exception))
        self.assertIn(holder, str(refused.exception))
        self.assertEqual(_expenses_for(txn), [holder])
        self.assertEqual(self._twin(self.b, txn).row_status, ROW_MISMATCHED)


class TestUnreconcileFreesTheTxnId(TwoBatchesOneTxnIdCase):
    def test_after_unreconcile_the_same_txn_id_can_be_created_again(self):
        self._run_job(self.a)
        txn = self.txn_ids[0]
        first = self._twin(self.a, txn)
        unreconcile_row(row=first.name, legs="all", reason="wrong line")
        frappe.db.commit()
        self.assertEqual(_expenses_for(txn), [])

        reopened = self._twin(self.a, txn)
        result = create_expense(
            row=reopened.name,
            doctype=reopened.suggested_doctype,
            expense_type=reopened.suggested_expense_type,
            project=reopened.resolved_project,
        )
        frappe.db.commit()
        self.assertEqual(_expenses_for(txn), [result["settled"]["name"]])
        self.assertEqual(self._twin(self.a, txn).row_status, ROW_SETTLED)


class TestThePatch(FrappeTestCase):
    """The patch, inside this test's transaction: the index is dropped first and a rollback puts it back."""

    def tearDown(self):
        frappe.db.rollback()
        self.assertTrue(_index_exists(), "the index did not come back after the test's rollback")
        super().tearDown()

    def _match_row(self, transfer_id, target_name):
        frappe.db.sql(
            """INSERT INTO "tabOutflow Row Match"
               (name, transfer_id, target_doctype, target_name, match_kind, created_by_import, creation, modified)
               VALUES (%s, %s, 'Non Project Expenses', %s, 'Settled', 1, NOW(), NOW())""",
            (frappe.generate_hash(length=12), transfer_id, target_name),
        )

    def test_it_refuses_a_database_where_a_txn_id_already_holds_two_created_expenses_and_names_it(self):
        frappe.db.sql(f'DROP INDEX "{IMPORT_CREATED_EXPENSE_INDEX}"')
        self._match_row("TXN-1588-DUP", "NPE-1588-A")
        self._match_row("TXN-1588-DUP", "NPE-1588-B")
        self._match_row("TXN-1588-ONE", "NPE-1588-C")

        with self.assertRaises(frappe.ValidationError) as caught:
            patch_module.execute()

        self.assertIn("TXN-1588-DUP", str(caught.exception))
        self.assertNotIn("TXN-1588-ONE", str(caught.exception))
        self.assertFalse(_index_exists())

    def test_a_reversed_duplicate_does_not_block_it(self):
        frappe.db.sql(f'DROP INDEX "{IMPORT_CREATED_EXPENSE_INDEX}"')
        self._match_row("TXN-1588-REV", "NPE-1588-A")
        self._match_row("TXN-1588-REV", "NPE-1588-B")
        frappe.db.sql(
            """UPDATE "tabOutflow Row Match" SET match_kind = 'Reversed'
               WHERE transfer_id = 'TXN-1588-REV' AND target_name = 'NPE-1588-B'"""
        )
        patch_module.execute()
        self.assertTrue(_index_exists())

