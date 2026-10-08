# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""`set_client_status`: recording the client's answer on Admin-approved Project TDS rows (#1385,
ADR-0025 Amendment B).

Each test reads the stored rows afterwards. Fixtures are raw inserts inside a transaction whose
commits are stubbed and which is rolled back in `tearDown`; the project is a real Projects row made
once per class.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.tds.client_status import (
	ACTION_CLEAR,
	ACTION_MARK_APPROVED,
	ACTION_MARK_REJECTED,
	CLIENT_STATUS_APPROVED,
	CLIENT_STATUS_REJECTED,
	set_client_status,
)
from nirmaan_stack.api.tds.test_submit import _create_project, _make_user, _raw
from nirmaan_stack.services.role_profiles import PMO_EXECUTIVE_PROFILE

ROW = "Project TDS Item List"
PMO_USER = "tds-client-pmo@example.com"
PM_USER = "tds-client-pm@example.com"
CLIENT_FIELDS = ["client_status", "client_status_by", "client_status_on", "client_rejection_reason"]


class TestSetClientStatus(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		_make_user(PMO_USER, PMO_EXECUTIVE_PROFILE, ("Nirmaan PMO Executive",))
		_make_user(PM_USER, "Nirmaan Project Manager Profile", ("Nirmaan Project Manager",))
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
		frappe.set_user("Administrator")

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.commit = self._real_commit
		frappe.db.rollback()

	def _row(self, status="Approved", make="MakeN", **fields):
		return _raw(
			ROW,
			tdsi_project_id=self.project,
			tds_item_id="TDSI-0001",
			tds_item_name="Gate Valve",
			tds_make=make,
			tds_status=status,
			**fields,
		)

	def _stored(self, row):
		return frappe.db.get_value(ROW, row, ["tds_status", *CLIENT_FIELDS], as_dict=True)

	def test_a_pmo_executive_marks_admin_approved_rows_approved_by_client(self):
		rows = [self._row(make="MakeA"), self._row(make="MakeB")]
		frappe.set_user(PMO_USER)

		out = set_client_status(rows, ACTION_MARK_APPROVED)

		frappe.set_user("Administrator")
		self.assertEqual(out, {"status": "success", "updated": 2, "errors": []})
		for row in rows:
			stored = self._stored(row)
			self.assertEqual(stored.tds_status, "Approved")
			self.assertEqual(stored.client_status, CLIENT_STATUS_APPROVED)
			self.assertEqual(stored.client_status_by, PMO_USER)
			self.assertIsNotNone(stored.client_status_on)

	def test_an_admin_marks_rows_rejected_by_client_and_the_reason_lands_on_every_row(self):
		rows = [self._row(make="MakeA"), self._row(make="MakeB")]

		out = set_client_status(rows, ACTION_MARK_REJECTED, reason="  Client wants a UL-listed make  ")

		self.assertEqual(out["updated"], 2)
		for row in rows:
			stored = self._stored(row)
			self.assertEqual(stored.client_status, CLIENT_STATUS_REJECTED)
			self.assertEqual(stored.client_status_by, "Administrator")
			self.assertEqual(stored.client_rejection_reason, "Client wants a UL-listed make")

	def test_the_reason_is_optional_on_a_rejection(self):
		row = self._row()

		set_client_status([row], ACTION_MARK_REJECTED)

		stored = self._stored(row)
		self.assertEqual(stored.client_status, CLIENT_STATUS_REJECTED)
		self.assertFalse(stored.client_rejection_reason)

	def test_a_switch_restamps_the_row_and_marking_approved_drops_the_reason(self):
		row = self._row(
			client_status=CLIENT_STATUS_REJECTED,
			client_status_by="Administrator",
			client_status_on="2026-01-01 10:00:00",
			client_rejection_reason="Wrong colour",
		)
		frappe.set_user(PMO_USER)

		set_client_status([row], ACTION_MARK_APPROVED, reason="ignored on an approval")

		frappe.set_user("Administrator")
		stored = self._stored(row)
		self.assertEqual(stored.client_status, CLIENT_STATUS_APPROVED)
		self.assertEqual(stored.client_status_by, PMO_USER)
		self.assertGreater(stored.client_status_on, frappe.utils.get_datetime("2026-01-01 10:00:00"))
		self.assertFalse(stored.client_rejection_reason)

	def test_a_switch_to_rejected_by_client_restamps_the_row_and_keeps_the_new_reason(self):
		row = self._row(
			client_status=CLIENT_STATUS_APPROVED,
			client_status_by="Administrator",
			client_status_on="2026-01-01 10:00:00",
		)
		frappe.set_user(PMO_USER)

		out = set_client_status([row], ACTION_MARK_REJECTED, reason="Client changed their mind")

		frappe.set_user("Administrator")
		self.assertEqual(out, {"status": "success", "updated": 1, "errors": []})
		stored = self._stored(row)
		self.assertEqual(stored.tds_status, "Approved")
		self.assertEqual(stored.client_status, CLIENT_STATUS_REJECTED)
		self.assertEqual(stored.client_status_by, PMO_USER)
		self.assertGreater(stored.client_status_on, frappe.utils.get_datetime("2026-01-01 10:00:00"))
		self.assertEqual(stored.client_rejection_reason, "Client changed their mind")

	def test_an_admin_clear_of_an_approved_by_client_row_returns_it_to_tds_history(self):
		row = self._row(
			client_status=CLIENT_STATUS_APPROVED,
			client_status_by=PMO_USER,
			client_status_on="2026-01-01 10:00:00",
		)

		out = set_client_status([row], ACTION_CLEAR)

		self.assertEqual(out["updated"], 1)
		stored = self._stored(row)
		self.assertEqual(stored.tds_status, "Approved")
		self.assertFalse(any(stored[f] for f in CLIENT_FIELDS))

	def test_clear_refuses_a_row_with_no_client_status_and_leaves_it_alone(self):
		row = self._row()

		out = set_client_status([row], ACTION_CLEAR)

		self.assertEqual(out["updated"], 0)
		self.assertEqual([e["name"] for e in out["errors"]], [row])
		self.assertFalse(any(self._stored(row)[f] for f in CLIENT_FIELDS))

	def test_rows_that_are_not_admin_approved_are_refused_one_by_one(self):
		waiting = [self._row(status, make=f"Make{status or 'Legacy'}") for status in ("Pending", "New", "Rejected", "")]
		approved = self._row(make="MakeOK")

		out = set_client_status([*waiting, approved], ACTION_MARK_APPROVED)

		self.assertEqual(out["updated"], 1)
		self.assertEqual(sorted(e["name"] for e in out["errors"]), sorted(waiting))
		self.assertTrue(all("Admin-approved" in e["error"] for e in out["errors"]))
		for row in waiting:
			self.assertFalse(self._stored(row).client_status)
			self.assertFalse(self._stored(row).client_status_by)
		self.assertEqual(self._stored(approved).client_status, CLIENT_STATUS_APPROVED)

	def test_a_project_user_without_admin_or_pmo_rights_can_neither_mark_nor_clear(self):
		row = self._row(client_status=CLIENT_STATUS_APPROVED, client_status_by="Administrator")
		frappe.set_user(PM_USER)
		for action in (ACTION_MARK_APPROVED, ACTION_MARK_REJECTED, ACTION_CLEAR):
			with self.subTest(action=action), self.assertRaises(frappe.PermissionError):
				set_client_status([row], action)
		frappe.set_user("Administrator")
		stored = self._stored(row)
		self.assertEqual((stored.client_status, stored.client_status_by), (CLIENT_STATUS_APPROVED, "Administrator"))

	def test_a_pmo_executive_cannot_clear(self):
		row = self._row(client_status=CLIENT_STATUS_APPROVED, client_status_by=PMO_USER)
		frappe.set_user(PMO_USER)
		with self.assertRaises(frappe.PermissionError):
			set_client_status([row], ACTION_CLEAR)
		frappe.set_user("Administrator")
		self.assertEqual(self._stored(row).client_status, CLIENT_STATUS_APPROVED)

	def test_an_admin_clear_blanks_all_four_fields(self):
		row = self._row(
			client_status=CLIENT_STATUS_REJECTED,
			client_status_by=PMO_USER,
			client_status_on="2026-01-01 10:00:00",
			client_rejection_reason="Wrong colour",
		)

		out = set_client_status([row], ACTION_CLEAR)

		self.assertEqual(out["updated"], 1)
		stored = self._stored(row)
		self.assertEqual(stored.tds_status, "Approved")
		self.assertFalse(any(stored[f] for f in CLIENT_FIELDS))

	def test_an_unknown_action_changes_nothing(self):
		row = self._row()
		with self.assertRaises(frappe.ValidationError):
			set_client_status([row], "approve")
		self.assertFalse(self._stored(row).client_status)
