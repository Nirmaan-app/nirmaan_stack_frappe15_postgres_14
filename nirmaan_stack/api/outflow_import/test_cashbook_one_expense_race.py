# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Each wallet Txn Id gets at most one expense, with two database connections at once (spec #1585).

    DEVENV test --module nirmaan_stack.api.outflow_import.test_cashbook_one_expense_race

⚠️ EXPECTED TO FAIL ON TODAY'S CODE, AND TO PASS ONCE SPEC #1585 PHASE 1 LANDS. It is the real-code half
of the formal check in `scripts/formal/cashbook_one_expense/` (skill: `.claude/skills/cashbook-one-expense`):
the model proves the design closes the race; this proves the code actually closes it.

HOW THE RACE IS FORCED, WITHOUT SLEEPS. Frappe runs Postgres at REPEATABLE READ: a transaction reads from a
snapshot taken at its first statement. The LATE connection makes one read (its snapshot), waits while the
EARLY connection runs to the end and commits, then runs the same code. That is exactly two requests or jobs
that started together: the late one cannot see what the early one did, except through a lock or a
serialization failure. Today nothing gives it either, so it writes a second expense.

⚠️ RUNS AGAINST THE SITE DATABASE AND COMMITS, like `test_cashbook_import`. Every batch it stages is purged
with the expenses it made (`test_cashbook_import._purge`), and the files the confirms saved are deleted.
"""

import io
import threading
import traceback
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import file_manager
from werkzeug.datastructures import FileStorage, MultiDict

from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import.test_cashbook_import import FIXTURE, _purge
from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES
from nirmaan_stack.services.outflow_import.parser import parse_statement

ACTOR = "Administrator"


def _on_own_connection(site, sites_path, fn, out, snapshot_taken=None, release=None):
    """Run `fn` as one web request or job does: its own connection, a commit at the end.

    With `snapshot_taken`, first make one read -- the transaction's snapshot -- then wait for `release`."""
    frappe.init(site=site, sites_path=sites_path)
    try:
        frappe.connect()
        frappe.flags.in_test = True
        frappe.set_user(ACTOR)
        if snapshot_taken is not None:
            frappe.db.sql("""SELECT 1 FROM "tabOutflow Import Row" LIMIT 1""")
            snapshot_taken.set()
            release.wait(120)
        out["result"] = fn()
        frappe.db.commit()
    except Exception as exc:
        frappe.db.rollback()
        out["error"] = f"{exc!r}\n{traceback.format_exc()}"
    finally:
        frappe.destroy()


def _post_confirm(content: bytes):
    """`confirm_cashbook_import` with `content` as the posted file. Only the transport is faked."""

    class _Request:
        host = None
        files = MultiDict({"file": FileStorage(stream=io.BytesIO(content), filename="cashbook.csv")})

    frappe.local.request = _Request()
    return cb.confirm_cashbook_import()


_real_save_file = file_manager.save_file


def _save_file_and_commit(*args, **kwargs):
    saved = _real_save_file(*args, **kwargs)
    frappe.db.commit()
    return saved


def _expenses_per_txn_id(txn_ids) -> dict:
    """Txn Id -> how many expenses carry it in `payment_ref`, across both expense ledgers."""
    counts: dict = {}
    for doctype in EXPENSE_DOCTYPES:
        for ref, n in frappe.db.sql(
            f"""SELECT BTRIM(payment_ref), COUNT(*) FROM "tab{doctype}"
                WHERE BTRIM(payment_ref) IN %s GROUP BY 1""",
            (tuple(txn_ids),),
        ):
            counts[ref] = counts.get(ref, 0) + n
    return counts


