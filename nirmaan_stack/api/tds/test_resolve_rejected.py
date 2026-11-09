# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""`resolve_rejected_tds`: an Admin or PMO Executive switches a Rejected row to another Repository
make of its TDS Item, or edits a Project Custom row as a request (it stays Project Custom), and the
row waits again as Pending (GLOSSARY "Resolve").

Each test reads the stored `Project TDS Item List` row afterwards. Fixtures are raw inserts inside a
transaction whose commits are stubbed and which is rolled back in `tearDown`; the projects are real
Projects rows made once per class.
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.tds.edit_request import resolve_rejected_tds
from nirmaan_stack.api.tds.test_edit_request import PMO_USER, STORED
from nirmaan_stack.api.tds.test_submit import (
	PM_USER,
	_create_project,
	_delete_project_rows,
	_make_user,
	_raw,
)
from nirmaan_stack.cloud_file_fixture import cloud_url
from nirmaan_stack.services.role_profiles import PMO_EXECUTIVE_PROFILE

ROW = "Project TDS Item List"


class TestResolveRejectedTds(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		_make_user(PMO_USER, PMO_EXECUTIVE_PROFILE, ("Nirmaan PMO Executive",))
		_make_user(PM_USER, "Nirmaan Project Manager Profile", ("Nirmaan Project Manager",))
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
		# Trashing a File calls the storage app's delete; record it instead of reaching the bucket.
		self.cloud_delete = patch("frappe_gcp_attachment.controller.delete_from_cloud").start()
		self.addCleanup(patch.stopall)
		frappe.set_user("Administrator")
		self.wp = f"TEST WP {frappe.generate_hash(length=4)}"
		_raw("Procurement Packages", name=self.wp, work_package_name=self.wp)
		self.category = _raw(
			"Category", name=f"Lighting {self.wp}", category_name=f"Lighting {self.wp}", work_package=self.wp
		)
		self.item = _raw("TDS Items", tds_item_name="Gate Valve", work_package=self.wp)
		# A Project Custom row's new make comes from the Makelist.
		self.new_make = f"TEST Make {frappe.generate_hash(length=4)}"
		_raw("Makelist", name=self.new_make, make_name=self.new_make)
		self.sheets = {}
		for make in ("MakeA", "MakeB", "MakeC"):
			self.sheets[make] = cloud_url(f"{self.item}-{make}.pdf")
			_raw("TDS Repository", tds_item=self.item, make=make, status="Verified", tds_attachment=self.sheets[make])

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.commit = self._real_commit
		frappe.db.rollback()

	# ── helpers ────────────────────────────────────────────────────────────────

	def _row(self, status, make, item=None, project=None, **fields):
		return _raw(
			ROW,
			tdsi_project_id=project or self.project,
			tds_request_id="RQ-TST-07",
			tds_item_id=item or self.item,
			tds_make=make,
			tds_work_package=self.wp,
			tds_status=status,
			tds_attachment=self.sheets.get(make) or cloud_url(f"own-{make}.pdf"),
			**{"tds_item_name": "Gate Valve", **fields},
		)

	def _rejected(self, make="MakeA", **fields):
		return self._row("Rejected", make, tds_rejection_reason="Client wants another brand", **fields)

	def _custom(self, status="Rejected", make="Philips", name="Facade Light", **fields):
		return self._row(
			status, make, item="PCUS-000001", tds_item_name=name, tds_category=self.category,
			tds_rejection_reason="Client wants another brand", **fields,
		)

	def _upload(self, owner="Administrator"):
		"""A datasheet the resolver uploaded and has not attached yet."""
		url = cloud_url(f"resolve-{frappe.generate_hash(length=6)}.pdf")
		name = _raw("File", file_name="resolve.pdf", file_url=url, is_private=1)
		frappe.db.set_value("File", name, "owner", owner, update_modified=False)
		return name, url

	def _stored(self, name):
		return frappe.db.get_value(ROW, name, [*STORED, "tds_rejection_reason"], as_dict=True)

	def _assert_refused(self, watched, name, make, exc=frappe.ValidationError, message=None, sheet=None, custom=None):
		"""The resolve raises `exc`, and every row in `watched` is stored exactly as before."""
		before = {r: self._stored(r) for r in watched}
		with self.assertRaises(exc) as raised:
			resolve_rejected_tds(doc_name=name, make=make, tds_attachment=sheet, custom=custom)
		if message:
			self.assertIn(message, str(raised.exception))
		self.assertEqual({r: self._stored(r) for r in watched}, before)

	# ── the resolve ────────────────────────────────────────────────────────────

	def test_resolving_switches_the_make_and_sends_the_row_back_as_a_pending_pick(self):
		row = self._rejected(tds_boq_line_item="BOQ 4.2", tds_description="DN50")

		result = resolve_rejected_tds(doc_name=row, make="MakeB")

		stored = self._stored(row)
		self.assertEqual(result["tds_status"], "Pending")
		self.assertEqual((stored.tds_make, stored.tds_status), ("MakeB", "Pending"))
		self.assertEqual(stored.tds_attachment, self.sheets["MakeB"])
		# Only the make changes: the request id, BOQ Ref, description and the old reason stay.
		self.assertEqual(
			(stored.tds_request_id, stored.tds_item_id, stored.tds_boq_line_item, stored.tds_description),
			("RQ-TST-07", self.item, "BOQ 4.2", "DN50"),
		)
		self.assertEqual(stored.tds_rejection_reason, "Client wants another brand")

	def test_a_rejected_new_make_loses_its_own_upload(self):
		row = self._rejected(make="MakeN")  # no Repository Entry: the row carries its own upload
		own = _raw("File", file_name="own.pdf", file_url=cloud_url("own-MakeN.pdf"), is_private=1,
			attached_to_doctype=ROW, attached_to_name=row, attached_to_field="tds_attachment")
		entry_sheet = _raw("File", file_name="entry.pdf", file_url=self.sheets["MakeA"], is_private=1,
			attached_to_doctype="TDS Repository", attached_to_name="entry", attached_to_field="tds_attachment")

		resolve_rejected_tds(doc_name=row, make="MakeA")

		self.assertEqual(self._stored(row).tds_attachment, self.sheets["MakeA"])
		self.assertFalse(frappe.db.exists("File", own))
		# The Repository Entry's sheet the row now borrows is not the row's to delete.
		self.assertTrue(frappe.db.exists("File", entry_sheet))

	def test_a_pmo_executive_can_resolve(self):
		row = self._rejected()
		frappe.set_user(PMO_USER)

		resolve_rejected_tds(doc_name=row, make="MakeB")

		self.assertEqual(self._stored(row).tds_make, "MakeB")

	# ── refusals ───────────────────────────────────────────────────────────────

	def test_anyone_but_admin_or_pmo_is_refused(self):
		row = self._rejected()
		frappe.set_user(PM_USER)
		try:
			self._assert_refused([row], row, "MakeB", exc=frappe.PermissionError)
		finally:
			frappe.set_user("Administrator")

	def test_the_rows_own_make_is_refused(self):
		row = self._rejected()
		self._assert_refused([row], row, "MakeA", message="other than MakeA")

	def test_a_make_with_no_repository_entry_is_refused(self):
		row = self._rejected()
		self._assert_refused([row], row, "MakeZ", message="no datasheet for make MakeZ")

	def test_a_make_already_on_the_project_at_any_status_is_refused(self):
		row = self._rejected()
		for status in ("Pending", "New", "Approved", "Rejected"):
			with self.subTest(status=status):
				other = self._row(status, "MakeB")
				self._assert_refused([row, other], row, "MakeB", message="already on this project")
				frappe.db.delete(ROW, other)

	def test_the_same_make_on_another_project_is_no_duplicate(self):
		row = self._rejected()
		self._row("Rejected", "MakeB", project=self.other_project)
		self._row("Approved", "MakeC", project=self.other_project)

		resolve_rejected_tds(doc_name=row, make="MakeB")

		self.assertEqual(self._stored(row).tds_make, "MakeB")

	def test_a_row_that_is_not_rejected_is_refused_naming_its_status(self):
		for status, shown in (("Pending", "Pending"), ("New", "Pending"), ("Approved", "Approved by Admin")):
			with self.subTest(status=status):
				row = self._row(status, "MakeA")
				self._assert_refused([row], row, "MakeB", message=f"this one is {shown}")

	def test_a_repository_row_takes_no_uploaded_datasheet(self):
		row = self._rejected()
		_, url = self._upload()
		self._assert_refused([row], row, "MakeB", sheet=url, message="from the Repository")

	# ── Project Custom rows ────────────────────────────────────────────────────

	def test_a_custom_row_takes_a_new_make_and_its_new_datasheet(self):
		row = self._custom(tds_boq_line_item="BOQ 9.1")
		old_url = self._stored(row).tds_attachment
		old = _raw("File", file_name="old.pdf", file_url=old_url, is_private=1,
			attached_to_doctype=ROW, attached_to_name=row, attached_to_field="tds_attachment")
		new, url = self._upload()

		resolve_rejected_tds(doc_name=row, make=self.new_make, tds_attachment=url)

		stored = self._stored(row)
		self.assertEqual(
			(stored.tds_item_id, stored.tds_item_name, stored.tds_make, stored.tds_status, stored.tds_attachment),
			("PCUS-000001", "Facade Light", self.new_make, "Pending", url),
		)
		self.assertEqual(
			(stored.tds_request_id, stored.tds_category, stored.tds_boq_line_item),
			("RQ-TST-07", self.category, "BOQ 9.1"),
		)
		self.assertEqual(stored.tds_rejection_reason, "Client wants another brand")
		self.assertEqual(frappe.db.get_value("File", new, "attached_to_name"), row)
		self.assertFalse(frappe.db.exists("File", old))

	def test_a_custom_row_keeps_its_make_with_a_new_datasheet(self):
		row = self._custom()
		_, url = self._upload()

		resolve_rejected_tds(doc_name=row, make="Philips", tds_attachment=url)

		stored = self._stored(row)
		self.assertEqual((stored.tds_make, stored.tds_status, stored.tds_attachment), ("Philips", "Pending", url))

	def test_a_custom_make_change_keeps_the_current_datasheet(self):
		row = self._custom()
		current = self._stored(row).tds_attachment

		resolve_rejected_tds(doc_name=row, make=self.new_make)

		stored = self._stored(row)
		self.assertEqual((stored.tds_make, stored.tds_status, stored.tds_attachment), (self.new_make, "Pending", current))

	def test_a_custom_row_is_edited_like_a_request(self):
		other_wp = f"TEST WP {frappe.generate_hash(length=4)}"
		_raw("Procurement Packages", name=other_wp, work_package_name=other_wp)
		other_category = _raw("Category", name=f"Valves {other_wp}", category_name=f"Valves {other_wp}", work_package=other_wp)
		row = self._custom()
		current = self._stored(row).tds_attachment
		edit = {
			"tds_item_name": "Gate Valve DN50",
			"work_package": other_wp,
			"category": other_category,
			"tds_boq_line_item": "BOQ 2.4",
			"description": "PN16",
		}

		resolve_rejected_tds(doc_name=row, make="Philips", custom=edit)

		stored = self._stored(row)
		self.assertEqual(
			(stored.tds_item_name, stored.tds_work_package, stored.tds_category, stored.tds_boq_line_item, stored.tds_description),
			("Gate Valve DN50", other_wp, other_category, "BOQ 2.4", "PN16"),
		)
		# A new name is a new Project Custom item on the project; the datasheet and request id stay.
		self.assertEqual((stored.tds_item_id, stored.tds_status), ("PCUS-000002", "Pending"))
		self.assertEqual((stored.tds_attachment, stored.tds_request_id), (current, "RQ-TST-07"))

	def test_a_rename_to_a_custom_item_on_the_project_joins_it(self):
		row = self._custom()
		self._row("Approved", "Havells", item="PCUS-000005", tds_item_name="Cove Strip", tds_category=self.category)

		resolve_rejected_tds(doc_name=row, make="Philips", custom={"tds_item_name": " cove STRIP "})

		self.assertEqual(self._stored(row).tds_item_id, "PCUS-000005")

	def test_a_custom_edit_needs_a_name_package_and_category_under_it(self):
		row = self._custom()
		other_wp = f"TEST WP {frappe.generate_hash(length=4)}"
		_raw("Procurement Packages", name=other_wp, work_package_name=other_wp)
		cases = {
			"no name": ({"tds_item_name": "  "}, "needs a name"),
			"no category": ({"category": ""}, "needs a name"),
			"category under another package": ({"work_package": other_wp}, "is not under Work Package"),
		}
		for label, (custom, message) in cases.items():
			with self.subTest(label):
				self._assert_refused([row], row, "Philips", custom=custom, message=message)

	def test_a_custom_resolve_that_changes_nothing_is_refused(self):
		row = self._custom()
		stored = self._stored(row)
		unchanged = {"tds_item_name": " Facade Light ", "work_package": stored.tds_work_package, "category": self.category}
		self._assert_refused([row], row, "Philips", sheet=stored.tds_attachment, custom=unchanged, message="Change something")

	def test_a_repository_row_takes_no_custom_details(self):
		row = self._rejected()
		self._assert_refused([row], row, "MakeB", custom={"tds_item_name": "Other"}, message="Project Custom")

	def test_a_custom_make_not_in_the_makelist_is_refused(self):
		row = self._custom()
		_, url = self._upload()
		self._assert_refused([row], row, "Not A Real Make", sheet=url, message="not in the make list")

	def test_a_custom_datasheet_the_resolver_did_not_upload_is_refused(self):
		row = self._custom()
		_, someone_elses = self._upload(owner=PMO_USER)
		self._assert_refused([row], row, self.new_make, sheet=someone_elses, message="Attach the datasheet")

	def test_a_custom_name_and_make_already_on_the_project_is_refused(self):
		row = self._custom()
		_, url = self._upload()
		for status in ("Pending", "Approved", "Rejected"):
			with self.subTest(status=status):
				# The same name ignoring case and spaces is the same Project Custom item.
				other = self._custom(status=status, make=self.new_make, name=" FACADE light ")
				self._assert_refused([row, other], row, self.new_make, sheet=url, message="already on this project")
				frappe.db.delete(ROW, other)

	def test_a_rejected_legacy_row_is_refused(self):
		row = self._row("Rejected", "Old Make", item="ITEM-0042")
		self._assert_refused([row], row, "MakeB", message="not found")
