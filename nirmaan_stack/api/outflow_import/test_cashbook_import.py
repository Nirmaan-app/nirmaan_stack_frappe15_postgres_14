# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Cashbook import's write path -- staging, the background job, and status.

    bench --site localhost run-tests --app nirmaan_stack \
        --module nirmaan_stack.api.outflow_import.test_cashbook_import

⚠️ THIS SUITE CREATES REAL EXPENSES, so every test tears down everything it made -- the expenses
first, then the match records, then the rows and the batch. A leak here is not a slow test, it is
money appearing in somebody's ledger.

It stages from the committed `cashbook_sample.csv` fixture rather than a real statement, and
asserts behaviour on rows it planted rather than on counts, so an edit to the seeded rules cannot
turn a passing test red.
"""

from pathlib import Path

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.services.outflow_import.parser import parse_statement
from nirmaan_stack.services.outflow_import.status import (
    ROW_ERROR,
    ROW_PENDING_MATCH,
    ROW_SETTLED,
    ROW_SKIPPED,
)

FIXTURE = (
    Path(frappe.get_app_path("nirmaan_stack"))
    / "services"
    / "outflow_import"
    / "tests"
    / "fixtures"
    / "cashbook_sample.csv"
)


def _purge(batch: str) -> None:
    """Expenses first, then the link records, then the import's own rows."""
    for target in frappe.db.sql(
        """SELECT target_doctype, target_name FROM "tabOutflow Row Match" WHERE import_batch = %s""",
        (batch,),
        as_dict=True,
    ):
        frappe.db.sql(
            f"""DELETE FROM "tab{target.target_doctype}" WHERE name = %s""", (target.target_name,)
        )
    frappe.db.sql("""DELETE FROM "tabOutflow Row Match" WHERE import_batch = %s""", (batch,))
    frappe.db.sql("""DELETE FROM "tabOutflow Import Row" WHERE import_batch = %s""", (batch,))
    frappe.db.sql("""DELETE FROM "tabOutflow Import Batch" WHERE name = %s""", (batch,))
    frappe.db.commit()


class CashbookImportCase(FrappeTestCase):
    """Stages the fixture once per test and removes everything it created afterwards."""

    def setUp(self):
        super().setUp()
        self.parsed = parse_statement(FIXTURE.read_bytes(), source="Cashbook")
        self.plan = cb._build_plan(self.parsed)
        self.batch = cb._stage(
            self.parsed,
            self.plan,
            file_url="/private/files/test-statement.csv",
            filename="test-statement.csv",
            user="Administrator",
        ).name
        frappe.db.commit()
        self.addCleanup(_purge, self.batch)

    def _rows(self, **filters):
        return frappe.get_all(
            "Outflow Import Row",
            filters={"import_batch": self.batch, **filters},
            fields=["name", "transfer_id", "row_status", "suggested_doctype",
                    "suggested_expense_type", "resolved_project", "source", "skip_reason"],
        )

    def _row(self, suffix):
        return next(r for r in self._rows() if r.transfer_id.endswith(suffix))


class TestStaging(CashbookImportCase):
    def test_every_parsed_row_is_staged_including_the_ones_not_imported(self):
        """A skip has to be VISIBLE. A top-up dropped at staging is an absence nobody can explain."""
        self.assertEqual(len(self._rows()), len(self.parsed.rows))
        self.assertTrue(self._rows(row_status=ROW_SKIPPED))

    def test_the_source_is_stamped_on_the_row(self):
        """Denormalised from the batch so the master table can filter without a join."""
        self.assertTrue(all(row.source == "Cashbook" for row in self._rows()))

    def test_a_skipped_row_carries_the_reason_and_no_plan(self):
        top_up = self._row("900001-0")
        self.assertEqual(top_up.row_status, ROW_SKIPPED)
        self.assertIn("balances", top_up.skip_reason)
        self.assertIsNone(top_up.suggested_doctype)

    def test_a_row_to_be_created_carries_its_whole_plan(self):
        """⚠️ THE PLAN IS STORED, NOT RECOMPUTED BY THE JOB.

        Re-planning in the worker would be a second computation of the decision a person just
        approved, free to disagree with it -- somebody editing an alias in the seconds between is
        all it would take.
        """
        row = self._row("AAAAAA")
        self.assertEqual(row.row_status, ROW_PENDING_MATCH)
        self.assertIn(row.suggested_doctype, ("Project Expenses", "Non Project Expenses"))
        self.assertTrue(row.suggested_expense_type)

    def test_a_non_project_row_carries_no_project(self):
        for row in self._rows(suggested_doctype="Non Project Expenses"):
            self.assertIsNone(row.resolved_project)


