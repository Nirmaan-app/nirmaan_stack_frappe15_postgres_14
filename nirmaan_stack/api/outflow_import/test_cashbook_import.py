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
from nirmaan_stack.services.outflow_import.cashbook import (
    ACTION_CREATE,
    SKIP_ALREADY_BOOKED,
    SKIP_ALREADY_IMPORTED,
)
from nirmaan_stack.services.outflow_import.ledgers import (
    NON_PROJECT_EXPENSE_DOCTYPE,
    PROJECT_EXPENSE_DOCTYPE,
)
from nirmaan_stack.services.outflow_import.candidates import find_earlier_batches_for_rows
from nirmaan_stack.services.outflow_import.duplicates import (
    find_prior_sighting,
    row_identity,
)
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

    def test_the_expense_is_dated_the_day_the_money_moved(self):
        """⚠️ THE REGRESSION TEST FOR A DEFECT NO SUITE COULD SEE.

        The first production import created 115 expenses with a BLANK `payment_date`. Every other
        figure was right and nothing raised: `create_expense_from_row` reads `added_on_date`, which
        is DERIVED by the `_StagedRow` adapter and does not exist on a raw `Document`, so
        `getattr(row, "added_on_date", None)` returned None in silence.

        It survived because the fixtures asserted the fields the writer SETS and never the ones it
        DERIVES. This asserts a derived one, against the row's own stored date.
        """
        cb._cashbook_worker(self.batch, "Administrator")
        row = self._row("AAAAAA")
        added_on = frappe.db.get_value("Outflow Import Row", row.name, "added_on")
        target = frappe.db.get_value(
            "Outflow Row Match", {"import_row": row.name},
            ["target_doctype", "target_name"], as_dict=True,
        )
        payment_date = frappe.db.get_value(target.target_doctype, target.target_name, "payment_date")
        self.assertIsNotNone(payment_date, "the expense was created with no payment date")
        self.assertEqual(str(payment_date), str(added_on.date()))

    def test_no_created_expense_is_left_undated(self):
        """The whole-batch form, because the defect was uniform rather than a stray row."""
        cb._cashbook_worker(self.batch, "Administrator")
        undated = []
        for match in frappe.get_all(
            "Outflow Row Match",
            filters={"import_batch": self.batch},
            fields=["target_doctype", "target_name"],
        ):
            if not frappe.db.get_value(match.target_doctype, match.target_name, "payment_date"):
                undated.append(match.target_name)
        self.assertEqual(undated, [])

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


class TestPendingThenSuccessfulReimport(FrappeTestCase):
    """A wallet spend that had not gone through must import when the next statement shows it did.

    ⚠️ THE SAME DEFECT AS THE CASHFREE ONE, THROUGH A SECOND COPY OF THE LOOKUP. Both sources write
    to the ONE `Outflow Import Row` table, and `cashbook._already_imported` asked the same
    id-amount-date question of it without asking whether the stored row recorded anything. A spend
    still in flight at export time staged as skipped, and the completed one was then refused as
    "already imported" -- the money silently gone, permanently, since a skipped row is frozen.

    Staged directly rather than through `CashbookImportCase`, because this needs TWO batches from
    one fixture and that base class stages exactly one in `setUp`.
    """

    def setUp(self):
        super().setUp()
        self.parsed = parse_statement(FIXTURE.read_bytes(), source="Cashbook")

    def _stage(self, parsed):
        batch = cb._stage(
            parsed,
            cb._build_plan(parsed),
            file_url="/private/files/test-statement.csv",
            filename="test-statement.csv",
            user="Administrator",
        ).name
        frappe.db.commit()
        self.addCleanup(_purge, batch)
        return batch

    def _statuses(self, batch):
        return {
            r["row_status"]
            for r in frappe.get_all(
                "Outflow Import Row", filters={"import_batch": batch}, fields=["row_status"]
            )
        }

    def test_an_unsuccessful_row_does_not_block_its_own_later_success(self):
        from dataclasses import replace

        in_flight = replace(
            self.parsed,
            rows=tuple(replace(r, status_raw="PENDING") for r in self.parsed.rows),
        )
        self._stage(in_flight)
        self.assertIn(ROW_PENDING_MATCH, self._statuses(self._stage(self.parsed)))

    def test_a_successful_row_still_blocks_a_re_upload(self):
        # ⚠️ THE GUARD AGAINST THE FIX BEING TOO LOOSE. Without this, a change that simply stopped
        # the lookup finding anything would pass the test above and reimport every wallet spend
        # every time -- creating a second expense for money that left once.
        self._stage(self.parsed)
        self.assertEqual(self._statuses(self._stage(self.parsed)), {ROW_SKIPPED})


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


