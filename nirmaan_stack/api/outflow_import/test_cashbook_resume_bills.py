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

Code review R2 (only work the job still owes waits; an expired link is not tried) is pinned here too.

Run: DEVENV test --module nirmaan_stack.api.outflow_import.test_cashbook_resume_bills
"""

from datetime import datetime, timezone
from unittest.mock import patch

from psycopg2.errors import SerializationFailure

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import import cashbook_bills as bills
from nirmaan_stack.api.outflow_import.test_cashbook_bills import PORTRAIT_JPEG, _fake_bills
from nirmaan_stack.api.outflow_import.test_cashbook_collect_payments import COLLECT_WITH_LINK, CollectPaymentCase
from nirmaan_stack.api.outflow_import.test_cashbook_late_bills import LATE, LateBillsCase
from nirmaan_stack.services.outflow_import.bill_download import BillFile, BillRefused


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



class TestOnlyWorkTheJobStillOwesWaits(CollectPaymentCase):
    """Code review R2: a Collect payment's bill waits only while the job still owes the copy. Once the job has dealt
    with the line -- copied it, failed it, or found a person had decided it -- a later Unskip or Unreconcile that
    opens the line again does not stop the batch or send Resume to links that may have expired."""

    def test_a_line_a_person_decided_during_the_copy_and_reopened_later_does_not_stop_the_batch(self):
        def person_skips_it_meanwhile(url):
            line = self._line(COLLECT_WITH_LINK)
            frappe.db.set_value("Outflow Import Row", line.name, "row_status", "Skipped", update_modified=False)
            frappe.db.commit()
            return BillFile(PORTRAIT_JPEG, "jpeg")

        self._run(_fake_bills({(COLLECT_WITH_LINK, "1.jpeg"): person_skips_it_meanwhile}))
        self.assertFalse(self._line(COLLECT_WITH_LINK).stored_bill)
        # Days later, a person opens it again (Unskip).
        frappe.db.set_value(
            "Outflow Import Row", self._line(COLLECT_WITH_LINK).name, "row_status", "Mismatched", update_modified=False
        )
        frappe.db.commit()

        status = cb.get_cashbook_status(self.batch)
        self.assertEqual((status["bills_waiting"], status["stopped"]), (0, False))
        with self.assertRaises(frappe.ValidationError):
            _resume(self.batch)


class TestAnExpiredLinkIsNotTried(FrappeTestCase):
    """Code review R2: a bill link past its expiry is refused with that reason, never requested."""

    LINK = (
        "https://storage.googleapis.com/prod-payments-private/transaction-attachments/OBO1/1.jpeg"
        "?X-Goog-Date=20260101T000000Z&X-Goog-Expires=604800"
    )

    def test_the_refusal_names_the_expiry_and_nothing_is_downloaded(self):
        after_expiry = datetime(2026, 1, 9, tzinfo=timezone.utc)
        with patch.object(bills, "_utc_now", return_value=after_expiry), patch.dict(
            frappe.flags, {"in_test": False}
        ), patch.object(bills, "download_bill", side_effect=AssertionError("an expired link was requested")):
            got = bills.fetch_bill(self.LINK)
        self.assertIsInstance(got, BillRefused)
        self.assertIn("expired on 08-Jan-2026", got.reason)


class TestRecordingABillProblemNeverRaises(FrappeTestCase):
    """Third review: the job's "Never raises" holds when writing a line's `bill_problem` itself fails."""

    def test_a_transient_refusal_leaves_the_copy_owed(self):
        with patch.object(bills, "_write_bill_problem", side_effect=SerializationFailure("concurrent update")):
            self.assertFalse(bills._record_bill_problem("no-such-line", "Bill not copied: x."))

    def test_any_other_failure_is_logged_and_the_line_is_dealt_with(self):
        with patch.object(bills, "_write_bill_problem", side_effect=ValueError("boom")), patch.object(
            bills.frappe, "log_error"
        ) as logged:
            self.assertTrue(bills._record_bill_problem("no-such-line", "Bill not copied: x."))
        logged.assert_called_once()


def _refused_once(real, only=lambda *args: True):
    """`real`, except that its first call `only` picks raises Postgres's serialization refusal (another writer got
    there first)."""
    calls = []

    def once(*args, **kwargs):
        if only(*args):
            calls.append(args)
        if len(calls) == 1 and only(*args):
            raise SerializationFailure("could not serialize access due to concurrent update")
        return real(*args, **kwargs)

    return once


class TestATransientRefusalLeavesTheCopyForResume(CollectPaymentCase):
    """Code review R3: a lock or serialization refusal while attaching is not the bill's fault. The copy stays owed,
    with no `bill_problem`, so the batch says it stopped and Resume tries it again."""

    def test_a_collect_payment_copy_refused_by_a_concurrent_writer_is_retried_by_resume(self):
        with patch.object(bills, "lock_line_if", _refused_once(bills.lock_line_if)):
            self._run()
        line = self._line(COLLECT_WITH_LINK)
        self.assertFalse(line.stored_bill)
        self.assertFalse(line.bill_problem)
        status = cb.get_cashbook_status(self.batch)
        self.assertEqual((status["bills_waiting"], status["stopped"]), (1, True))

        self.assertEqual(len(_resume(self.batch)), 1)
        self._run()
        self.assertTrue(self._line(COLLECT_WITH_LINK).stored_bill)
        self.assertFalse(cb.get_cashbook_status(self.batch)["stopped"])


class TestATransientRefusalLeavesTheLateBillForResume(LateBillsCase):
    def test_a_late_bill_refused_by_a_concurrent_writer_is_retried_by_resume(self):
        waiting = self._first_upload()
        refused = _refused_once(bills._attach_invoice, only=lambda doctype, expense, *rest: expense == waiting.name)
        with patch.object(bills, "_attach_invoice", refused):
            self._upload(self._second_file())
        batch = frappe.get_all(
            "Outflow Import Batch", filters={"source": "Cashbook"}, order_by="creation desc", limit=1, pluck="name"
        )[0]
        self.batches.append(batch)
        self.assertFalse(self._expense(LATE).invoice_attachment)
        status = cb.get_cashbook_status(batch)
        self.assertEqual((status["bills_waiting"], status["stopped"], status["bills_not_copied"]), (1, True, []))

        _resume(batch)
        with patch.object(bills, "fetch_bill", _fake_bills()):
            cb._cashbook_worker(batch, "Administrator")
        self.assertTrue(self._expense(LATE).invoice_attachment)
