# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for the Bulk Download operation (`bulk_download.bulk_download_op`, ADR 0047, #1664).

What this pins:

  1. AN EMPTY SELECTION NEVER MEANS "EVERYTHING". The "Selected" endpoints refuse an empty list,
     and the work reads an explicit empty list as nothing. Before, `names='[]'` fell through to the
     download-all branch and merged every PO of the scope into a file named "_Selected_".
  2. EVERY DOWNLOAD IS ITS OWN BACKGROUND OPERATION. The id the browser makes is the operation's id;
     the screen follows its status record and collects the file by it, and only the user who
     started it can do either. Nothing lands in a folder the web server serves.
  3. THE WORK NEVER ENDS SILENTLY, AND IT CAN BE STOPPED. A refusal fails the operation in its own
     words; anything else fails it with a logged error. The window's Cancel stops the work between
     documents, for its owner's download only.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Read-only on live rows: no file is fetched
(`_fetch_attachment_content_by_name` is replaced). Most tests record what an endpoint starts and run
the work in-process (`run_work`); `TestBulkDownloadOperation` runs one through the real module, with
the queue faked, and removes its finished file.

The two helpers below are shared by the other bulk download suites: they import this module (never
its classes, which the test loader would run there again).
"""

import io
import os
import unittest
import uuid
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils.background_jobs import execute_job
from pypdf import PdfReader, PdfWriter

from nirmaan_stack.api.background_ops import collect_result, get_status
from nirmaan_stack.api.pdf_helper import bulk_download as bd
from nirmaan_stack.services import background_ops

STRANGER = "bulk-download-stranger@example.com"


def _tiny_pdf():
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def new_op_id():
    return str(uuid.uuid4())


def record_starts(test):
    """Replace the module's `start` for this test: each download an endpoint starts is recorded as its work's
    kwargs plus `op_id` and `timeout`, and nothing is queued. Returns the list it records into."""
    started = []

    def start(kind, work, *, op_id, timeout, queue="long", **kwargs):
        started.append({**kwargs, "op_id": op_id, "timeout": timeout})
        return {"op_id": op_id, "state": "queued"}

    p = patch.object(bd.background_ops, "start", side_effect=start)
    p.start()
    test.addCleanup(p.stop)
    return started


class WorkRun:
    """One run of the download's work in-process, as the module's wrapper runs it, minus the record and the
    commit (several suites hold uncommitted fixture rows): the progress it reports, the file it keeps, its
    result, and a refusal's words in `error`."""

    def __init__(self, started=None, **kwargs):
        work_kwargs = {k: v for k, v in {**(started or {}), **kwargs}.items() if k not in ("op_id", "timeout")}
        self.progress, self.file, self.result, self.error = [], None, None, None
        frappe.local.background_op_id = (started or {}).get("op_id") or new_op_id()
        try:
            with (
                patch.object(bd.background_ops, "set_progress", side_effect=self._progress),
                patch.object(bd.background_ops, "write_result_file", side_effect=self._file),
            ):
                self.result = bd.bulk_download_op(**work_kwargs)
        except (frappe.ValidationError, frappe.PermissionError) as e:
            self.error = str(e)
        finally:
            frappe.local.background_op_id = None

    def _progress(self, percent, message=None, detail=None):
        self.progress.append({"percent": percent, "message": message, **(detail or {})})

    def _file(self, content, filename):
        self.file = (content, filename)


def run_work(started=None, **kwargs):
    """Run the work of a recorded start (`record_starts`), or of `kwargs`, in-process: see `WorkRun`."""
    return WorkRun(started, **kwargs)


