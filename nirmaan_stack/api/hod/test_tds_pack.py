# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""`tds_pack.report_items`: the rows the handover binder's Material Data Sheet prints (#1388).

The binder reads the ticks saved by the shared Download TDS PDF dialog. It prints them in the order
they were saved, which is the dialog's print order, and never prints a *Rejected by Client* row, even
when a tick on it was saved before the client rejected it.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.hod.tds_pack import report_items
from nirmaan_stack.api.tds.client_status import CLIENT_STATUS_APPROVED, CLIENT_STATUS_REJECTED
from nirmaan_stack.api.tds.test_submit import _create_project, _raw

ROW = "Project TDS Item List"
PACKAGE = "HOD Pack Test Package"


class TestReportItems(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.project = _create_project()
		frappe.db.commit()

	@classmethod
	def tearDownClass(cls):
		frappe.db.sql(f'DELETE FROM "tab{ROW}" WHERE tdsi_project_id = %s', (cls.project,))
		frappe.delete_doc("Projects", cls.project, force=True, ignore_permissions=True)
		frappe.db.commit()
		super().tearDownClass()

	def setUp(self):
		self._real_commit = frappe.db.commit
		frappe.db.commit = lambda *a, **k: None
		# A package no HOD System shares, so the keyword narrowing stays out of the way.
		self.system = frappe._dict(work_package=PACKAGE, keywords=[])

	def tearDown(self):
		frappe.db.commit = self._real_commit
		frappe.db.rollback()

	def _row(self, item_name, client_status=None, status="Approved"):
		return _raw(
			ROW,
			tdsi_project_id=self.project,
			tds_work_package=PACKAGE,
			tds_category="Valves",
			tds_item_id="TDSI-0001",
			tds_item_name=item_name,
			tds_make="MakeA",
			tds_status=status,
			client_status=client_status,
		)

	def _printed(self, selected):
		return [r["name"] for r in report_items(self.project, self.system, {"selected": selected})]

	def test_a_saved_tick_on_a_row_the_client_later_rejected_is_not_printed(self):
		kept = self._row("Ball Valve")
		rejected = self._row("Gate Valve", client_status=CLIENT_STATUS_REJECTED)

		self.assertEqual(self._printed([kept, rejected]), [kept])

	def test_with_nothing_saved_a_rejected_by_client_row_is_still_left_out(self):
		kept = self._row("Ball Valve")
		self._row("Gate Valve", client_status=CLIENT_STATUS_REJECTED)

		self.assertEqual([r["name"] for r in report_items(self.project, self.system, {})], [kept])

	def test_the_saved_ticks_print_in_the_order_they_were_saved(self):
		admin = self._row("Ball Valve")
		client = self._row("Gate Valve", client_status=CLIENT_STATUS_APPROVED)

		# The dialog saves client-approved first; A to Z by name would print the Ball Valve first.
		self.assertEqual(self._printed([client, admin]), [client, admin])
