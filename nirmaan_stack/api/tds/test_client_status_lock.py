# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""The delete lock on a Project TDS row the client has answered (#1387, ADR-0025 Amendment B).

A row with a Client Status can't be deleted by anyone, through any path, until an Admin clears it.
Each test reads the stored row afterwards. Fixtures are raw inserts inside a transaction whose commits
are stubbed and which is rolled back in `tearDown`; the project is a real Projects row made once per
class.
"""

import frappe
import frappe.client
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.tds.client_status import (
	ACTION_CLEAR,
	CLIENT_STATUS_APPROVED,
	CLIENT_STATUS_REJECTED,
	set_client_status,
)
from nirmaan_stack.api.tds.test_submit import _create_project, _make_user, _raw
from nirmaan_stack.services.role_profiles import PMO_EXECUTIVE_PROFILE

ROW = "Project TDS Item List"
PMO_USER = "tds-lock-pmo@example.com"
CLIENT_FIELDS = ["client_status", "client_status_by", "client_rejection_reason"]


class TestClientStatusDeleteLock(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		_make_user(PMO_USER, PMO_EXECUTIVE_PROFILE, ("Nirmaan PMO Executive",))
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

	def _marked_row(self, client_status, reason=""):
		return _raw(
			ROW,
			tdsi_project_id=self.project,
			tds_item_id="TDSI-0001",
			tds_item_name="Gate Valve",
			tds_make="MakeN",
			tds_status="Approved",
			client_status=client_status,
			client_status_by=PMO_USER,
			client_status_on="2026-01-01 10:00:00",
			client_rejection_reason=reason,
		)

	def _stored(self, row):
		return frappe.db.get_value(ROW, row, ["tds_status", *CLIENT_FIELDS], as_dict=True)

	def _assert_untouched(self, row, client_status, reason=""):
		stored = self._stored(row)
		self.assertIsNotNone(stored, "the row was deleted")
		self.assertEqual(
			(stored.tds_status, stored.client_status, stored.client_status_by, stored.client_rejection_reason or ""),
			("Approved", client_status, PMO_USER, reason),
		)

	def test_an_admin_cannot_delete_a_row_the_client_has_answered(self):
		for client_status in (CLIENT_STATUS_APPROVED, CLIENT_STATUS_REJECTED):
			with self.subTest(client_status=client_status):
				row = self._marked_row(client_status, reason="Wrong colour")

				with self.assertRaises(frappe.ValidationError) as caught:
					frappe.delete_doc(ROW, row)

				self.assertIn("Client Status", str(caught.exception))
				self._assert_untouched(row, client_status, reason="Wrong colour")

	def test_a_pmo_executive_cannot_delete_a_row_the_client_has_answered(self):
		row = self._marked_row(CLIENT_STATUS_APPROVED)
		frappe.set_user(PMO_USER)

		with self.assertRaises(frappe.ValidationError):
			frappe.delete_doc(ROW, row)

		frappe.set_user("Administrator")
		self._assert_untouched(row, CLIENT_STATUS_APPROVED)

	def test_a_rest_delete_is_refused_too(self):
		# `frappe.client.delete` is what `DELETE /api/resource/<doctype>/<name>` runs.
		row = self._marked_row(CLIENT_STATUS_REJECTED)
		frappe.set_user(PMO_USER)

		with self.assertRaises(frappe.ValidationError):
			frappe.client.delete(ROW, row)

		frappe.set_user("Administrator")
		self._assert_untouched(row, CLIENT_STATUS_REJECTED)

	def test_once_an_admin_clears_the_client_status_the_row_can_be_deleted(self):
		row = self._marked_row(CLIENT_STATUS_REJECTED, reason="Wrong colour")

		out = set_client_status([row], ACTION_CLEAR)
		self.assertEqual(out["updated"], 1)
		frappe.set_user(PMO_USER)
		frappe.delete_doc(ROW, row)

		frappe.set_user("Administrator")
		self.assertFalse(frappe.db.exists(ROW, row))
