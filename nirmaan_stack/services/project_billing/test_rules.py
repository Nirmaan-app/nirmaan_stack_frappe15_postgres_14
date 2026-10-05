"""Pure tests for services/project_billing.py — no DB, no site."""

import json
import os
import unittest
from datetime import date

from nirmaan_stack.services.project_billing.rules import (
	APPROVED_STATUSES,
	DEADLINE_CHOICES,
	NA_STATUS,
	PENDING_STATUSES,
	SUBMITTED_OR_LATER,
	SUMMARY_COLUMNS,
	can_edit_package_bills,
	clean_package_name,
	counts_in_totals,
	deadline_window,
	next_bill,
	summary_column,
)

_BILL_JSON = os.path.join(
	os.path.dirname(__file__), "..", "..", "nirmaan_stack", "doctype", "project_billing", "project_billing.json"
)


def _status_options():
	with open(_BILL_JSON) as fh:
		fields = json.load(fh)["fields"]
	status = next(f for f in fields if f["fieldname"] == "status")
	return status["options"].split("\n")


class TestStatusGroups(unittest.TestCase):
	def test_groups_partition_every_status_except_na(self):
		# The doctype's Select and the service's groups can never drift apart.
		options = set(_status_options())
		self.assertEqual(APPROVED_STATUSES | PENDING_STATUSES | {NA_STATUS}, options)
		self.assertFalse(APPROVED_STATUSES & PENDING_STATUSES)

	def test_na_is_in_neither_group_and_out_of_totals(self):
		self.assertNotIn(NA_STATUS, APPROVED_STATUSES)
		self.assertNotIn(NA_STATUS, PENDING_STATUSES)
		self.assertFalse(counts_in_totals(NA_STATUS))
		self.assertTrue(counts_in_totals("Not Started"))

	def test_not_started_and_client_hold_are_pending(self):
		# Owner override of the mockup, which only counted "*Pending" statuses.
		self.assertIn("Not Started", PENDING_STATUSES)
		self.assertIn("Client Hold", PENDING_STATUSES)

	def test_submitted_or_later_excludes_pre_submission_statuses(self):
		for status in ("Not Started", "Prepared", "Submission Pending", "Internally Approved",
				"Revision Pending", NA_STATUS):
			self.assertNotIn(status, SUBMITTED_OR_LATER)
		self.assertTrue(APPROVED_STATUSES <= SUBMITTED_OR_LATER)


class TestSummaryColumns(unittest.TestCase):
	def test_columns_cover_pending_and_approved_exactly_once(self):
		seen = [status for _key, _label, statuses in SUMMARY_COLUMNS for status in statuses]
		self.assertEqual(len(seen), len(set(seen)))
		self.assertEqual(set(seen), APPROVED_STATUSES | PENDING_STATUSES)

	def test_na_has_no_column(self):
		self.assertIsNone(summary_column(NA_STATUS))
		self.assertEqual(summary_column("Client Hold"), "hold")


class TestNextBill(unittest.TestCase):
	def test_earliest_eta_among_pending_wins(self):
		bills = [
			{"name": "a", "status": "Prepared", "eta_date": "2026-10-20"},
			{"name": "b", "status": "Submitted", "eta_date": "2026-10-05"},
			{"name": "c", "status": "Client Approved", "eta_date": "2026-10-01"},
		]
		self.assertEqual(next_bill(bills)["name"], "b")

	def test_bill_type_order_is_ignored(self):
		bills = [
			{"name": "supply1", "bill_type": "Supply 1", "status": "Not Started", "eta_date": "2026-11-01"},
			{"name": "final", "bill_type": "Final", "status": "Not Started", "eta_date": "2026-10-10"},
		]
		self.assertEqual(next_bill(bills)["name"], "final")

	def test_undated_bills_come_last(self):
		bills = [
			{"name": "undated", "status": "Not Started", "eta_date": None},
			{"name": "dated", "status": "Not Started", "eta_date": "2026-12-31"},
		]
		self.assertEqual(next_bill(bills)["name"], "dated")

	def test_na_and_approved_are_never_next(self):
		bills = [
			{"name": "na", "status": NA_STATUS, "eta_date": "2026-10-01"},
			{"name": "paid", "status": "Payment Received", "eta_date": "2026-10-01"},
		]
		self.assertIsNone(next_bill(bills))

	def test_ties_keep_input_order(self):
		bills = [
			{"name": "first", "status": "Prepared", "eta_date": "2026-10-05"},
			{"name": "second", "status": "Prepared", "eta_date": "2026-10-05"},
		]
		self.assertEqual(next_bill(bills)["name"], "first")


class TestDeadlineWindow(unittest.TestCase):
	TODAY = date(2026, 10, 3)

	def test_overdue_ends_yesterday(self):
		self.assertEqual(
			deadline_window("overdue", self.TODAY),
			{"eta_from": None, "eta_to": date(2026, 10, 2), "eta_unset": False},
		)

	def test_week_is_today_to_seven_days_inclusive(self):
		self.assertEqual(
			deadline_window("week", self.TODAY),
			{"eta_from": date(2026, 10, 3), "eta_to": date(2026, 10, 10), "eta_unset": False},
		)

	def test_none_means_no_eta(self):
		self.assertEqual(
			deadline_window("none", self.TODAY),
			{"eta_from": None, "eta_to": None, "eta_unset": True},
		)

	def test_every_choice_is_known(self):
		for choice in DEADLINE_CHOICES:
			deadline_window(choice, self.TODAY)

	def test_unknown_choice_is_refused(self):
		with self.assertRaises(ValueError):
			deadline_window("someday", self.TODAY)


if __name__ == "__main__":
	unittest.main()


class TestPackageBillsEditor(unittest.TestCase):
	def test_admin_edits_every_package(self):
		self.assertTrue(can_edit_package_bills("admin@x", [], True))
		self.assertTrue(can_edit_package_bills("admin@x", ["someone@x"], True))

	def test_a_manager_edits_their_package(self):
		self.assertTrue(can_edit_package_bills("monish@x", ["abhishek@x", "monish@x"], False))

	def test_anyone_else_cannot(self):
		self.assertFalse(can_edit_package_bills("pmo@x", ["monish@x"], False))
		self.assertFalse(can_edit_package_bills("pmo@x", [], False))
		self.assertFalse(can_edit_package_bills("pmo@x", None, False))


class TestBillingPackages(unittest.TestCase):
	def test_name_is_trimmed_and_inner_spaces_collapsed(self):
		self.assertEqual(clean_package_name("  Fire   Alarm "), "Fire Alarm")
		self.assertEqual(clean_package_name(None), "")
		self.assertEqual(clean_package_name("   "), "")