class TestTheWorker(CashbookImportCase):
    def test_it_creates_one_expense_per_planned_row(self):
        cb._cashbook_worker(self.batch, "Administrator")
        status = cb.get_cashbook_status(self.batch)
        self.assertEqual(status["created"], len(self.plan.creating))
        self.assertEqual(status["failed"], 0)
        self.assertEqual(status["pending"], 0)
        self.assertFalse(status["running"])

    def test_the_expense_takes_the_statement_values(self):
        cb._cashbook_worker(self.batch, "Administrator")
        row = self._row("AAAAAA")
        target = frappe.db.get_value(
            "Outflow Row Match",
            {"import_batch": self.batch, "import_row": row.name},
            ["target_doctype", "target_name", "match_basis"],
            as_dict=True,
        )
        self.assertEqual(target.match_basis, "cashbook remark")
        expense = frappe.db.get_value(
            target.target_doctype, target.target_name,
            ["status", "payment_ref", "payment_attachment"], as_dict=True,
        )
        self.assertEqual(expense.status, "Paid")
        self.assertEqual(expense.payment_ref, row.transfer_id)
        self.assertEqual(expense.payment_attachment, "/private/files/test-statement.csv")

    def test_who_spent_it_comes_from_the_statement_not_the_importer(self):
        """⚠️ The fixture's spender is "Asha Menon"; the importer is Administrator.

        Writing the importer's name across 115 rows would claim one accountant made every purchase
        on the sheet.
        """
        cb._cashbook_worker(self.batch, "Administrator")
        row = self._row("AAAAAA")
        target = frappe.db.get_value(
            "Outflow Row Match", {"import_row": row.name}, ["target_doctype", "target_name"],
            as_dict=True,
        )
        if target.target_doctype == "Project Expenses":
            payment_by = frappe.db.get_value(target.target_doctype, target.target_name, "payment_by")
            self.assertEqual(payment_by, "Asha Menon")

    def test_no_second_file_row_is_created_for_the_statement(self):
        """⚠️ OWNER RULING Q23, and the consequence was measured and accepted.

        The URL is pasted; no `File` row is minted against the expense. Frappe authorises a private
        file through the document it is attached to, so the attachment opens for the 3 roles that
        can read the import batch and returns 403 for the other 16 that can read an expense.
        Re-enabling `_link_statement_file_to_target` here is the one-line reversal.
        """
        cb._cashbook_worker(self.batch, "Administrator")
        targets = frappe.get_all(
            "Outflow Row Match", filters={"import_batch": self.batch}, fields=["target_name"]
        )
        linked = frappe.get_all(
            "File",
            filters={"attached_to_name": ("in", [t.target_name for t in targets] or [""])},
            fields=["name"],
        )
        self.assertEqual(linked, [])

    def test_running_it_twice_creates_nothing_more(self):
        """⚠️ WHAT MAKES A CRASHED RUN SAFE TO RETRY. The worker only picks up rows still pending,
        and `Outflow Row Match`'s unique key refuses a second settlement even if it did not."""
        cb._cashbook_worker(self.batch, "Administrator")
        first = frappe.db.count("Outflow Row Match", {"import_batch": self.batch})
        cb._cashbook_worker(self.batch, "Administrator")
        self.assertEqual(frappe.db.count("Outflow Row Match", {"import_batch": self.batch}), first)

    def test_one_bad_row_does_not_strand_the_others(self):
        """⚠️ THE REVIEWER APPROVED THE WHOLE BATCH. Halting on the first failure would leave them
        with no way to tell which rows went through."""
        broken = self._rows(row_status=ROW_PENDING_MATCH)[0]
        frappe.db.set_value(
            "Outflow Import Row", broken.name, "suggested_expense_type", "No Such Type",
            update_modified=False,
        )
        frappe.db.commit()

        cb._cashbook_worker(self.batch, "Administrator")
        status = cb.get_cashbook_status(self.batch)
        self.assertEqual(status["failed"], 1)
        self.assertEqual(status["created"], len(self.plan.creating) - 1)
        self.assertEqual(
            frappe.db.get_value("Outflow Import Row", broken.name, "row_status"), ROW_ERROR
        )

    def test_a_failed_row_can_be_retried_after_its_plan_is_corrected(self):
        broken = self._rows(row_status=ROW_PENDING_MATCH)[0]
        frappe.db.set_value(
            "Outflow Import Row", broken.name, "suggested_expense_type", "No Such Type",
            update_modified=False,
        )
        frappe.db.commit()
        cb._cashbook_worker(self.batch, "Administrator")

        frappe.db.set_value(
            "Outflow Import Row", broken.name,
            {"suggested_expense_type": "Petty Cash", "row_status": ROW_PENDING_MATCH},
            update_modified=False,
        )
        frappe.db.commit()
        cb._cashbook_worker(self.batch, "Administrator")

        self.assertEqual(
            frappe.db.get_value("Outflow Import Row", broken.name, "row_status"), ROW_SETTLED
        )
        self.assertEqual(cb.get_cashbook_status(self.batch)["failed"], 0)

    def test_the_batch_status_follows_its_rows(self):
        self.assertEqual(frappe.db.get_value(cb.BATCH_DOCTYPE, self.batch, "status"), "Draft")
        cb._cashbook_worker(self.batch, "Administrator")
        self.assertEqual(
            frappe.db.get_value(cb.BATCH_DOCTYPE, self.batch, "status"), "Completed"
        )


