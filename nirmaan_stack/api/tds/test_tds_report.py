# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""The TDS report page of a Project Custom Item (#1377): its chosen Category prints as Model No.
and its own description as the Sample Description.

`build_tds_report_pdf` runs for real up to the HTML the "Project TDS Report" print format renders;
only the HTML-to-PDF step and the datasheet merge are stubbed, so the test reads the page itself.
"""

import io
import json
import os
import uuid
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils.background_jobs import execute_job
from pypdf import PdfReader

from nirmaan_stack.api.background_ops import collect_result, get_status
from nirmaan_stack.api.tds.tds_report import build_tds_report_pdf, start_tds_export
from nirmaan_stack.services import background_ops

_ROLE = {"name": "", "logo": None, "enabled": False}
SETTINGS = {
	role: dict(_ROLE)
	for role in ("client", "projectManager", "architect", "consultant", "gcContractor", "mepContractor")
}


class TestTdsReportProjectCustom(FrappeTestCase):
	def _render(self, items):
		pages = []
		with (
			patch("nirmaan_stack.api.tds.tds_report.get_pdf", side_effect=lambda html: pages.append(html) or b""),
			patch("nirmaan_stack.api.tds.tds_report.merge_pdfs_interleaved", return_value=(b"", [])),
		):
			build_tds_report_pdf(SETTINGS, items)
		(html,) = pages
		return html

	def test_a_project_custom_row_prints_its_category_and_its_description(self):
		html = self._render(
			[
				{
					"name": "row-1",
					"tds_item_id": "PCUS-000001",
					"tds_item_name": "Facade Linear Light 24W",
					"tds_make": "Philips",
					"tds_category": "Lighting Fixtures QX",
					"tds_work_package": "Electrical Work",
					"tds_description": "IP66, 3000K, anodised housing",
					"tds_status": "Approved",
					"tds_request_id": "RQ-102-22",
					"tds_attachment": "",
				}
			]
		)
		self.assertIn("Facade Linear Light 24W", html)
		# Model No. is the cell right after Make.
		self.assertRegex(html, r"Philips\s*</td>\s*<td[^>]*>\s*Lighting Fixtures QX\s*</td>")
		self.assertIn("IP66, 3000K, anodised housing", html)


class TestTdsExportOperation(FrappeTestCase):
	"""TDS export from the TDS Repository as a background operation (#1662): two exports by one user, as two tabs
	start them, each end in that tab's own PDF, collected by operation id from a private folder."""

	OWNER = "tds-export-owner@example.com"

	def setUp(self):
		frappe.set_user(self.OWNER)

	def tearDown(self):
		frappe.db.rollback()
		frappe.set_user("Administrator")

	def test_two_exports_by_one_user_each_end_in_their_own_pdf_and_use_no_download_token(self):
		temp_dir = frappe.get_site_path("public", "files", "temp_downloads")
		tokens_before = set(os.listdir(temp_dir)) if os.path.isdir(temp_dir) else set()
		tabs = {"heavy": (str(uuid.uuid4()), 12), "light": (str(uuid.uuid4()), 1)}
		marker = frappe.generate_hash(length=8).upper()

		with patch("frappe.utils.background_jobs.get_queue") as get_queue:
			queued = []
			get_queue.return_value.enqueue_call.side_effect = lambda func, **kw: queued.append(kw)
			get_queue.return_value.count = 0
			for tab, (op_id, rows) in tabs.items():
				items = [dict(_ROW, name=f"row-{k}", tds_item_name=f"Sheet {marker}{tab} {k}") for k in range(rows)]
				start_tds_export(
					op_id=op_id, settings_json=json.dumps(SETTINGS), items_json=json.dumps(items),
					project_name=f"Export {tab}",
				)
			frappe.db.commit()
		for job in queued:
			execute_job(**{**job["kwargs"], "is_async": False})
		frappe.set_user(self.OWNER)

		for tab, (op_id, _rows) in tabs.items():
			path = background_ops.result_file_path(op_id)
			self.addCleanup(lambda p=path: os.path.exists(p) and os.remove(p))
			status = get_status(op_id=op_id)
			self.assertEqual(status["state"], "finished", status.get("error"))
			self.assertNotIn("token", status["result"])
			frappe.local.response = frappe._dict()
			collect_result(op_id=op_id)
			pages = PdfReader(io.BytesIO(frappe.local.response.filecontent)).pages
			text = "".join(page.extract_text() or "" for page in pages)
			other = "light" if tab == "heavy" else "heavy"
			self.assertIn(f"{marker}{tab}", text)
			self.assertNotIn(f"{marker}{other}", text)
			self.assertTrue(frappe.local.response.filename.startswith(f"TDS_Report_Export_{tab.title()}_"))
		tokens_after = set(os.listdir(temp_dir)) if os.path.isdir(temp_dir) else set()
		self.assertEqual(tokens_after, tokens_before, "wrote a file the web server serves")

	def test_a_stranger_can_neither_read_nor_collect_anothers_export(self):
		"""The Handover export runs this same operation (#1663): its PDF is the owner's alone."""
		op_id = str(uuid.uuid4())
		items = [dict(_ROW, name="row-1", tds_item_name="Made-up Sheet")]
		with patch("frappe.utils.background_jobs.get_queue") as get_queue:
			queued = []
			get_queue.return_value.enqueue_call.side_effect = lambda func, **kw: queued.append(kw)
			get_queue.return_value.count = 0
			start_tds_export(op_id=op_id, settings_json=json.dumps(SETTINGS), items_json=json.dumps(items))
			frappe.db.commit()
		execute_job(**{**queued[0]["kwargs"], "is_async": False})
		path = background_ops.result_file_path(op_id)
		self.addCleanup(lambda: os.path.exists(path) and os.remove(path))
		frappe.set_user(self.OWNER)
		self.assertEqual(get_status(op_id=op_id)["state"], "finished")

		frappe.set_user("tds-export-stranger@example.com")
		with self.assertRaises(frappe.PermissionError):
			get_status(op_id=op_id)
		with self.assertRaises(frappe.PermissionError):
			collect_result(op_id=op_id)


_ROW = {
	"tds_item_id": "PCUS-000001",
	"tds_make": "Made-up Make",
	"tds_category": "Made-up Category",
	"tds_work_package": "Electrical Work",
	"tds_description": "made-up description",
	"tds_status": "Approved",
	"tds_request_id": "RQ-000-01",
	"tds_attachment": "",
}
