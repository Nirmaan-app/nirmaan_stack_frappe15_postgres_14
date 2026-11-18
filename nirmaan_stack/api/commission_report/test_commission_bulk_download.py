# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Commission bulk download as a background operation (#1664, ADR 0047): started through the module, followed by
its status record, and finished to a file only the user who started it can collect.

The queue is faked (`get_queue` hands back a recorder) and the test runs the queued wrapper itself, as a worker
would. `get_pdf` is stubbed to one blank page per report, so no print engine is needed; the print formats' HTML is
still rendered. The tracker is made-up, committed (the operation is queued only once the start commits) and
deleted again in `tearDown`.
"""

import io
import os
import unittest
import uuid
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import today
from frappe.utils.background_jobs import execute_job
from pypdf import PdfReader, PdfWriter

from nirmaan_stack.api.background_ops import collect_result, get_status
from nirmaan_stack.api.commission_report import bulk_download_reports as cbd
from nirmaan_stack.services import background_ops

STRANGER = "commission-bulk-stranger@example.com"


def _blank_pdf(*_args, **_kwargs):
	writer = PdfWriter()
	writer.add_blank_page(width=595, height=842)
	buf = io.BytesIO()
	writer.write(buf)
	return buf.getvalue()


class TestCommissionBulkDownload(FrappeTestCase):
	def setUp(self):
		for pf in (cbd.PF_PORTRAIT, cbd.PF_LANDSCAPE):
			if not frappe.db.exists("Print Format", pf):
				raise unittest.SkipTest(f"Print Format {pf} missing on this site")
		frappe.set_user("Administrator")
		doc = frappe.new_doc(cbd.PARENT_DOCTYPE)
		doc.project_name = f"TEST_COMM_BULK {frappe.generate_hash(length=6)}"
		doc.status = "Assign Pending"
		doc.start_date = "2026-01-01"
		for status in ("Submitted", "Submitted", "Pending"):
			doc.append(
				"commission_report_task",
				{
					"commission_category": "TEST_CATEGORY",
					"task_name": f"Task {status}",
					"task_status": status,
					"deadline": "2026-06-01",
					"task_phase": "Handover",
					"report_type": "Field",
				},
			)
		doc.insert(ignore_permissions=True)
		frappe.db.commit()
		self.tracker = doc.name
		self.project_name = doc.project_name
		self.submitted = [r.name for r in doc.commission_report_task if r.task_status == "Submitted"]
		self.pending = [r.name for r in doc.commission_report_task if r.task_status == "Pending"]

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.rollback()
		frappe.delete_doc(cbd.PARENT_DOCTYPE, self.tracker, force=True, ignore_permissions=True)
		frappe.db.commit()

	def _start_and_work_off(self, rows, on_render=None):
		op_id = str(uuid.uuid4())
		path = background_ops.result_file_path(op_id)
		self.addCleanup(lambda: os.path.exists(path) and os.remove(path))
		with patch("frappe.utils.background_jobs.get_queue") as get_queue:
			queued = []
			get_queue.return_value.enqueue_call.side_effect = lambda func, **kw: queued.append(kw)
			get_queue.return_value.count = 0
			started = cbd.start_commission_reports(
				op_id=op_id, tracker=self.tracker, tasks=[{"name": n, "landscape": False} for n in rows]
			)
			self.assertEqual(started["state"], "queued")
			frappe.db.commit()
		self.assertEqual(len(queued), 1)

		def render(*args, **kwargs):
			if on_render:
				on_render(op_id)
			return _blank_pdf()

		with patch.object(cbd, "get_pdf", side_effect=render):
			frappe.set_user("Guest")  # a worker starts as no particular user
			execute_job(**{**queued[0]["kwargs"], "is_async": False})
		frappe.set_user("Administrator")
		return op_id

	def test_the_submitted_reports_end_in_their_owners_file_and_nothing_lands_in_a_served_folder(self):
		temp_dir = frappe.get_site_path("public", "files", "temp_downloads")
		before = set(os.listdir(temp_dir)) if os.path.isdir(temp_dir) else set()

		op_id = self._start_and_work_off(self.submitted + self.pending)

		status = get_status(op_id=op_id)
		self.assertEqual(status["state"], "finished", status.get("error"))
		self.assertEqual({k: status["result"][k] for k in ("rendered", "failed", "total")}, {"rendered": 2, "failed": 0, "total": 2})
		frappe.local.response = frappe._dict()
		collect_result(op_id=op_id)
		self.assertEqual(len(PdfReader(io.BytesIO(frappe.local.response.filecontent)).pages), 2)
		safe_name = self.project_name.replace(" ", "_")
		self.assertEqual(frappe.local.response.filename, f"{safe_name}_Commission_Reports_{today()}.pdf")
		after = set(os.listdir(temp_dir)) if os.path.isdir(temp_dir) else set()
		self.assertEqual(after, before, "wrote a file the web server serves")

	def test_the_work_receives_its_own_operation_id(self):
		seen = []

		def on_render(op_id):
			seen.append((frappe.local.background_op_id, op_id))

		self._start_and_work_off(self.submitted, on_render=on_render)

		self.assertEqual(len(seen), 2)
		self.assertTrue(all(got == expected for got, expected in seen), seen)

	def test_progress_counts_the_reports_in_the_owners_record(self):
		reads = []

		def on_render(op_id):
			frappe.set_user("Administrator")
			reads.append(get_status(op_id=op_id)["progress"])

		self._start_and_work_off(self.submitted, on_render=on_render)

		# Read while each report renders: the count of reports finished before it.
		self.assertEqual([r["detail"] for r in reads], [{"done": 0, "total": 2}, {"done": 1, "total": 2}])

	def test_a_stranger_can_neither_read_nor_collect_anothers_download(self):
		op_id = self._start_and_work_off(self.submitted)

		frappe.set_user(STRANGER)
		with self.assertRaises(frappe.PermissionError):
			get_status(op_id=op_id)
		with self.assertRaises(frappe.PermissionError):
			collect_result(op_id=op_id)

	def test_a_selection_with_no_eligible_report_fails_in_its_own_words(self):
		op_id = self._start_and_work_off(self.pending)

		status = get_status(op_id=op_id)
		self.assertEqual(status["state"], "failed")
		self.assertIn("None of the selected tasks are eligible", status["error"])