class TestStatus(CashbookImportCase):
    def test_it_reports_running_until_no_row_is_pending(self):
        """Counted from the rows, which are the durable record -- no Redis marker to disagree."""
        self.assertTrue(cb.get_cashbook_status(self.batch)["running"])
        cb._cashbook_worker(self.batch, "Administrator")
        self.assertFalse(cb.get_cashbook_status(self.batch)["running"])

    def test_the_counts_account_for_every_staged_row(self):
        cb._cashbook_worker(self.batch, "Administrator")
        status = cb.get_cashbook_status(self.batch)
        total = status["created"] + status["failed"] + status["skipped"] + status["pending"]
        self.assertEqual(total, len(self.parsed.rows))


class TestItNeverSettlesAnExistingRecord(FrappeTestCase):
    """⚠️ A wallet statement carries no UTR and no bank account, so the tier ladder can find
    nothing -- except a real approved payment that happens to share an amount. Running it here
    would risk settling a vendor payment against somebody's lunch.

    ⚠️ READ THROUGH THE AST, NOT THE TEXT. The first version of this test scanned raw source and
    failed on the module's own docstring, which names `match_batch` in the sentence explaining why
    it is never called. A prose scan cannot tell a prohibition from a violation -- and the version
    that passes such a scan is the one where nobody wrote the warning down.
    """

    FORBIDDEN = frozenset({"match_batch", "match_row", "match_period", "pick_from_several",
                           "resolve_claims", "resolve_vendors", "settle_row"})

    def _tree(self):
        import ast
        import inspect

        return ast.parse(inspect.getsource(cb))

    def test_it_imports_none_of_the_settlement_machinery(self):
        import ast

        imported = set()
        for node in ast.walk(self._tree()):
            if isinstance(node, ast.ImportFrom):
                imported.update(alias.name for alias in node.names)
                imported.add((node.module or "").rsplit(".", 1)[-1])
            elif isinstance(node, ast.Import):
                imported.update(alias.name.rsplit(".", 1)[-1] for alias in node.names)
        self.assertEqual(
            sorted(imported & self.FORBIDDEN), [], "the Cashbook path imported a settlement entry point"
        )
        for module in ("matcher", "disambiguate", "claims", "stacks"):
            self.assertNotIn(module, imported)

    def test_it_calls_none_of_them_either(self):
        import ast

        called = set()
        for node in ast.walk(self._tree()):
            if isinstance(node, ast.Call):
                func = node.func
                name = getattr(func, "id", None) or getattr(func, "attr", None)
                if name:
                    called.add(name)
        self.assertEqual(
            sorted(called & self.FORBIDDEN), [], "the Cashbook path called a settlement entry point"
        )
