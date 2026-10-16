# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for the Bulk Download job's lifecycle (`bulk_download.run_bulk_download_job`).

Three bugs this pins, each on the side that broke:

  1. AN EMPTY SELECTION NEVER MEANS "EVERYTHING". The "Selected" endpoints refuse an empty list,
     and the job reads an explicit empty list as nothing. Before, `names='[]'` fell through to the
     download-all branch and merged every PO of the scope into a file named "_Selected_".
  2. EVERY DOWNLOAD HAS ITS OWN ID. The id the browser sends comes back on every event, so two
     downloads of one user (a project tab and a vendor tab) no longer take each other's file. It
     travels as `download_id`, never `job_id`, which `frappe.enqueue` keeps for itself.
  3. THE JOB NEVER ENDS SILENTLY, AND IT CAN BE STOPPED. Any failure publishes
     `bulk_download_failed`, so the progress window always closes; the window's Cancel stops the
     job between documents, for that user's download only.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Read-only on live rows: nothing is enqueued
(`frappe.enqueue` is replaced), no file is fetched (`_fetch_attachment_content_by_name` is replaced),
events are captured instead of published, the Error Log rows a failure writes are rolled back,
and every cancel key and temp file a test creates is removed in tearDown.
"""

import io
import os
import unittest
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from pypdf import PdfWriter

from nirmaan_stack.api.pdf_helper import bulk_download as bd


def _tiny_pdf():
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


class TestBulkDownloadJob(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # A vendor with 2+ delivery challans: the job is exercised on DC attachments (by name).
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

    def setUp(self):
        self.enqueued, self.events, self.cancel_keys, self.temp_files = [], [], [], []
        for target, attr, fn in (
            (frappe, "enqueue", lambda method, **kw: self.enqueued.append(kw)),
            # Only this module's events: an Error Log insert publishes Frappe's own doc/list updates.
            (frappe, "publish_realtime", lambda event, data=None, **kw: event.startswith("bulk_download") and self.events.append((event, data))),
        ):
            p = patch.object(target, attr, side_effect=fn)
            p.start()
            self.addCleanup(p.stop)

    def tearDown(self):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        for key in self.cancel_keys:
            frappe.cache.delete_value(key)
        for token in self.temp_files:
            path = bd.get_temp_path(token)
            if os.path.exists(path):
                os.remove(path)

    def _job(self, **kw):
        kw.setdefault("user", "Administrator")
        kw.setdefault("download_id", "test-download-0001")
        bd.run_bulk_download_job(**kw)
        for event, data in self.events:
            if event == "bulk_download_all_ready":
                self.temp_files.append(data["token"])
        return [e for e, _ in self.events]

    def _cancel(self, download_id, user="Administrator"):
        self.cancel_keys.append(bd._cancel_key(user, download_id))
        frappe.cache.set_value(bd._cancel_key(user, download_id), 1, expires_in_sec=60)

    # --- 1. an empty selection -------------------------------------------------------------------

    def test_selected_endpoints_refuse_an_empty_selection(self):
        calls = {
            "PO": lambda n: bd.download_selected_pos(names=n, vendor=self.vendor),
            "WO": lambda n: bd.download_selected_wos(names=n, vendor=self.vendor),
            "DN": lambda n: bd.download_selected_dns(names=n, vendor=self.vendor),
            "attachment": lambda n: bd.download_selected_attachments(attachment_names=n, doc_type="DC", vendor=self.vendor),
        }
        for label, call in calls.items():
            for empty in ("[]", "", "not json", "{}"):
                with self.assertRaises(frappe.ValidationError, msg=f"{label} {empty!r}"):
                    call(empty)
        self.assertEqual(self.enqueued, [])

    def test_an_explicit_empty_list_in_the_job_is_nothing_never_everything(self):
        with patch.object(bd, "_all_doc_names", side_effect=AssertionError("resolved ALL")), \
                patch.object(bd, "_all_attachments", side_effect=AssertionError("resolved ALL")):
            self._job(doc_type="PO", vendor=self.vendor, names="[]")
            self._job(doc_type="DC", vendor=self.vendor, attachment_names="[]")
        messages = [d["message"] for e, d in self.events if e == "bulk_download_failed"]
        self.assertEqual(messages, ["No PO items found.", "No DC items found."])

    def test_leaving_the_list_out_still_means_download_all(self):
        with patch.object(bd, "_all_doc_names", return_value=[]) as resolve:
            self._job(doc_type="PO", vendor=self.vendor)
        resolve.assert_called_once_with("PO", "vendor", self.vendor)

    # --- 2. one id per download --------------------------------------------------------------------

    def test_the_browsers_download_id_comes_back_and_reaches_the_job_as_download_id(self):
        out = bd.download_selected_pos(names='["PO-X"]', vendor=self.vendor, download_id="abc12345-def6")
        self.assertEqual(out["download_id"], "abc12345-def6")
        self.assertEqual(self.enqueued[-1]["download_id"], "abc12345-def6")
        self.assertNotIn("job_id", self.enqueued[-1])

        for bad in (None, "", "short", "has space!", "x" * 65):
            out = bd.download_project_attachments(doc_type="DC", vendor=self.vendor, download_id=bad)
            self.assertRegex(out["download_id"], bd.DOWNLOAD_ID_RE)
            self.assertNotEqual(out["download_id"], bad)
            self.assertEqual(self.enqueued[-1]["download_id"], out["download_id"])

    def _dc_job(self, download_id, **kw):
        return self._job(doc_type="DC", vendor=self.vendor, attachment_names=frappe.as_json(self.attachments), download_id=download_id, **kw)

    def test_every_event_of_a_download_carries_its_id_through_to_the_file(self):
        with patch.object(bd, "_fetch_attachment_content_by_name", return_value=_tiny_pdf()):
            events = self._dc_job("mine-0001")
        # One event per document, one for the merge, then the file.
        self.assertEqual(events, ["bulk_download_progress"] * 3 + ["bulk_download_all_ready"])
        self.assertTrue(all(d["download_id"] == "mine-0001" for _, d in self.events))
        self.assertTrue(os.path.exists(bd.get_temp_path(self.events[-1][1]["token"])))

    def test_progress_counts_finished_documents_and_the_file_says_how_many_made_it(self):
        # The second challan cannot be read: the file still comes, and says one of two is missing.
        with patch.object(bd, "_fetch_attachment_content_by_name", side_effect=[_tiny_pdf(), None]):
            self._dc_job("counts-0001")
        progress = [{k: d.get(k) for k in ("done", "total", "progress", "current", "stage")} for e, d in self.events if e == "bulk_download_progress"]
        self.assertEqual(progress, [
            {"done": 0, "total": 2, "progress": 0, "current": None, "stage": None},  # a challan has no number worth showing
            {"done": 1, "total": 2, "progress": 50, "current": None, "stage": None},
            {"done": 2, "total": 2, "progress": 100, "current": None, "stage": "merging"},
        ])
        ready = self.events[-1]
        self.assertEqual(ready[0], "bulk_download_all_ready")
        self.assertEqual((ready[1]["included"], ready[1]["total"]), (1, 2))

    def test_a_po_download_names_the_po_being_prepared(self):
        # Names no PO has, so no attachment is fetched; only the print is replaced.
        with patch.object(frappe, "get_print", return_value=_tiny_pdf()):
            self._job(doc_type="PO", vendor=self.vendor, names='["TEST-PO-A", "TEST-PO-B"]')
        current = [d["current"] for e, d in self.events if e == "bulk_download_progress" and not d.get("stage")]
        self.assertEqual(current, ["TEST-PO-A", "TEST-PO-B"])

    # --- 3. never silent, and stoppable -------------------------------------------------------------

    def test_any_failure_publishes_bulk_download_failed_and_logs_it(self):
        cases = {
            "unexpected error": dict(doc_type="DC", vendor=self.vendor),
            "both scopes": dict(doc_type="PO", vendor=self.vendor, project="ANY-PROJECT", names='["PO-X"]'),
            "bad json": dict(doc_type="PO", vendor=self.vendor, names="not json"),
        }
        # A site can already hold committed rows from real failures (a restored backup does): they
        # must not count, or the check passes with logging removed.
        committed = set(self._failure_logs())
        for label, kwargs in cases.items():
            frappe.db.rollback()  # each case starts clean, so the new row below is this case's alone
            self.events.clear()
            if label == "unexpected error":
                with patch.object(bd, "_all_attachments", side_effect=RuntimeError("boom")):
                    self._job(**kwargs)
            else:
                self._job(**kwargs)
            self.assertEqual(self.events, [("bulk_download_failed", {"message": "The download failed. Please try again.", "download_id": "test-download-0001"})], label)
            logged = [method for name, method in self._failure_logs().items() if name not in committed]
            self.assertEqual(logged, [f"Bulk download failed: {kwargs['doc_type']}"], label)

    def _failure_logs(self):
        """Error Log name -> title, for the job's failure logs."""
        return dict(frappe.get_all("Error Log", filters={"method": ["like", "Bulk download failed:%"]}, fields=["name", "method"], as_list=True))

    def test_a_cancelled_download_that_has_not_started_does_nothing(self):
        self._cancel("cancel-before-0001")
        with patch.object(bd, "_fetch_attachment_content_by_name", return_value=_tiny_pdf()) as fetch:
            events = self._dc_job("cancel-before-0001")
        self.assertEqual(events, [])
        fetch.assert_not_called()

    def test_cancel_mid_job_stops_before_the_next_document_and_writes_no_file(self):
        def fetch_then_cancel(_name):
            self._cancel("cancel-midway-0001")
            return _tiny_pdf()

        with patch.object(bd, "_fetch_attachment_content_by_name", side_effect=fetch_then_cancel) as fetch, \
                patch.object(bd, "get_temp_path", side_effect=AssertionError("wrote a file")):
            events = self._dc_job("cancel-midway-0001")
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(events, ["bulk_download_progress"])

    def test_cancel_is_per_user_and_per_download(self):
        self._cancel("shared-id-0001", user="someone-else@example.com")
        self._cancel("other-download-0001")
        with patch.object(bd, "_fetch_attachment_content_by_name", return_value=_tiny_pdf()):
            events = self._dc_job("shared-id-0001")
        self.assertEqual(events[-1], "bulk_download_all_ready")

    def test_the_cancel_endpoint_sets_the_callers_flag_and_refuses_bad_ids(self):
        self.cancel_keys.append(bd._cancel_key(frappe.session.user, "endpoint-0001"))
        bd.cancel_bulk_download("endpoint-0001")
        self.assertTrue(bd._is_cancelled(frappe.session.user, "endpoint-0001"))
        self.assertFalse(bd._is_cancelled("someone-else@example.com", "endpoint-0001"))
        for bad in ("", None, "short", "has space!"):
            with self.assertRaises(frappe.ValidationError):
                bd.cancel_bulk_download(bad)
