# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""`edit_tds_request`: an Admin edits a waiting New Make or Project Custom row, and may switch it
between the two (#1379).

Each test reads the stored `Project TDS Item List` row afterwards. Fixtures are raw inserts inside a
transaction whose commits are stubbed and which is rolled back in `tearDown`; the project is a real
Projects row made once per class.
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.tds.edit_request import edit_tds_request
from nirmaan_stack.api.tds.test_submit import (
	_cloud_url,
	_create_project,
	_delete_project_rows,
	_make_user,
	_raw,
)
from nirmaan_stack.services.role_profiles import PMO_EXECUTIVE_PROFILE

ROW = "Project TDS Item List"
PMO_USER = "tds-edit-pmo@example.com"
STORED = [
	"tds_item_id",
	"tds_item_name",
	"tds_make",
	"tds_work_package",
	"tds_category",
	"tds_status",
	"tds_request_id",
	"tds_description",
	"tds_boq_line_item",
	"tds_attachment",
]


class TestEditTdsRequest(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		_make_user(PMO_USER, PMO_EXECUTIVE_PROFILE, ("Nirmaan PMO Executive",))
		cls.project = _create_project()
		cls.other_project = _create_project()
		frappe.db.commit()

	@classmethod
	def tearDownClass(cls):
		for project in (cls.project, cls.other_project):
			_delete_project_rows(project)
			frappe.delete_doc("Projects", project, force=True, ignore_permissions=True)
		frappe.db.commit()
		super().tearDownClass()

	def setUp(self):
		self._real_commit = frappe.db.commit
		frappe.db.commit = lambda *a, **k: None
		frappe.set_user("Administrator")
		self.wp = f"TEST WP {frappe.generate_hash(length=4)}"
		_raw("Procurement Packages", name=self.wp, work_package_name=self.wp)
		self.category = _raw(
			"Category", name=f"Lighting {self.wp}", category_name=f"Lighting {self.wp}", work_package=self.wp
		)
		self.other_wp = f"TEST WP {frappe.generate_hash(length=4)}"
		_raw("Procurement Packages", name=self.other_wp, work_package_name=self.other_wp)
		self.other_category = _raw(
			"Category", name=f"Valves {self.other_wp}", category_name=f"Valves {self.other_wp}", work_package=self.other_wp
		)
		self.item = _raw("TDS Items", tds_item_name="Gate Valve", work_package=self.wp)
		self.sheet = _cloud_url("request.pdf")

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.commit = self._real_commit
		frappe.db.rollback()

	# ── helpers ────────────────────────────────────────────────────────────────

	def _row(self, status, item_id, make="MakeN", name="Gate Valve", project=None, **fields):
		return _raw(
			ROW,
			tdsi_project_id=project or self.project,
			tds_request_id="RQ-TST-01",
			tds_item_id=item_id,
			tds_item_name=name,
			tds_make=make,
			tds_work_package=self.wp,
			tds_status=status,
			tds_attachment=self.sheet,
			**fields,
		)

	def _new_make_row(self, **fields):
		return self._row("New", self.item, **fields)

	def _custom_row(self, item_id="PCUS-000001", name="Facade Light", make="Philips", status="Pending", **fields):
		return self._row(status, item_id, make=make, name=name, tds_category=self.category, **fields)

	def _edit(self, name, **row):
		return edit_tds_request(doc_name=name, row=json.dumps(row))

	def _as_custom(self, name="Facade Light", make="Philips", **extra):
		return {
			"is_project_custom": True,
			"tds_item_name": name,
			"work_package": self.wp,
			"category": self.category,
			"make": make,
			"description": "IP66, 3000K",
			"tds_boq_line_item": "BOQ 7.1",
			"tds_attachment": self.sheet,
			**extra,
		}

	def _as_new_make(self, item=None, make="MakeN", **extra):
		return {
			"is_project_custom": False,
			"tds_item_id": self.item if item is None else item,
			"make": make,
			"description": "needs a sheet",
			"tds_boq_line_item": "",
			"tds_attachment": self.sheet,
			**extra,
		}

	def _stored(self, name):
		return frappe.db.get_value(ROW, name, STORED, as_dict=True)

	def _upload(self, owner="Administrator"):
		"""A datasheet the editor uploaded and has not attached yet."""
		url = _cloud_url(f"edit-{frappe.generate_hash(length=6)}.pdf")
		name = _raw("File", file_name="edit.pdf", file_url=url, is_private=1)
		frappe.db.set_value("File", name, "owner", owner, update_modified=False)
		return url

	def _assert_refused(self, name, row, exc=frappe.ValidationError):
		before = self._stored(name)
		with self.assertRaises(exc):
			self._edit(name, **row)
		self.assertEqual(self._stored(name), before)

	# ── switching to Project Custom ────────────────────────────────────────────

	def test_switching_a_new_make_to_project_custom_stores_a_pending_pcus_row(self):
		row = self._new_make_row()

		self._edit(row, **self._as_custom())

		stored = self._stored(row)
		self.assertEqual(stored.tds_status, "Pending")
		self.assertEqual(stored.tds_item_id, "PCUS-000001")
		self.assertEqual(
			(stored.tds_item_name, stored.tds_work_package, stored.tds_category, stored.tds_make),
			("Facade Light", self.wp, self.category, "Philips"),
		)
		self.assertEqual((stored.tds_description, stored.tds_boq_line_item), ("IP66, 3000K", "BOQ 7.1"))
		self.assertEqual(stored.tds_request_id, "RQ-TST-01")
		self.assertEqual(stored.tds_attachment, self.sheet)
		self.assertFalse(frappe.db.exists("TDS Items", {"tds_item_name": "Facade Light"}))

	def test_switching_to_project_custom_reuses_the_pcus_id_of_the_same_name(self):
		self._custom_row("PCUS-000004", name="Facade Light", make="Wipro")
		self._custom_row("PCUS-000007", name="Cove Strip", make="Wipro")
		row = self._new_make_row()

		self._edit(row, **self._as_custom(name="  FACADE light "))
		self.assertEqual(self._stored(row).tds_item_id, "PCUS-000004")

		other = self._new_make_row(make="MakeM")
		self._edit(other, **self._as_custom(name="Brand New Light", make="MakeM"))
		self.assertEqual(self._stored(other).tds_item_id, "PCUS-000008")

	def test_switching_to_project_custom_needs_a_category_under_the_work_package(self):
		row = self._new_make_row()
		for category in ("", self.other_category, "No Such Category"):
			with self.subTest(category=category):
				self._assert_refused(row, self._as_custom(category=category))

	def test_switching_to_project_custom_needs_a_name_and_work_package(self):
		row = self._new_make_row()
		for missing in ("tds_item_name", "work_package"):
			with self.subTest(missing=missing):
				self._assert_refused(row, self._as_custom(**{missing: ""}))

	# ── switching to New Make ──────────────────────────────────────────────────

	def test_switching_a_project_custom_row_to_new_make_drops_the_pcus_id(self):
		row = self._custom_row()

		self._edit(row, **self._as_new_make(make="Philips"))

		stored = self._stored(row)
		self.assertEqual(stored.tds_status, "New")
		self.assertEqual(stored.tds_item_id, self.item)
		self.assertEqual(
			(stored.tds_item_name, stored.tds_work_package, stored.tds_make),
			("Gate Valve", self.wp, "Philips"),
		)
		# The chosen Category belonged to the custom item: the save hook re-derives it from the
		# TDS Item's members, and this one has none.
		self.assertFalse(stored.tds_category)

	def test_switching_to_new_make_needs_an_existing_tds_item(self):
		row = self._custom_row()
		for item in ("", "TDS-ITEM-NOPE"):
			with self.subTest(item=item):
				self._assert_refused(row, self._as_new_make(item=item, make="Philips"))

	# ── edits without a switch ─────────────────────────────────────────────────

	def test_editing_a_project_custom_row_keeps_its_pcus_id(self):
		row = self._custom_row("PCUS-000003")

		self._edit(row, **self._as_custom(make="Wipro"))

		stored = self._stored(row)
		self.assertEqual((stored.tds_item_id, stored.tds_make, stored.tds_status), ("PCUS-000003", "Wipro", "Pending"))

	def test_saving_a_row_unchanged_is_not_a_duplicate_of_itself(self):
		row = self._new_make_row()
		self._edit(row, **self._as_new_make())
		self.assertEqual(self._stored(row).tds_status, "New")

	def test_a_new_datasheet_is_attached_to_the_row(self):
		row = self._new_make_row()
		url = self._upload()

		self._edit(row, **self._as_new_make(tds_attachment=url))

		self.assertEqual(self._stored(row).tds_attachment, url)
		self.assertEqual(
			frappe.db.get_value("File", {"file_url": url}, ["attached_to_doctype", "attached_to_name"]),
			(ROW, row),
		)

	def test_a_datasheet_that_is_neither_the_rows_nor_the_editors_upload_is_refused(self):
		row = self._new_make_row()
		for url in ("", _cloud_url("never-uploaded.pdf"), self._upload(owner=PMO_USER)):
			with self.subTest(url=url):
				self._assert_refused(row, self._as_new_make(tds_attachment=url))

	# ── duplicates ─────────────────────────────────────────────────────────────

	def test_a_switch_that_duplicates_a_live_row_on_the_project_is_refused(self):
		custom = self._custom_row(name="Facade Light", make="Philips")
		self._row("Approved", self.item, make="MakeA")
		new_make = self._new_make_row(make="Philips")
		self._assert_refused(new_make, self._as_custom(name="facade LIGHT", make="Philips"))
		self._assert_refused(custom, self._as_new_make(make="MakeA"))

	def test_a_rejected_or_another_projects_row_is_no_duplicate(self):
		self._custom_row(name="Facade Light", make="Philips", status="Rejected")
		self._custom_row(name="Facade Light", make="Philips", project=self.other_project)
		row = self._new_make_row(make="Philips")

		self._edit(row, **self._as_custom())

		self.assertEqual(self._stored(row).tds_item_id, "PCUS-000001")

	def test_a_replaced_rejected_row_is_deleted(self):
		rejected = self._row("Rejected", "PCUS-000001", make="Philips", name="Facade Light")
		row = self._new_make_row(make="Philips")

		self._edit(row, **self._as_custom(previous_doc_name=rejected))

		self.assertFalse(frappe.db.exists(ROW, rejected))
		self.assertEqual(self._stored(row).tds_item_id, "PCUS-000001")

	# ── who and what may be edited ─────────────────────────────────────────────

	def test_anyone_but_admin_is_refused(self):
		row = self._new_make_row()
		frappe.set_user(PMO_USER)
		try:
			with self.assertRaises(frappe.PermissionError):
				self._edit(row, **self._as_custom())
		finally:
			frappe.set_user("Administrator")
		self.assertEqual(self._stored(row).tds_status, "New")

	def test_a_from_repository_or_decided_row_is_refused(self):
		rows = {
			"from repository": self._row("Pending", self.item, make="MakeA"),
			"approved": self._custom_row(status="Approved", make="Havells"),
			"rejected": self._row("Rejected", self.item, make="MakeR"),
		}
		for label, row in rows.items():
			with self.subTest(label):
				# A make of its own, so a case wrongly let through can't block the next as a duplicate.
				self._assert_refused(row, self._as_custom(make=f"Bajaj {label}"))
		with self.assertRaises(frappe.ValidationError):
			self._edit("no-such-row", **self._as_custom())
