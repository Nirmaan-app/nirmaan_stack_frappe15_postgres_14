# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The words a Project TDS row's status prints as (Handover print). The frontend's twin,
`historyStatusLabel` in `frontend/src/utils/tdsRequestRules.ts`, is pinned to these by its parity test."""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.tds.status_label import history_status_label, with_status_labels


class TestHistoryStatusLabel(FrappeTestCase):
	def test_an_admin_approved_row_reads_approved_by_admin(self):
		self.assertEqual(history_status_label("Approved"), "Approved by Admin")

	def test_pending_and_new_read_pending(self):
		self.assertEqual(history_status_label("Pending"), "Pending")
		self.assertEqual(history_status_label("New"), "Pending")

	def test_rejected_reads_rejected(self):
		self.assertEqual(history_status_label("Rejected"), "Rejected")

	def test_a_blank_status_reads_pending(self):
		self.assertEqual(history_status_label(None), "Pending")
		self.assertEqual(history_status_label(""), "Pending")


class TestWithStatusLabels(FrappeTestCase):
	def test_rows_carry_the_shown_label_and_keep_their_other_fields(self):
		rows = [
			frappe._dict(name="A", tds_item_name="Cable", tds_status="Approved"),
			frappe._dict(name="B", tds_item_name="Tray", tds_status="New"),
		]
		out = with_status_labels(rows)
		self.assertEqual([r.tds_status for r in out], ["Approved by Admin", "Pending"])
		self.assertEqual([r.name for r in out], ["A", "B"])
		self.assertEqual(out[0].tds_item_name, "Cable")

	def test_the_source_rows_keep_their_stored_status(self):
		rows = [frappe._dict(name="A", tds_status="Approved")]
		with_status_labels(rows)
		self.assertEqual(rows[0].tds_status, "Approved")

	def test_nothing_in_nothing_out(self):
		self.assertEqual(with_status_labels(None), [])
		self.assertEqual(with_status_labels([]), [])