class _LiveDCs(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # A vendor with 2+ delivery challans: the work is exercised on DC attachments (by name).
        rows = frappe.db.sql(
            """select vendor from "tabPO Delivery Documents"
            where parent_doctype = 'Procurement Orders' and type = 'Delivery Challan' and coalesce(nirmaan_attachment, '') <> ''
            group by vendor having count(*) >= 2 order by count(*) desc limit 1"""
        )
        if not rows:
            # A missing precondition is not a regression: skip, with the reason.
            raise unittest.SkipTest("this site has no vendor with 2+ delivery challans")
        cls.vendor = rows[0][0]
        cls.attachments = frappe.get_all(
            "PO Delivery Documents",
            filters={"vendor": cls.vendor, "parent_doctype": "Procurement Orders", "type": "Delivery Challan", "nirmaan_attachment": ["is", "set"]},
            pluck="nirmaan_attachment", order_by="creation asc", limit=2,
        )


class TestBulkDownloadOperation(_LiveDCs):
    """One download through the real module: started by its endpoint, run by the queued wrapper as a worker
    would, followed and collected by its owner only."""

    def setUp(self):
        frappe.set_user("Administrator")

    def tearDown(self):
        frappe.set_user("Administrator")
        frappe.db.rollback()

    def _start_and_work_off(self, start):
        op_id = new_op_id()
        path = background_ops.result_file_path(op_id)
        self.addCleanup(lambda: os.path.exists(path) and os.remove(path))
        with patch("frappe.utils.background_jobs.get_queue") as get_queue:
            queued = []
            get_queue.return_value.enqueue_call.side_effect = lambda func, **kw: queued.append(kw)
            get_queue.return_value.count = 0
            self.assertEqual(start(op_id)["state"], "queued")
            frappe.db.commit()
        self.assertEqual(len(queued), 1)
        with patch.object(bd, "_fetch_attachment_content_by_name", return_value=_tiny_pdf()):
            frappe.set_user("Guest")  # a worker starts as no particular user
            execute_job(**{**queued[0]["kwargs"], "is_async": False})
        frappe.set_user("Administrator")
        return op_id

    def test_a_download_ends_in_its_owners_file_and_nothing_lands_in_a_served_folder(self):
        temp_dir = frappe.get_site_path("public", "files", "temp_downloads")
        before = set(os.listdir(temp_dir)) if os.path.isdir(temp_dir) else set()

        op_id = self._start_and_work_off(lambda op_id: bd.download_selected_attachments(
            attachment_names=frappe.as_json(self.attachments), doc_type="DC", vendor=self.vendor, op_id=op_id
        ))

        status = get_status(op_id=op_id)
        self.assertEqual(status["state"], "finished", status.get("error"))
        self.assertEqual((status["result"]["included"], status["result"]["total"]), (2, 2))
        frappe.local.response = frappe._dict()
        collect_result(op_id=op_id)
        self.assertEqual(len(PdfReader(io.BytesIO(frappe.local.response.filecontent)).pages), 2)
        vendor_name = frappe.db.get_value("Vendors", self.vendor, "vendor_name") or self.vendor
        self.assertEqual(frappe.local.response.filename, f"{vendor_name}_Selected_DC.pdf")
        after = set(os.listdir(temp_dir)) if os.path.isdir(temp_dir) else set()
        self.assertEqual(after, before, "wrote a file the web server serves")

    def test_a_stranger_can_neither_read_nor_collect_nor_cancel_anothers_download(self):
        op_id = self._start_and_work_off(lambda op_id: bd.download_project_attachments(
            doc_type="DC", vendor=self.vendor, op_id=op_id
        ))

        frappe.set_user(STRANGER)
        with self.assertRaises(frappe.PermissionError):
            get_status(op_id=op_id)
        with self.assertRaises(frappe.PermissionError):
            collect_result(op_id=op_id)
        with self.assertRaises(frappe.PermissionError):
            bd.cancel_bulk_download(op_id=op_id)

    def test_a_download_that_breaks_reads_as_failed_and_is_logged(self):
        title = "Background operation bulk_pdf_download failed"
        before = set(frappe.get_all("Error Log", filters={"method": title}, pluck="name"))
        with patch.object(bd, "_all_attachments", side_effect=RuntimeError("boom")):
            op_id = self._start_and_work_off(lambda op_id: bd.download_project_attachments(
                doc_type="DC", vendor=self.vendor, op_id=op_id
            ))
        new_logs = set(frappe.get_all("Error Log", filters={"method": title}, pluck="name")) - before
        self.addCleanup(lambda: (frappe.db.delete("Error Log", {"name": ["in", list(new_logs)]}), frappe.db.commit()))

        status = get_status(op_id=op_id)
        self.assertEqual(status["state"], "failed")
        self.assertNotIn("boom", status["error"])
        self.assertEqual(len(new_logs), 1)


class TestBulkDownloadJob(_LiveDCs):
    def setUp(self):
        self.started = record_starts(self)
        self.cancel_keys = []

    def tearDown(self):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        for key in self.cancel_keys:
            frappe.cache.delete_value(key)

    def _cancel(self, op_id):
        self.cancel_keys.append(bd._cancel_key(op_id))
        frappe.cache.set_value(bd._cancel_key(op_id), 1, expires_in_sec=60)

    def _dc_run(self, op_id=None):
        return run_work(
            {"op_id": op_id} if op_id else None,
            doc_type="DC", vendor=self.vendor, attachment_names=frappe.as_json(self.attachments),
        )

    # --- 1. an empty selection -------------------------------------------------------------------

    def test_selected_endpoints_refuse_an_empty_selection(self):
        calls = {
            "PO": lambda n: bd.download_selected_pos(names=n, vendor=self.vendor, op_id=new_op_id()),
            "WO": lambda n: bd.download_selected_wos(names=n, vendor=self.vendor, op_id=new_op_id()),
            "DN": lambda n: bd.download_selected_dns(names=n, vendor=self.vendor, op_id=new_op_id()),
            "attachment": lambda n: bd.download_selected_attachments(attachment_names=n, doc_type="DC", vendor=self.vendor, op_id=new_op_id()),
        }
        for label, call in calls.items():
            for empty in ("[]", "", "not json", "{}"):
                with self.assertRaises(frappe.ValidationError, msg=f"{label} {empty!r}"):
                    call(empty)
        self.assertEqual(self.started, [])

    def test_an_explicit_empty_list_in_the_work_is_nothing_never_everything(self):
        with patch.object(bd, "_all_doc_names", side_effect=AssertionError("resolved ALL")), \
                patch.object(bd, "_all_attachments", side_effect=AssertionError("resolved ALL")):
            errors = [
                run_work(doc_type="PO", vendor=self.vendor, names="[]").error,
                run_work(doc_type="DC", vendor=self.vendor, attachment_names="[]").error,
            ]
        self.assertEqual(errors, ["No PO items found.", "No DC items found."])

    def test_leaving_the_list_out_still_means_download_all(self):
        with patch.object(bd, "_all_doc_names", return_value=[]) as resolve:
            run_work(doc_type="PO", vendor=self.vendor)
        resolve.assert_called_once_with("PO", "vendor", self.vendor)

    # --- 2. one operation per download ----------------------------------------------------------------

    def test_the_browsers_op_id_is_the_operations_id(self):
        op_id = new_op_id()
        out = bd.download_selected_pos(names='["PO-X"]', vendor=self.vendor, op_id=op_id)
        self.assertEqual(out["op_id"], op_id)
        self.assertEqual(self.started[-1]["op_id"], op_id)

    def test_progress_counts_finished_documents_and_the_result_says_how_many_made_it(self):
        # The second challan cannot be read: the file still comes, and says one of two is missing.
        with patch.object(bd, "_fetch_attachment_content_by_name", side_effect=[_tiny_pdf(), None]):
            run = self._dc_run()
        progress = [{k: p.get(k) for k in ("done", "total", "percent", "current", "stage")} for p in run.progress]
        self.assertEqual(progress, [
            {"done": 0, "total": 2, "percent": 0, "current": None, "stage": None},  # a challan has no number worth showing
            {"done": 1, "total": 2, "percent": 50, "current": None, "stage": None},
            {"done": 2, "total": 2, "percent": 100, "current": None, "stage": "merging"},
        ])
        self.assertEqual(run.result, {"included": 1, "total": 2})
        self.assertEqual(len(PdfReader(io.BytesIO(run.file[0])).pages), 1)

    def test_a_po_download_names_the_po_being_prepared(self):
        # Names no PO has, so no attachment is fetched; only the print is replaced.
        with patch.object(frappe, "get_print", return_value=_tiny_pdf()):
            run = run_work(doc_type="PO", vendor=self.vendor, names='["TEST-PO-A", "TEST-PO-B"]')
        current = [p["current"] for p in run.progress if not p.get("stage")]
        self.assertEqual(current, ["TEST-PO-A", "TEST-PO-B"])

    # --- 3. never silent, and stoppable -------------------------------------------------------------

    def test_a_refusal_fails_the_operation_in_its_own_words(self):
        run = run_work(doc_type="PO", vendor=self.vendor, project="ANY-PROJECT", names='["PO-X"]')
        self.assertEqual(run.error, "Pass exactly one of project or vendor.")

    def test_a_cancelled_download_that_has_not_started_does_nothing(self):
        op_id = new_op_id()
        self._cancel(op_id)
        with patch.object(bd, "_fetch_attachment_content_by_name", return_value=_tiny_pdf()) as fetch:
            run = self._dc_run(op_id)
        self.assertEqual(run.error, "The download was cancelled.")
        fetch.assert_not_called()

    def test_cancel_mid_job_stops_before_the_next_document_and_keeps_no_file(self):
        op_id = new_op_id()

        def fetch_then_cancel(_name):
            self._cancel(op_id)
            return _tiny_pdf()

        with patch.object(bd, "_fetch_attachment_content_by_name", side_effect=fetch_then_cancel) as fetch:
            run = self._dc_run(op_id)
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual((run.error, run.file), ("The download was cancelled.", None))

    def test_cancel_is_per_download(self):
        self._cancel(new_op_id())
        with patch.object(bd, "_fetch_attachment_content_by_name", return_value=_tiny_pdf()):
            run = self._dc_run(new_op_id())
        self.assertEqual(run.result, {"included": 2, "total": 2})

    def test_the_cancel_endpoint_sets_the_owners_flag_and_refuses_an_unknown_download(self):
        op_id = new_op_id()
        with patch.object(bd.background_ops, "read_own", return_value={"op_id": op_id}):
            self.cancel_keys.append(bd._cancel_key(op_id))
            bd.cancel_bulk_download(op_id=op_id)
        self.assertTrue(bd._is_cancelled(op_id))
        with self.assertRaises(frappe.ValidationError):
            bd.cancel_bulk_download(op_id=new_op_id())
        for bad in ("", None, "short", "has space!"):
            with self.assertRaises(frappe.ValidationError):
                bd.cancel_bulk_download(op_id=bad)
