# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Resume a Cashbook import that stopped part-way (#1589, spec #1585 gap F).

    DEVENV test --module nirmaan_stack.api.outflow_import.test_cashbook_resume

Each test stages the `cashbook_sample.csv` fixture (`test_cashbook_import.CashbookImportCase`), runs the job
DIRECTLY as the queue would, and KILLS it part-way: the third line's write raises `_WorkerKilled`, a
`BaseException` the job's per-line `except Exception` does not catch -- what a worker killed mid-run looks like
to the rows. Resume is pressed through its endpoint with the queue faked, to record the job; the job is then
run directly again. Card Create's resume tests (`test_card_create.TestAnInterruptedCreateResumes`) are the
prior art.

⚠️ RUNS AGAINST THE SITE DATABASE AND COMMITS; every batch is purged with the expenses it made.
"""

from unittest.mock import patch

import frappe

from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import.test_cashbook_import import CashbookImportCase
from nirmaan_stack.api.outflow_import.test_skip_row import (
    ACCOUNTANT,
    ACCOUNTANT_LEAD,
    OUTSIDER,
    _Users,
)
from nirmaan_stack.services.outflow_import.status import ROW_PENDING_MATCH, ROW_SETTLED

_real_write_one = cb._write_one


class _WorkerKilled(BaseException):
    """The worker died: not an `Exception`, so the job's per-line error path never sees it."""


class CashbookResumeCase(CashbookImportCase):
    def setUp(self):
        super().setUp()
        self.users = _Users()
        self.addCleanup(self.users.purge)
        self.to_create = len(self._rows(row_status=ROW_PENDING_MATCH))

    def _run_killed_after(self, lines_written: int):
        calls = []

        def _dies(*args, **kwargs):
            calls.append(1)
            if len(calls) > lines_written:
                raise _WorkerKilled
            return _real_write_one(*args, **kwargs)

        with patch.object(cb, "_write_one", side_effect=_dies), self.assertRaises(_WorkerKilled):
            cb._cashbook_worker(self.batch, "Administrator")
        # The dead worker's connection is gone, and its open transaction with it.
        frappe.db.rollback()

    def _resume(self, user: str = "Administrator"):
        jobs = []
        frappe.set_user(user)
        try:
            with patch.object(frappe, "enqueue", side_effect=lambda *a, **kw: jobs.append((a, kw))):
                result = cb.resume_cashbook_import(self.batch)
        finally:
            frappe.set_user("Administrator")
        return result, jobs

    def _run(self):
        cb._cashbook_worker(self.batch, "Administrator")

    def _expenses_per_line(self) -> dict:
        """Each line's Expenses, by the match records the job writes (one per created Expense)."""
        out = {}
        for match in frappe.get_all(
            "Outflow Row Match",
            filters={"import_batch": self.batch},
            fields=["import_row", "target_name"],
        ):
            out.setdefault(match.import_row, []).append(match.target_name)
        return out


class TestAStoppedImportShowsWhatIsWaiting(CashbookResumeCase):
    def test_a_killed_job_leaves_the_rest_pending_and_reports_stopped(self):
        self._run_killed_after(2)
        status = cb.get_cashbook_status(self.batch)
        self.assertEqual(status["created"], 2)
        self.assertEqual(status["pending"], self.to_create - 2)
        self.assertFalse(status["running"])
        self.assertTrue(status["stopped"])

    def test_while_the_job_is_queued_or_running_it_reports_progress_not_stopped(self):
        self._run_killed_after(2)
        with patch.object(cb, "is_job_enqueued", return_value=True):
            status = cb.get_cashbook_status(self.batch)
        self.assertTrue(status["running"])
        self.assertFalse(status["stopped"])

    def test_a_finished_import_is_neither_running_nor_stopped(self):
        self._run()
        status = cb.get_cashbook_status(self.batch)
        self.assertEqual(status["pending"], 0)
        self.assertFalse(status["running"])
        self.assertFalse(status["stopped"])


class TestResume(CashbookResumeCase):
    def test_it_requeues_the_job_under_the_same_job_id(self):
        self._run_killed_after(2)
        result, jobs = self._resume()
        self.assertEqual(len(jobs), 1)
        args, kwargs = jobs[0]
        self.assertEqual(args, ("nirmaan_stack.api.outflow_import.cashbook._cashbook_worker",))
        self.assertEqual(kwargs["job_id"], f"cashbook-import-{self.batch}")
        self.assertTrue(kwargs["deduplicate"])
        self.assertEqual(kwargs["batch"], self.batch)
        self.assertEqual(result["batch"], self.batch)

    def test_it_creates_exactly_the_waiting_lines_and_no_line_gets_a_second_expense(self):
        self._run_killed_after(2)
        created_before = {
            line: names for line, names in self._expenses_per_line().items()
        }
        self.assertEqual(len(created_before), 2)

        self._resume()
        self._run()

        after = self._expenses_per_line()
        self.assertEqual(len(after), self.to_create)
        self.assertTrue(all(len(names) == 1 for names in after.values()), after)
        for line, names in created_before.items():
            self.assertEqual(after[line], names)
        self.assertEqual(self._rows(row_status=ROW_PENDING_MATCH), [])
        self.assertEqual(len(self._rows(row_status=ROW_SETTLED)), self.to_create)

    def test_a_second_resume_after_a_finished_run_creates_nothing(self):
        self._run_killed_after(2)
        self._resume()
        self._run()
        before = self._expenses_per_line()

        with self.assertRaises(frappe.ValidationError) as refused:
            self._resume()
        self.assertIn("waiting", str(refused.exception))
        self._run()
        self.assertEqual(self._expenses_per_line(), before)

    def test_it_is_refused_with_a_sentence_while_the_job_is_queued_or_running(self):
        self._run_killed_after(2)
        with patch.object(cb, "is_job_enqueued", return_value=True):
            with self.assertRaises(frappe.ValidationError) as refused:
                self._resume()
        self.assertIn("still", str(refused.exception))

    def test_an_accountant_and_an_accountant_lead_may_press_it(self):
        self._run_killed_after(2)
        for profile in (ACCOUNTANT, ACCOUNTANT_LEAD):
            _, jobs = self._resume(self.users.make(profile))
            self.assertEqual(len(jobs), 1, profile)

    def test_a_user_outside_bulk_import_is_refused(self):
        self._run_killed_after(2)
        with self.assertRaises(frappe.PermissionError):
            self._resume(self.users.make(OUTSIDER))

    def test_a_batch_of_another_source_is_refused(self):
        frappe.db.set_value(cb.BATCH_DOCTYPE, self.batch, "source", "Cashfree", update_modified=False)
        frappe.db.commit()
        with self.assertRaises(frappe.ValidationError):
            self._resume()
