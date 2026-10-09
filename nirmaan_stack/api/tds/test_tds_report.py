# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""The TDS report page of a Project Custom Item (#1377): its chosen Category prints as Model No.
and its own description as the Sample Description.

`build_tds_report_pdf` runs for real up to the HTML the "Project TDS Report" print format renders;
only the HTML-to-PDF step and the datasheet merge are stubbed, so the test reads the page itself.
"""

from unittest.mock import patch

from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.tds.tds_report import build_tds_report_pdf

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
