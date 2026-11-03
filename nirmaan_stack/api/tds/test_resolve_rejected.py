# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""`resolve_rejected_tds`: an Admin or PMO Executive switches a Rejected row to another Repository
make of its TDS Item, and the row waits again as a Pending pick (GLOSSARY "Resolve").

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
	_cloud_url,
	_create_project,
	_delete_project_rows,
	_make_user,
	_raw,
)
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
		self.item = _raw("TDS Items", tds_item_name="Gate Valve", work_package=self.wp)
		self.sheets = {}
		for make in ("MakeA", "MakeB", "MakeC"):
			self.sheets[make] = _cloud_url(f"{self.item}-{make}.pdf")
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
			tds_item_name="Gate Valve",
			tds_make=make,
			tds_work_package=self.wp,
			tds_status=status,
			tds_attachment=self.sheets.get(make) or _cloud_url(f"own-{make}.pdf"),
			**fields,
		)

	def _rejected(self, make="MakeA", **fields):
		return self._row("Rejected", make, tds_rejection_reason="Client wants another brand", **fields)

	def _stored(self, name):
		return frappe.db.get_value(ROW, name, [*STORED, "tds_rejection_reason"], as_dict=True)

	def _assert_refused(self, watched, name, make, exc=frappe.ValidationError, message=None):
		"""The resolve raises `exc`, and every row in `watched` is stored exactly as before."""
		before = {r: self._stored(r) for r in watched}
		with self.assertRaises(exc) as raised:
			resolve_rejected_tds(doc_name=name, make=make)
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
		own = _raw("File", file_name="own.pdf", file_url=_cloud_url("own-MakeN.pdf"), is_private=1,
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

	def test_a_rejected_project_custom_row_is_refused(self):
		row = self._row("Rejected", "Philips", item="PCUS-000001")
		self._assert_refused([row], row, "MakeB", message="Project Custom")

	def test_a_rejected_legacy_row_is_refused(self):
		row = self._row("Rejected", "Old Make", item="ITEM-0042")
		self._assert_refused([row], row, "MakeB", message="not found")
