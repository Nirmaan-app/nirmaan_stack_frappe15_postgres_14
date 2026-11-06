# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Cashbook job locks each line and re-checks it before writing (#1586, spec #1585 gap A).

    DEVENV test --module nirmaan_stack.api.outflow_import.test_cashbook_line_lock

The job runs inline (`cb._cashbook_worker`) on the `cashbook_sample.csv` fixture. "Another path" -- a second
run, a person, a Resume -- is played by a SECOND DATABASE CONNECTION on a thread that commits, because only a
real second transaction shows what the job's row lock and snapshot see.

THE GAP IS OPENED AT `cb._write_one`, the job's per-line write: the patch lets the other connection act on the
line after the job listed it as pending and before the job writes it. That is the window two runs share.

⚠️ RUNS AGAINST THE SITE DATABASE AND COMMITS, like `test_cashbook_import`; every batch is purged with the
expenses it made (`test_cashbook_import._purge`).
"""

import threading
import traceback
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import.test_cashbook_import import FIXTURE, _purge
from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES
from nirmaan_stack.services.outflow_import.parser import parse_statement
from nirmaan_stack.services.outflow_import.status import (
    ROW_ERROR,
    ROW_PENDING_MATCH,
    ROW_SETTLED,
    ROW_SKIPPED,
)

ACTOR = "Administrator"
STATEMENT_URL = "/private/files/test-statement.csv"
_real_write_one = cb._write_one


def _on_another_connection(fn):
    """Run `fn` on its own connection, as another request or job does, and commit. Returns what it returned."""
    site, sites_path = frappe.local.site, frappe.local.sites_path
    out = {}

    def run():
        frappe.init(site=site, sites_path=sites_path)
        try:
            frappe.connect()
            frappe.flags.in_test = True
            frappe.set_user(ACTOR)
            out["result"] = fn()
            frappe.db.commit()
        except Exception as exc:
            frappe.db.rollback()
            out["error"] = f"{exc!r}\n{traceback.format_exc()}"
        finally:
            frappe.destroy()

    thread = threading.Thread(target=run)
    thread.start()
    thread.join(300)
    if "error" in out:
        raise AssertionError(f"the other connection failed:\n{out['error']}")
    return out.get("result")


def _line(name):
    return frappe.db.get_value(
        "Outflow Import Row", name, ["row_status", "outcome_note", "suggested_name", "transfer_id"], as_dict=True
    )


class CashbookLineLockCase(FrappeTestCase):
    def setUp(self):
        super().setUp()
        self.parsed = parse_statement(FIXTURE.read_bytes(), source="Cashbook")
        self.plan = cb._build_plan(self.parsed)
        self.batch = cb._stage(
            self.parsed, self.plan, file_url=STATEMENT_URL, filename="test-statement.csv", user=ACTOR
        ).name
        frappe.db.commit()
        self.addCleanup(_purge, self.batch)
        self.pending = frappe.get_all(
            "Outflow Import Row",
            filters={"import_batch": self.batch, "row_status": ROW_PENDING_MATCH},
            order_by="name asc",
            pluck="name",
        )
        self.assertGreaterEqual(len(self.pending), 3, "the fixture plans fewer than three expenses")
        self.txn_ids = [_line(name).transfer_id for name in self.pending]

    def _run_job_with(self, before_write):
        """Run the job inline; `before_write(row)` runs before the job writes each line."""

        def write_one(row_name, *args, **kwargs):
            before_write(row_name)
            return _real_write_one(row_name, *args, **kwargs)

        with patch.object(cb, "_write_one", write_one):
            cb._cashbook_worker(self.batch, ACTOR)
        frappe.db.commit()  # a fresh snapshot, after the other connection's commits

    def _expenses_for(self, txn_id) -> int:
        return sum(
            frappe.db.sql(
                f"""SELECT COUNT(*) FROM "tab{doctype}" WHERE BTRIM(payment_ref) = %s""", (txn_id,)
            )[0][0]
            for doctype in EXPENSE_DOCTYPES
        )

    def _settle_elsewhere(self, row):
        """Another run writes this line to the end and commits: one Expense, the line Settled."""
        _on_another_connection(lambda: _real_write_one(row, self.batch, ACTOR, STATEMENT_URL))
        frappe.db.commit()
        return _line(row)


class TestALineSettledElsewhereIsNotWrittenAgain(CashbookLineLockCase):
    def test_a_line_another_run_settled_before_the_write_ends_with_one_expense_and_stays_settled(self):
        """Gap A, reproduced: today the job re-reads the line without a lock or a status check and creates a
        second Expense. The second pending line is used so the job's lock read starts a fresh transaction (the
        first line's commit ended the listing's), so this exercises the status re-check."""
        target = self.pending[1]
        settled = {}

        def before_write(row):
            if row == target and not settled:
                settled.update(self._settle_elsewhere(row))

        self._run_job_with(before_write)

        self.assertEqual(settled["row_status"], ROW_SETTLED)
        self.assertEqual(self._expenses_for(settled["transfer_id"]), 1)
        after = _line(target)
        self.assertEqual(after.row_status, ROW_SETTLED)
        self.assertEqual(after.outcome_note, settled["outcome_note"])
        self.assertEqual(after.suggested_name, settled["suggested_name"])

    def test_every_other_line_is_still_created_once(self):
        target = self.pending[1]
        done = []

        def before_write(row):
            if row == target and not done:
                done.append(self._settle_elsewhere(row))

        self._run_job_with(before_write)
        self.assertEqual({txn: self._expenses_for(txn) for txn in self.txn_ids}, {txn: 1 for txn in self.txn_ids})

    def test_the_batch_rollup_counts_what_the_rows_say(self):
        target = self.pending[1]
        done = []

        def before_write(row):
            if row == target and not done:
                done.append(self._settle_elsewhere(row))

        self._run_job_with(before_write)
        batch = frappe.db.get_value(
            cb.BATCH_DOCTYPE, self.batch, ["settled_rows", "error_rows", "reviewed_rows", "status"], as_dict=True
        )
        self.assertEqual(batch.settled_rows, len(self.pending))
        self.assertEqual(batch.error_rows, 0)
        self.assertEqual(batch.reviewed_rows, len(self.parsed.rows))
        # #1594: the sample's wallet credit stays open for a person, so the batch is not Completed.
        self.assertEqual(batch.status, "Partially Settled")


class TestALineNoLongerPendingIsLeftUntouched(CashbookLineLockCase):
    def test_a_line_skipped_or_errored_before_the_job_reached_it_gets_no_expense(self):
        skipped, errored = self.pending[1], self.pending[2]
        changes = {
            skipped: {"row_status": ROW_SKIPPED, "skip_reason": "Skipped by hand.", "outcome_note": "Skipped."},
            errored: {"row_status": ROW_ERROR, "outcome_note": "Failed elsewhere."},
        }
        seen = set()

        def before_write(row):
            if row in changes and row not in seen:
                seen.add(row)
                _on_another_connection(
                    lambda: frappe.db.set_value("Outflow Import Row", row, changes[row], update_modified=False)
                )

        self._run_job_with(before_write)

        for row, values in changes.items():
            after = _line(row)
            self.assertEqual(after.row_status, values["row_status"], row)
            self.assertEqual(after.outcome_note, values["outcome_note"], row)
            self.assertFalse(after.suggested_name, row)
            self.assertEqual(self._expenses_for(after.transfer_id), 0, row)
            self.assertFalse(frappe.db.exists("Outflow Row Match", {"import_row": row}), row)


class TestAFailedWriteNeverOverwritesAnotherWriter(CashbookLineLockCase):
    def test_a_failing_line_another_transaction_settled_meanwhile_stays_settled(self):
        """The write raises and is rolled back; before the job marks the line, another transaction Settles it.

        The other transaction is slipped in at `frappe.log_error`, which the job calls after its rollback and
        before it marks the line: the one point where the line is unlocked and the job has not yet written."""
        target = self.pending[1]
        frappe.db.set_value(
            "Outflow Import Row", target, "suggested_expense_type", "No Such Type", update_modified=False
        )
        frappe.db.commit()
        settled_note = "Settled elsewhere."
        done = []

        def log_error(*args, **kwargs):
            if not done and "Cashbook import" in str(kwargs.get("title")):
                done.append(True)
                _on_another_connection(
                    lambda: frappe.db.set_value(
                        "Outflow Import Row",
                        target,
                        {"row_status": ROW_SETTLED, "outcome_note": settled_note},
                        update_modified=False,
                    )
                )

        with patch("frappe.log_error", side_effect=log_error):
            cb._cashbook_worker(self.batch, ACTOR)
        frappe.db.commit()

        self.assertTrue(done, "the write did not fail")
        after = _line(target)
        self.assertEqual(after.row_status, ROW_SETTLED)
        self.assertEqual(after.outcome_note, settled_note)

    def test_a_failing_line_still_pending_becomes_error(self):
        target = self.pending[1]
        frappe.db.set_value(
            "Outflow Import Row", target, "suggested_expense_type", "No Such Type", update_modified=False
        )
        frappe.db.commit()
        cb._cashbook_worker(self.batch, ACTOR)
        frappe.db.commit()
        self.assertEqual(_line(target).row_status, ROW_ERROR)
        self.assertEqual(frappe.db.get_value(cb.BATCH_DOCTYPE, self.batch, "error_rows"), 1)


class TestASerializationFailureMeansAnotherRunTookIt(CashbookLineLockCase):
    def test_the_line_is_not_marked_error_and_the_run_continues(self):
        """The job's snapshot predates the other run's commit, so its `FOR UPDATE` read of the line raises a
        serialization failure (REPEATABLE READ). That is "another run took it": no Error, next line.

        ⚠️ THE ISOLATION LEVEL IS SET HERE BY HAND, because only a connection's FIRST transaction runs at
        REPEATABLE READ: psycopg2 opens that one with its own `BEGIN ISOLATION LEVEL ...`, but every one
        after a `frappe.db.commit()` is Frappe's plain `START TRANSACTION`, at the server default (READ
        COMMITTED, measured). This test's connection has committed many times; a job's line can still meet
        REPEATABLE READ (its first transaction), and that is the case pinned here. At READ COMMITTED the lock
        read waits and re-reads the line instead -- the status re-check, pinned by the tests above."""
        target = self.pending[1]
        settled = {}

        def before_write(row):
            if row == target and not settled:
                # The job's transaction takes its snapshot now, before the other run commits.
                frappe.db.sql("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
                frappe.db.sql("""SELECT 1 FROM "tabOutflow Import Batch" LIMIT 1""")
                settled.update(
                    _on_another_connection(
                        lambda: (_real_write_one(row, self.batch, ACTOR, STATEMENT_URL), _line(row))[1]
                    )
                )

        with patch("frappe.log_error") as log_error:
            self._run_job_with(before_write)

        after = _line(target)
        self.assertEqual(after.row_status, ROW_SETTLED)
        self.assertEqual(after.outcome_note, settled["outcome_note"])
        # Only the job's own error path counts: an expense insert logs unrelated attach errors in a dev env.
        job_errors = [c for c in log_error.call_args_list if "Cashbook import" in str(c.kwargs.get("title"))]
        self.assertEqual(job_errors, [])
        self.assertEqual({txn: self._expenses_for(txn) for txn in self.txn_ids}, {txn: 1 for txn in self.txn_ids})
        self.assertEqual(frappe.db.get_value(cb.BATCH_DOCTYPE, self.batch, "error_rows"), 0)