class OneExpensePerTxnIdCase(FrappeTestCase):
    def setUp(self):
        super().setUp()
        lines = FIXTURE.read_text().splitlines()
        # Header, the eleven transfer lines, the totals rows (as `TestRepeatsAreNotSaved` slices it).
        self.header, self.data, self.footer = lines[0], lines[1:12], lines[12:]
        self.txn_ids = sorted({row.transfer_id for row in parse_statement(FIXTURE.read_bytes(), source="Cashbook").rows})
        frappe.db.commit()
        self.assertEqual(_expenses_per_txn_id(self.txn_ids), {}, "an expense already carries a fixture Txn Id")

    def _file(self, data_lines) -> bytes:
        return "\n".join([self.header, *data_lines, *self.footer]).encode()

    def _site(self):
        return frappe.local.site, frappe.local.sites_path

    def _late_and_early(self, late_fn, early_fn):
        """`late_fn` takes its snapshot, `early_fn` then runs to its commit, then `late_fn` runs."""
        snapshot_taken, release = threading.Event(), threading.Event()
        late_out, early_out = {}, {}
        late = threading.Thread(
            target=_on_own_connection, args=(*self._site(), late_fn, late_out, snapshot_taken, release)
        )
        late.start()
        try:
            self.assertTrue(snapshot_taken.wait(60), late_out.get("error"))
            early = threading.Thread(target=_on_own_connection, args=(*self._site(), early_fn, early_out))
            early.start()
            early.join(300)
        finally:
            release.set()
            late.join(300)
        self.assertNotIn("error", early_out, early_out.get("error"))
        return late_out, early_out

    def _run_job(self, batch):
        out = {}
        job = threading.Thread(
            target=_on_own_connection, args=(*self._site(), lambda: cb._cashbook_worker(batch, ACTOR), out)
        )
        job.start()
        job.join(300)
        self.assertNotIn("error", out, out.get("error"))

    def _assert_one_expense_per_txn_id(self):
        frappe.db.commit()  # a fresh snapshot for this connection, after the others committed
        twice = {txn: n for txn, n in _expenses_per_txn_id(self.txn_ids).items() if n > 1}
        self.assertEqual(twice, {}, f"Txn Ids with more than one expense: {twice}")


class TestTwoJobsOnOneBatch(OneExpensePerTxnIdCase):
    def test_two_runs_of_the_job_on_one_batch_create_each_expense_once(self):
        """Two `_cashbook_worker` runs on the same batch (a re-run or a Resume while the first still goes).

        Today: the late run lists every line as Pending from its snapshot, and `_write_one` re-reads a line
        without a lock or a status check, so from its second line on it creates the expense again.
        Phase 1 A: `SELECT ... FOR UPDATE` plus the status re-check writes nothing for a line already Settled."""
        parsed = parse_statement(FIXTURE.read_bytes(), source="Cashbook")
        batch = cb._stage(parsed, cb._build_plan(parsed), file_url="/private/files/test-statement.csv",
                          filename="test-statement.csv", user=ACTOR).name
        frappe.db.commit()
        self.addCleanup(_purge, batch)

        def job():
            return cb._cashbook_worker(batch, ACTOR)

        late_out, _ = self._late_and_early(job, job)
        self.assertNotIn("error", late_out, late_out.get("error"))
        self._assert_one_expense_per_txn_id()


class TestTwoOverlappingConfirms(OneExpensePerTxnIdCase):
    def test_two_overlapping_statements_confirmed_together_create_each_expense_once(self):
        """Two `confirm_cashbook_import` requests at once: the first six lines, and the whole statement.

        Today: the late confirm plans from its snapshot, so `_already_imported` and `_already_booked` miss the
        early confirm's lines and it stages the six shared Txn Ids again; each batch's job creates them.
        Phase 1 C (#1588): confirms are not serialised, so both may stage the shared Txn Ids; the one-Expense-per-
        Txn-Id index on `Outflow Row Match` refuses the second job's create of each, and that line becomes an
        "Already imported" skip."""
        batches = []
        self.addCleanup(self._purge_confirmed, batches)
        # The jobs run below, on their own connections, not on the live queue. And `save_file` commits, as it
        # does in production: `frappe_gcp_attachment.controller.file_upload_to_gcs` (a File `after_insert`)
        # calls `frappe.db.commit()`, so `_stage` runs in a NEW transaction. A dev env turns that upload off,
        # and without the commit the late confirm's `_stage` would trip over the batch naming-series row
        # instead -- a conflict production never has.
        with patch("frappe.enqueue"), patch("frappe.utils.file_manager.save_file", _save_file_and_commit):
            late_out, early_out = self._late_and_early(
                lambda: _post_confirm(self._file(self.data)),
                lambda: _post_confirm(self._file(self.data[:6])),
            )
        for out in (early_out, late_out):
            if "result" in out:
                batches.append(out["result"]["batch"])
        # A refusal is a correct outcome for the late confirm; anything else that raised is not.
        if "error" in late_out:
            self.assertIn("Already imported", late_out["error"], late_out["error"])
        for batch in batches:
            self._run_job(batch)
        self._assert_one_expense_per_txn_id()

    def _purge_confirmed(self, batches):
        frappe.db.rollback()
        for batch in batches:
            for file in frappe.get_all(
                "File", filters={"attached_to_doctype": "Outflow Import Batch", "attached_to_name": batch}, pluck="name"
            ):
                frappe.delete_doc("File", file, ignore_permissions=True, force=True)
            _purge(batch)
