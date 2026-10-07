# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""`approve_tds_items`: what approving each kind of Project TDS row stores (#1377, #1378).

Each test reads the stored rows, Repository Entries and TDS Items afterwards. Fixtures are raw
inserts inside a transaction whose commits are stubbed and which is rolled back in `tearDown`; the
project is a real Projects row made once per class.
"""

import json
from unittest.mock import patch

import frappe
from frappe.model.document import Document
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


	# ── A New Make whose entry was added after the request was sent (#1378) ──────────────────
	# The Admin chooses which datasheet is correct; the uploaded PDF is never dropped silently.

	def _entry_added_since_request(self, repo_sheet=True):
		"""An existing Not Verified entry (owning its sheet's File) and a New Make row for it."""
		self.repo_sheet = _cloud_url("gate-valve-repo.pdf") if repo_sheet else None
		self.entry = _raw(
			"TDS Repository", tds_item=self.item, make="MakeN", status="Not Verified", tds_attachment=self.repo_sheet
		)
		self.repo_file = _raw(
			"File", file_name="gate-valve-repo.pdf", file_url=self.repo_sheet,
			attached_to_doctype="TDS Repository", attached_to_name=self.entry,
		)
		self.sent_sheet = _cloud_url("gate-valve-sent.pdf")
		self.new_make = self._row("New", self.item, tds_attachment=self.sent_sheet)
		self.sent_file = _raw(
			"File", file_name="gate-valve-sent.pdf", file_url=self.sent_sheet,
			attached_to_doctype=ROW, attached_to_name=self.new_make,
		)

	def _entry(self):
		return frappe.db.get_value("TDS Repository", self.entry, ["status", "tds_attachment"], as_dict=True)

	def _stored(self, row):
		return frappe.db.get_value(ROW, row, ["tds_status", "tds_attachment"], as_dict=True)

	def test_without_a_choice_the_new_make_is_refused_and_the_rest_of_the_batch_approves(self):
		self._entry_added_since_request()
		for choices in (None, {}, {self.new_make: "both"}):
			with self.subTest(choices=choices):
				custom = self._row("Pending", "PCUS-000001", name="Facade Light")

				out = approve_tds_items([self.new_make, custom], datasheet_choices=choices)

				self.assertEqual([e["name"] for e in out["errors"]], [self.new_make])
				self.assertIn("Choose", out["errors"][0]["error"])
				self.assertEqual(self._stored(self.new_make), {"tds_status": "New", "tds_attachment": self.sent_sheet})
				self.assertEqual(self._entry(), {"status": "Not Verified", "tds_attachment": self.repo_sheet})
				self.assertEqual(frappe.db.get_value(ROW, custom, "tds_status"), "Approved")

	def test_repository_choice_verifies_the_entry_and_points_the_row_at_its_sheet(self):
		self._entry_added_since_request()

		out = approve_tds_items([self.new_make], datasheet_choices={self.new_make: "repository"})

		self.assertEqual(out["errors"], [])
		self.assertEqual(out["summary"]["verified_existing"], 1)
		self.assertEqual(self._entry(), {"status": "Verified", "tds_attachment": self.repo_sheet})
		self.assertEqual(self._stored(self.new_make), {"tds_status": "Approved", "tds_attachment": self.repo_sheet})

	def test_repository_choice_is_refused_when_the_entry_has_no_sheet(self):
		self._entry_added_since_request(repo_sheet=False)

		out = approve_tds_items([self.new_make], datasheet_choices={self.new_make: "repository"})

		self.assertEqual([e["name"] for e in out["errors"]], [self.new_make])
		self.assertEqual(self._stored(self.new_make), {"tds_status": "New", "tds_attachment": self.sent_sheet})
		self.assertEqual(self._entry(), {"status": "Not Verified", "tds_attachment": None})

	def test_request_choice_replaces_the_entry_sheet_and_keeps_the_old_file(self):
		self._entry_added_since_request()
		earlier = self._row("Approved", self.item, tds_attachment=self.repo_sheet)

		out = approve_tds_items([self.new_make], datasheet_choices=json.dumps({self.new_make: "request"}))

		self.assertEqual(out["errors"], [])
		self.assertEqual(out["summary"]["replaced_datasheets"], 1)
		self.assertEqual(self._entry(), {"status": "Verified", "tds_attachment": self.sent_sheet})
		self.assertEqual(self._stored(self.new_make), {"tds_status": "Approved", "tds_attachment": self.sent_sheet})
		# The old sheet survives, and the project approved on it still opens it.
		self.assertTrue(frappe.db.exists("File", self.repo_file))
		self.assertEqual(self._stored(earlier), {"tds_status": "Approved", "tds_attachment": self.repo_sheet})
		# The entry now owns the sheet it points at, so deleting this project row can't take it away.
		self.assertEqual(
			frappe.db.get_value("File", self.sent_file, ["attached_to_doctype", "attached_to_name"]),
			("TDS Repository", self.entry),
		)

	def test_a_row_that_fails_part_way_leaves_the_entry_untouched(self):
		self._entry_added_since_request()
		other = self._row("Pending", "PCUS-000001", name="Facade Light")

		with patch.object(Document, "save", _fail_saving(ROW)):
			out = approve_tds_items([self.new_make, other], datasheet_choices={self.new_make: "request"})

		self.assertEqual(sorted(e["name"] for e in out["errors"]), sorted([self.new_make, other]))
		self.assertEqual(self._entry(), {"status": "Not Verified", "tds_attachment": self.repo_sheet})
		self.assertEqual(
			frappe.db.get_value("File", self.sent_file, ["attached_to_doctype", "attached_to_name"]),
			(ROW, self.new_make),
		)


def _fail_saving(doctype):
	"""A `Document.save` that raises for `doctype` and saves everything else as usual."""
	real_save = Document.save

	def save(self, *args, **kwargs):
		if self.doctype == doctype:
			raise frappe.ValidationError("simulated save failure")
		return real_save(self, *args, **kwargs)

	return save
