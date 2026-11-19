# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""The handover binder as a background operation (#1663, ADR 0047): started through the module, followed by its
status record, and finished to a file only the user who started it can collect.

The queue is faked (`get_queue` hands back a recorder) and the test runs the queued wrapper itself, as a worker
would. Rendering is stubbed to one blank page per render, so the test needs no print engine; what it checks is the
lifecycle and who may collect the file. The project and its handover rows are made-up, committed (the operation is
queued only once the start commits) and deleted again in `tearDown`.
"""

import io
import os
import time
import unittest
import uuid
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils.background_jobs import execute_job
from pypdf import PdfReader, PdfWriter

from nirmaan_stack.api.background_ops import collect_result, get_status
from nirmaan_stack.api.hod import binder
from nirmaan_stack.services import background_ops
from nirmaan_stack.services.test_background_ops_held_queue import HeldQueue

SYSTEM = "HVAC"
DOCUMENT = "key_list"
STRANGER = "hod-binder-stranger@example.com"


def _blank_pdf(pages=1):
	writer = PdfWriter()
	for _ in range(pages):
		writer.add_blank_page(width=595, height=842)
	buf = io.BytesIO()
	writer.write(buf)
	return buf.getvalue()


class TestBinderOperation(FrappeTestCase):
	def setUp(self):
		if not frappe.db.exists("HOD System", SYSTEM):
			raise unittest.SkipTest(f"HOD System {SYSTEM} missing on this site")
		frappe.set_user("Administrator")
		tag = frappe.generate_hash(length=6)
		project = frappe.new_doc("Projects")
		project.update({"project_name": f"TEST_HOD_BINDER_OP_{tag}", "tendering_status": "Won"})
		project.name = f"TEST-HOD-BINDER-OP-{tag}"
		project.db_insert()
		self.project = project.name
		row = frappe.new_doc(binder.DOCTYPE)
		row.update(
			{"project": self.project, "hod_system": SYSTEM, "document": DOCUMENT, "status": "Done", "disabled": 0}
		)
		row.name = frappe.generate_hash(length=12)
		row.db_insert()
		frappe.db.commit()
		self.op_files = []

	def tearDown(self):
		# Roll back first (a failed test can leave the transaction aborted), then each scope on its own: one that
		# fails is rolled back and reported, and never strands the scopes after it.
		frappe.set_user("Administrator")
		frappe.db.rollback()
		failures = []
		for doctype, filters in ((binder.DOCTYPE, {"project": self.project}), ("Projects", {"name": self.project})):
			try:
				frappe.db.delete(doctype, filters)
				frappe.db.commit()
			except Exception as e:
				frappe.db.rollback()
				failures.append(f"{doctype} {filters}: {e}")
		for path in self.op_files:
			try:
				if os.path.exists(path):
					os.remove(path)
			except OSError as e:
				failures.append(f"{path}: {e}")
		if failures:
			raise AssertionError("tearDown left records behind:\n" + "\n".join(failures))

	def _start_and_work_off(self, document=DOCUMENT):
		op_id = str(uuid.uuid4())
		self.op_files.append(background_ops.result_file_path(op_id))
		with patch("frappe.utils.background_jobs.get_queue") as get_queue:
			queued = []
			get_queue.return_value.enqueue_call.side_effect = lambda func, **kw: queued.append(kw)
			get_queue.return_value.count = 0
			started = binder.start_binder(op_id=op_id, project=self.project, hod_system=SYSTEM, document=document)
			self.assertEqual(started["state"], "queued")
			frappe.db.commit()
		self.assertEqual(len(queued), 1)
		with (
			patch.object(binder, "_print", side_effect=lambda *a, **k: _blank_pdf()),
			patch.object(binder, "_dividers", side_effect=lambda sections, *a: [
				PdfReader(io.BytesIO(_blank_pdf())).pages[0] for _ in sections
			]),
		):
			frappe.set_user("Guest")  # a worker starts as no particular user
			execute_job(**{**queued[0]["kwargs"], "is_async": False})
		frappe.set_user("Administrator")
		return op_id

	def test_one_documents_content_ends_in_its_owners_file_and_uses_no_download_token(self):
		temp_dir = frappe.get_site_path("public", "files", "temp_downloads")
		before = set(os.listdir(temp_dir)) if os.path.isdir(temp_dir) else set()

		op_id = self._start_and_work_off()

		status = get_status(op_id=op_id)
		self.assertEqual(status["state"], "finished", status.get("error"))
		self.assertEqual(status["result"]["failed"], [])
		self.assertNotIn("token", status["result"])
		frappe.local.response = frappe._dict()
		collect_result(op_id=op_id)
		self.assertEqual(len(PdfReader(io.BytesIO(frappe.local.response.filecontent)).pages), 1)
		self.assertTrue(frappe.local.response.filename.endswith(".pdf"))
		self.assertIn("_HVAC_01_Key_List_", frappe.local.response.filename)
		after = set(os.listdir(temp_dir)) if os.path.isdir(temp_dir) else set()
		self.assertEqual(after, before, "wrote a file the web server serves")

	def test_the_whole_binder_ends_in_its_owners_file(self):
		for pf in (binder.PF_DOCUMENT, binder.PF_CHECKLIST):
			if not frappe.db.exists("Print Format", pf):
				raise unittest.SkipTest(f"Print Format {pf} missing on this site")
		op_id = self._start_and_work_off(document=None)

		status = get_status(op_id=op_id)
		self.assertEqual(status["state"], "finished", status.get("error"))
		frappe.local.response = frappe._dict()
		collect_result(op_id=op_id)
		# Cover & checklist, then the one Done document's divider and its content.
		self.assertEqual(len(PdfReader(io.BytesIO(frappe.local.response.filecontent)).pages), 3)
		self.assertIn("_Handover_", frappe.local.response.filename)

	def test_a_stranger_can_neither_read_nor_collect_anothers_binder(self):
		op_id = self._start_and_work_off()

		frappe.set_user(STRANGER)
		with self.assertRaises(frappe.PermissionError):
			get_status(op_id=op_id)
		with self.assertRaises(frappe.PermissionError):
			collect_result(op_id=op_id)

	def _queue_only(self, document=None):
		"""Start a build and commit, but leave it in the queue: the user's binder is still being prepared."""
		op_id = str(uuid.uuid4())
		# Dropping the record frees the user whatever the test did (a missing record reads as lost).
		self.addCleanup(frappe.cache().delete, background_ops._key(op_id))
		with HeldQueue(self):  # its RQ job stays queued, so it never reads as lost, however slow the run
			binder.start_binder(op_id=op_id, project=self.project, hod_system=SYSTEM, document=document)
			frappe.db.commit()
		return op_id

	def test_one_binder_per_user_at_a_time_named_in_the_refusal_and_an_ended_one_frees_the_user(self):
		for pf in (binder.PF_DOCUMENT, binder.PF_CHECKLIST):
			if not frappe.db.exists("Print Format", pf):
				raise unittest.SkipTest(f"Print Format {pf} missing on this site")
		first = self._queue_only()

		project_name = frappe.db.get_value("Projects", self.project, "project_name")
		# A slow run: the second start comes after the first has waited past the stale-heartbeat limit.
		later = time.time() + background_ops.HEARTBEAT_STALE_SECONDS + 1
		with patch("nirmaan_stack.services.background_ops.time.time", return_value=later), \
				self.assertRaises(frappe.ValidationError) as refused:
			self._queue_only()
		self.assertEqual(
			str(refused.exception),
			f"Your handover binder for {project_name} ({SYSTEM}) is still being prepared. "
			"Wait for it to finish, then try again.",
		)
		frappe.db.rollback()

		background_ops._end(first, background_ops.FINISHED)  # however it ends, the user is free again
		self._start_and_work_off(document=None)

	def test_a_queued_binder_never_holds_back_one_documents_download_which_is_one_at_a_time_itself(self):
		for pf in (binder.PF_DOCUMENT, binder.PF_CHECKLIST):
			if not frappe.db.exists("Print Format", pf):
				raise unittest.SkipTest(f"Print Format {pf} missing on this site")
		self._queue_only()

		document = self._queue_only(document=DOCUMENT)
		self.assertEqual(get_status(op_id=document)["state"], "queued")

		project_name = frappe.db.get_value("Projects", self.project, "project_name")
		title = binder.build_plan(self.project, SYSTEM, DOCUMENT)[0][0]["title"]
		with self.assertRaises(frappe.ValidationError) as refused:
			self._queue_only(document=DOCUMENT)
		self.assertEqual(
			str(refused.exception),
			f"Your {title} download for {project_name} ({SYSTEM}) is still being prepared. "
			"Wait for it to finish, then try again.",
		)
		frappe.db.rollback()

		background_ops._end(document, background_ops.FINISHED)
		self._start_and_work_off()

	def test_a_document_that_is_not_done_is_refused_before_anything_is_queued(self):
		frappe.db.set_value(binder.DOCTYPE, {"project": self.project}, "status", "WIP")
		frappe.db.commit()
		with patch("frappe.utils.background_jobs.get_queue") as get_queue:
			with self.assertRaises(frappe.ValidationError):
				binder.start_binder(
					op_id=str(uuid.uuid4()), project=self.project, hod_system=SYSTEM, document=DOCUMENT
				)
			get_queue.return_value.enqueue_call.assert_not_called()
