# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Resume also finishes the bill copies a stopped job left (spec #1585 "Pressing Resume is always safe", F; stories
19, 21, 38; code review S1 and S2).

The job copies bills after its lines: an open Collect payment's onto its line (#1595), and a late bill onto the
existing Expense still waiting for one (#1593). A job that dies after its last line but before those copies leaves
no `Pending match run` line, so the batch must still say it stopped, Resume must accept it, and the job Resume
queues must do what is left.

Seam 1: the Cashbook import endpoints and the job, run inline as the queue would, with the bill downloader faked.
The job is KILLED with a `BaseException` the job's per-line `except Exception` never catches, as
`test_cashbook_resume` does.

Run: DEVENV test --module nirmaan_stack.api.outflow_import.test_cashbook_resume_bills
"""

from unittest.mock import patch

import frappe

from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import import cashbook_bills as bills
from nirmaan_stack.api.outflow_import.test_cashbook_bills import _fake_bills
from nirmaan_stack.api.outflow_import.test_cashbook_collect_payments import COLLECT_WITH_LINK, CollectPaymentCase
from nirmaan_stack.api.outflow_import.test_cashbook_late_bills import LATE, LateBillsCase


class _WorkerKilled(BaseException):
    """The worker died: not an `Exception`, so no error path of the job sees it."""


def _resume(batch: str) -> list:
    """Press Resume with the queue faked; returns the jobs it queued."""
    jobs = []
    with patch.object(frappe, "enqueue", side_effect=lambda *a, **kw: jobs.append((a, kw))):
        cb.resume_cashbook_import(batch)
    return jobs


class TestAStoppedCollectPaymentCopyIsResumed(CollectPaymentCase):
    def _run_killed_before_the_collect_bills(self):
        with patch.object(bills, "fetch_bill", _fake_bills()), patch.object(
            cb, "store_collect_bills", side_effect=_WorkerKilled
        ), self.assertRaises(_WorkerKilled):
            cb._cashbook_worker(self.batch, "Administrator")
        frappe.db.rollback()

    def test_the_batch_says_it_stopped_though_no_line_is_pending(self):
        self._run_killed_before_the_collect_bills()
        status = cb.get_cashbook_status(self.batch)
        self.assertEqual(status["pending"], 0)
        self.assertTrue(status["stopped"])
        self.assertEqual(status["bills_waiting"], 1)

    def test_resume_copies_the_collect_payments_bill(self):
        self._run_killed_before_the_collect_bills()
        self.assertFalse(self._line(COLLECT_WITH_LINK).stored_bill)

        self.assertEqual(len(_resume(self.batch)), 1)
        self._run()

        self.assertTrue(self._line(COLLECT_WITH_LINK).stored_bill)
        status = cb.get_cashbook_status(self.batch)
        self.assertFalse(status["stopped"])
        self.assertEqual(status["bills_waiting"], 0)


class TestAStoppedLateBillIsResumed(LateBillsCase):
    """The late bill's work is kept on the batch, so neither a crash nor Resume loses it."""

    def _latest_batch(self) -> str:
        return frappe.get_all(
            "Outflow Import Batch", filters={"source": "Cashbook"}, order_by="creation desc", limit=1, pluck="name"
        )[0]

    def _second_upload_killed_before_the_late_bills(self) -> str:
        with patch.object(cb, "attach_late_bills", side_effect=_WorkerKilled), self.assertRaises(_WorkerKilled):
            self._upload(self._second_file())
        frappe.db.rollback()
        batch = self._latest_batch()
        self.batches.append(batch)
        return batch

    def test_the_batch_says_it_stopped_and_resume_attaches_the_late_bill(self):
        waiting = self._first_upload()
        batch = self._second_upload_killed_before_the_late_bills()
        self.assertFalse(self._expense(LATE).invoice_attachment)

        status = cb.get_cashbook_status(batch)
        self.assertTrue(status["stopped"])
        self.assertEqual(status["bills_waiting"], 1)

        self.assertEqual(len(_resume(batch)), 1)
        with patch.object(bills, "fetch_bill", _fake_bills()):
            cb._cashbook_worker(batch, "Administrator")

        after = self._expense(LATE)
        self.assertEqual(after.name, waiting.name)
        self.assertTrue(after.invoice_attachment)
        self.assertFalse(cb.get_cashbook_status(batch)["stopped"])

    def test_a_second_resume_after_the_late_bill_is_attached_is_refused(self):
        self._first_upload()
        batch = self._second_upload_killed_before_the_late_bills()
        _resume(batch)
        with patch.object(bills, "fetch_bill", _fake_bills()):
            cb._cashbook_worker(batch, "Administrator")
        with self.assertRaises(frappe.ValidationError) as refused:
            _resume(batch)
        self.assertIn("waiting", str(refused.exception))