class TestTheAlreadyBookedGuard(FrappeTestCase):
    """An expense can already exist for a wallet spend WITHOUT this import ever having seen it.

    ⚠️ THIS IS THE HOLE THE `Outflow Row Match` UNIQUE CONSTRAINT CANNOT COVER. That key is
    `(transfer_id, target_doctype, target_name)`, and a Cashbook row CREATES its target -- so
    `target_name` is new every time and the constraint is never contended. Several notes elsewhere
    call it "the real backstop against paying twice"; that is true of Cashfree, which settles an
    EXISTING record, and false here.

    Measured on live data 2026-08-21: 17 `Non Project Expenses` carry a wallet transfer id in
    `payment_ref` that nobody imported -- keyed in by hand. Without this guard a statement covering
    those dates creates 17 duplicate expenses and nothing anywhere says so.

    The expenses below are created by hand, deliberately: an expense made THROUGH the import would
    also be caught by `_already_imported`, which would make every assertion here vacuous.
    """

    def setUp(self):
        super().setUp()
        self.parsed = parse_statement(FIXTURE.read_bytes(), source="Cashbook")

    def _a_row_that_would_be_created(self):
        """A fixture row the planner creates when nothing blocks it.

        Taken from the plan rather than hardcoded, so an edit to the fixture makes this fail
        loudly instead of quietly testing a row that was already being skipped.
        """
        plan = cb._build_plan(self.parsed)
        for planned, raw in zip(plan.rows, self.parsed.rows):
            if planned.action == ACTION_CREATE:
                return raw
        self.fail("the fixture no longer contains a row that would be created")

    def _book(self, doctype, ref, amount, when):
        """A hand-entered expense carrying a wallet reference. Removed again afterwards."""
        doc = frappe.get_doc(
            {
                "doctype": doctype,
                # ⚠️ `Project Expenses.amount` is a Data column of numeric STRINGS and the
                # non-project one is real Currency. Storing both as the doctype actually stores
                # them is the point of the varchar test below.
                "amount": str(amount) if doctype == PROJECT_EXPENSE_DOCTYPE else amount,
                "payment_date": when,
                "payment_ref": ref,
                "description": "hand-entered wallet spend",
                "status": "Paid",
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()
        self.addCleanup(
            lambda: (
                frappe.db.sql(f'DELETE FROM "tab{doctype}" WHERE name = %s', (doc.name,)),
                frappe.db.commit(),
            )
        )
        return doc.name

    def _stage(self, parsed=None):
        parsed = parsed or self.parsed
        batch = cb._stage(
            parsed,
            cb._build_plan(parsed),
            file_url="/private/files/test-statement.csv",
            filename="test-statement.csv",
            user="Administrator",
        ).name
        frappe.db.commit()
        self.addCleanup(_purge, batch)
        return batch

    def _staged(self, batch, transfer_id):
        return frappe.db.get_value(
            "Outflow Import Row",
            {"import_batch": batch, "transfer_id": transfer_id},
            ["row_status", "skip_reason"],
            as_dict=True,
        )

    # --- the guard fires ---------------------------------------------------------------------

    def test_a_hand_booked_non_project_expense_blocks_the_import_and_is_named(self):
        raw = self._a_row_that_would_be_created()
        name = self._book(
            NON_PROJECT_EXPENSE_DOCTYPE, raw.transfer_id, float(raw.amount), raw.added_on_date
        )
        row = self._staged(self._stage(), raw.transfer_id)
        self.assertEqual(row.row_status, ROW_SKIPPED)
        self.assertEqual(
            row.skip_reason,
            SKIP_ALREADY_BOOKED.format(record=f"{NON_PROJECT_EXPENSE_DOCTYPE} {name}"),
        )

    def test_a_hand_booked_project_expense_is_found_despite_its_varchar_amount(self):
        """⚠️ `Project Expenses.amount` is `Data`. A text compare would miss '180.0' against 180,
        which is why the query CASTs. This is the test that would go red if the cast were dropped."""
        raw = self._a_row_that_would_be_created()
        name = self._book(
            PROJECT_EXPENSE_DOCTYPE, raw.transfer_id, float(raw.amount), raw.added_on_date
        )
        row = self._staged(self._stage(), raw.transfer_id)
        self.assertEqual(row.row_status, ROW_SKIPPED)
        self.assertEqual(
            row.skip_reason,
            SKIP_ALREADY_BOOKED.format(record=f"{PROJECT_EXPENSE_DOCTYPE} {name}"),
        )

    def test_a_booked_expense_with_no_payment_date_still_blocks(self):
        """The missing-date fallback, on the ledger side. An absent date is a gap in OUR record,
        not evidence that this is a different transfer."""
        raw = self._a_row_that_would_be_created()
        name = self._book(
            NON_PROJECT_EXPENSE_DOCTYPE, raw.transfer_id, float(raw.amount), None
        )
        row = self._staged(self._stage(), raw.transfer_id)
        self.assertEqual(
            row.skip_reason,
            SKIP_ALREADY_BOOKED.format(record=f"{NON_PROJECT_EXPENSE_DOCTYPE} {name}"),
        )

    def test_no_second_expense_is_created_for_a_row_the_guard_blocked(self):
        """The consequence, asserted directly. A skip reason nobody acts on is cosmetic; a second
        expense is money booked twice."""
        raw = self._a_row_that_would_be_created()
        self._book(
            NON_PROJECT_EXPENSE_DOCTYPE, raw.transfer_id, float(raw.amount), raw.added_on_date
        )
        batch = self._stage()
        cb._cashbook_worker(batch, "Administrator")
        frappe.db.commit()
        self.assertEqual(
            frappe.db.count(NON_PROJECT_EXPENSE_DOCTYPE, {"payment_ref": raw.transfer_id}),
            1,
        )

    # --- the guard does NOT fire (a guard that blocks everything also looks like it works) ----

    def test_an_expense_at_a_different_amount_does_not_block_the_import(self):
        raw = self._a_row_that_would_be_created()
        self._book(
            NON_PROJECT_EXPENSE_DOCTYPE,
            raw.transfer_id,
            float(raw.amount) + 1,
            raw.added_on_date,
        )
        self.assertEqual(
            self._staged(self._stage(), raw.transfer_id).row_status, ROW_PENDING_MATCH
        )

    def test_an_expense_on_a_different_date_does_not_block_the_import(self):
        """The fallback rescues a MISSING date. It does not make a KNOWN, different one agree."""
        from datetime import timedelta

        raw = self._a_row_that_would_be_created()
        self._book(
            NON_PROJECT_EXPENSE_DOCTYPE,
            raw.transfer_id,
            float(raw.amount),
            raw.added_on_date + timedelta(days=1),
        )
        self.assertEqual(
            self._staged(self._stage(), raw.transfer_id).row_status, ROW_PENDING_MATCH
        )

    def test_an_unrelated_reference_does_not_block_anything(self):
        raw = self._a_row_that_would_be_created()
        self._book(
            NON_PROJECT_EXPENSE_DOCTYPE, "OBO-NOT-IN-THIS-FILE", float(raw.amount), raw.added_on_date
        )
        self.assertEqual(
            self._staged(self._stage(), raw.transfer_id).row_status, ROW_PENDING_MATCH
        )

    # --- the corpus narrowing ------------------------------------------------------------------

    def test_a_statement_with_no_transfer_ids_builds_no_query(self):
        """⚠️ `IN ()` is a SYNTAX ERROR in Postgres, not an empty result. Both lookups must
        short-circuit before building the placeholder list."""
        from dataclasses import replace

        blank = replace(
            self.parsed, rows=tuple(replace(r, transfer_id="") for r in self.parsed.rows)
        )
        self.assertEqual(cb._already_booked(blank), {})
        self.assertEqual(cb._already_imported(blank), {})

    def test_the_lookup_reads_only_this_statements_references(self):
        """The narrowing itself. An expense carrying a reference from some other statement must not
        appear in the index at all -- that is what keeps the scan off the whole ledger."""
        raw = self._a_row_that_would_be_created()
        self._book(
            NON_PROJECT_EXPENSE_DOCTYPE, "OBO-SOME-OTHER-FILE", float(raw.amount), raw.added_on_date
        )
        index = cb._already_booked(self.parsed)
        self.assertNotIn(
            "OBO-SOME-OTHER-FILE", {transfer_id for transfer_id, _ in index}
        )


class TestTheEarliestBatchIsNamed(FrappeTestCase):
    """`Already imported in {batch}` must name the batch the transfer CAME FROM.

    `_already_imported` had no `ORDER BY` and took whichever row Postgres handed back first, so the
    message could point a reader at a later batch that merely also holds the transfer. Cosmetic --
    nothing double-creates -- but it sends somebody to the wrong screen.
    """

    def setUp(self):
        super().setUp()
        self.parsed = parse_statement(FIXTURE.read_bytes(), source="Cashbook")

    def _stage(self):
        batch = cb._stage(
            self.parsed,
            cb._build_plan(self.parsed),
            file_url="/private/files/test-statement.csv",
            filename="test-statement.csv",
            user="Administrator",
        ).name
        frappe.db.commit()
        self.addCleanup(_purge, batch)
        return batch

    def test_the_first_batch_is_the_one_named(self):
        first = self._stage()
        self._stage()
        # Filter for THIS reason, not merely "has a reason" -- the fixture also holds rows
        # skipped as not-a-spend, and picking one of those would assert nothing.
        expected = SKIP_ALREADY_IMPORTED.format(batch=first)
        reasons = [
            r.reason
            for r in cb._build_plan(self.parsed).rows
            if r.reason.startswith("Already imported in ")
        ]
        self.assertTrue(reasons, "no row read as already imported, so this asserts nothing")
        self.assertEqual(set(reasons), {expected})


class TestCashbookDoesNotNarrowByPeriod(FrappeTestCase):
    """⚠️ THE ONE DELIBERATE DIFFERENCE BETWEEN THE TWO SOURCES' DUPLICATE LOOKUP, PINNED FROM BOTH
    SIDES so that "making them consistent" cannot pass silently.

    Cashfree narrows its search to batches whose recorded period overlaps the sheet's. That is
    ergonomics, and its whole licence is that a miss cannot cause double payment -- the
    `Outflow Row Match` unique constraint catches it. **That licence does not exist on the Cashbook
    path**: a wallet row CREATES its target, so `target_name` is new every time and the constraint
    can never fire. A miss costs Cashfree a worse message and costs Cashbook a SECOND EXPENSE.

    The setup is a batch whose recorded period has been moved far away from the statement's. The
    transfers are still in it; only the batch's dates disagree.
    """

    def setUp(self):
        super().setUp()
        self.parsed = parse_statement(FIXTURE.read_bytes(), source="Cashbook")
        self.batch = cb._stage(
            self.parsed,
            cb._build_plan(self.parsed),
            file_url="/private/files/test-statement.csv",
            filename="test-statement.csv",
            user="Administrator",
        ).name
        # A period nowhere near the statement's, so any overlap filter excludes this batch.
        frappe.db.set_value(
            "Outflow Import Batch",
            self.batch,
            {"period_from": "2001-01-01", "period_to": "2001-01-31"},
            update_modified=False,
        )
        frappe.db.commit()
        self.addCleanup(_purge, self.batch)

    def test_cashbook_still_finds_the_transfer_in_a_far_dated_batch(self):
        index = cb._already_imported(self.parsed)
        found = [
            row.transfer_id
            for row in self.parsed.rows
            if row.transfer_id
            and find_prior_sighting(index, row.transfer_id, row.amount, row.added_on_date)
        ]
        self.assertTrue(found, "Cashbook narrowed by period and lost a real duplicate")

    def test_cashfree_narrowed_by_period_would_have_missed_it(self):
        """The other half. Without this the test above would also pass if the period filter simply
        never excluded anything -- and then it would be asserting nothing at all."""
        narrowed = find_earlier_batches_for_rows(
            self.parsed.rows,
            period_from=self.parsed.period_from,
            period_to=self.parsed.period_to,
        )
        self.assertEqual(
            narrowed, {}, "the period filter no longer excludes anything, so this pins nothing"
        )

    def test_both_agree_once_the_period_is_not_supplied(self):
        """Same core, same answer -- the argument is the ONLY difference."""
        wide = find_earlier_batches_for_rows(self.parsed.rows)
        index = cb._already_imported(self.parsed)
        for row in self.parsed.rows:
            if not row.transfer_id:
                continue
            self.assertEqual(
                wide.get(row_identity(row.transfer_id, row.amount, row.added_on_date)),
                find_prior_sighting(index, row.transfer_id, row.amount, row.added_on_date),
            )
