# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""`approve_tds_items`: what approving each kind of Project TDS row stores (#1377).

Each test reads the stored rows, Repository Entries and TDS Items afterwards. Fixtures are raw
inserts inside a transaction whose commits are stubbed and which is rolled back in `tearDown`; the
project is a real Projects row made once per class.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.tds.approve import approve_tds_items
from nirmaan_stack.api.tds.test_submit import _cloud_url, _create_project, _make_user, _raw
from nirmaan_stack.services.role_profiles import PMO_EXECUTIVE_PROFILE

ROW = "Project TDS Item List"
PMO_USER = "tds-approve-pmo@example.com"


class TestApproveTdsItems(FrappeTestCase):
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
		self.wp = f"TEST WP {frappe.generate_hash(length=4)}"
		_raw("Procurement Packages", name=self.wp, work_package_name=self.wp)
		self.item = _raw("TDS Items", tds_item_name="Gate Valve", work_package=self.wp)

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.commit = self._real_commit
		frappe.db.rollback()

	def _row(self, status, item_id, make="MakeN", name="Gate Valve", **fields):
		return _raw(
			ROW,
			tdsi_project_id=self.project,
			tds_item_id=item_id,
			tds_item_name=name,
			tds_make=make,
			tds_work_package=self.wp,
			tds_status=status,
			**fields,
		)

	def _catalogue_size(self):
		return (frappe.db.count("TDS Items"), frappe.db.count("TDS Repository"))

	def test_approving_a_project_custom_row_only_marks_it_approved(self):
		sheet = _cloud_url("facade-light.pdf")
		row = self._row(
			"Pending", "PCUS-000001", name="Facade Light", tds_category="Lighting", tds_attachment=sheet
		)
		before = self._catalogue_size()

		out = approve_tds_items([row])

		self.assertEqual(out["errors"], [])
		self.assertEqual(out["summary"]["approved"], 1)
		stored = frappe.db.get_value(
			ROW, row, ["tds_status", "tds_item_id", "tds_category", "tds_attachment"], as_dict=True
		)
		self.assertEqual(
			(stored.tds_status, stored.tds_item_id, stored.tds_category, stored.tds_attachment),
			("Approved", "PCUS-000001", "Lighting", sheet),
		)
		self.assertEqual(self._catalogue_size(), before)

	def test_a_new_row_with_no_tds_item_is_refused(self):
		for item_id in ("", "TDS-ITEM-NOPE"):
			with self.subTest(item_id=item_id):
				row = self._row("New", item_id, name="Brand New Thing")
				before = self._catalogue_size()

				out = approve_tds_items([row])

				self.assertEqual([e["name"] for e in out["errors"]], [row])
				self.assertEqual(out["summary"]["approved"], 0)
				self.assertEqual(frappe.db.get_value(ROW, row, "tds_status"), "New")
				self.assertEqual(self._catalogue_size(), before)

	def test_a_new_make_with_no_entry_creates_a_verified_entry(self):
		sheet = _cloud_url("gate-valve-n.pdf")
		row = self._row("New", self.item, tds_attachment=sheet)

		out = approve_tds_items([row])

		self.assertEqual(out["errors"], [])
		self.assertEqual(frappe.db.get_value(ROW, row, "tds_status"), "Approved")
		entry = frappe.db.get_value(
			"TDS Repository", {"tds_item": self.item, "make": "MakeN"}, ["status", "tds_attachment"], as_dict=True
		)
		self.assertEqual((entry.status, entry.tds_attachment), ("Verified", sheet))

	def test_only_admin_may_approve(self):
		row = self._row("Pending", "PCUS-000001", name="Facade Light")
		frappe.set_user(PMO_USER)
		with self.assertRaises(frappe.PermissionError):
			approve_tds_items([row])
		frappe.set_user("Administrator")
		self.assertEqual(frappe.db.get_value(ROW, row, "tds_status"), "Pending")
