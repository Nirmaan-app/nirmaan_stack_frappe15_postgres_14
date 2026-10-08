# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""`submit_tds_request`: Project TDS "Send For Approval", all rows or none (#1374).

Each test reads the stored `Project TDS Item List` rows, never the endpoint's own return value
alone. Catalogue fixtures are raw inserts inside a transaction whose commits are stubbed and which
is rolled back in `tearDown`; the project is a real Projects row made once per class.
"""

import json
import threading
import time
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.tds.submit import submit_tds_request
from nirmaan_stack.services.role_profiles import PMO_EXECUTIVE_PROFILE

ROW = "Project TDS Item List"
PMO_USER = "tds-submit-pmo@example.com"
PM_USER = "tds-submit-pm@example.com"


def _raw(doctype, **fields):
	doc = frappe.new_doc(doctype)
	doc.update(fields)
	doc.name = fields.get("name") or frappe.generate_hash(length=12)
	doc.db_insert()
	return doc.name


def _cloud_url(file_name):
	"""A stored datasheet URL as production has it: the storage app rewrites every upload to an
	`/api/method/...` URL, so Frappe's own on_update `attach_files_to_document` (which only reads
	`/files` and `/private/files`) never touches it. Re-linking the upload is the endpoint's job."""
	return f"/api/method/frappe_gcp_attachment.controller.generate_file?key={file_name}&file_name={file_name}"


def _make_user(email, profile, roles):
	"""A test actor on both axes: Frappe Roles (DocPerms) and the Nirmaan role profile (gates).
	Same shape as `api/expense_requests/test_expense_requests._make_user`."""
	if not frappe.db.exists("User", email):
		u = frappe.new_doc("User")
		u.update({"email": email, "first_name": email.split("@")[0], "send_welcome_email": 0})
		u.flags.no_welcome_mail = True
		u.insert(ignore_permissions=True)
	frappe.get_doc("User", email).add_roles(*roles)
	frappe.db.set_value("Nirmaan Users", email, "role_profile", profile, update_modified=False)


def _create_project():
	project = frappe.new_doc("Projects")
	project.project_name = f"TEST_tds_submit_{frappe.generate_hash(length=6)}"
	project.project_start_date = frappe.utils.now()[:19]
	project.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
	project.project_scopes = {"scopes": []}
	project.insert(ignore_permissions=True)
	return project.name


def _delete_project_rows(project):
	# Fixture cleanup only: rows the tests created carry no Files of their own.
	frappe.db.sql(f'DELETE FROM "tab{ROW}" WHERE tdsi_project_id = %s', (project,))


class TestSubmitTdsRequest(FrappeTestCase):
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
		frappe.set_user("Administrator")
		self.wp = f"TEST WP {frappe.generate_hash(length=4)}"
		self.item = _raw("TDS Items", tds_item_name="Gate Valve", work_package=self.wp)
		self.entry_a = _raw(
			"TDS Repository",
			tds_item=self.item,
			make="MakeA",
			status="Verified",
			tds_attachment=_cloud_url("gate-valve-a.pdf"),
		)
		self.entry_b = _raw(
			"TDS Repository",
			tds_item=self.item,
			make="MakeB",
			status="Not Verified",
			tds_attachment=_cloud_url("gate-valve-b.pdf"),
		)
		self.request_prefix = f"RQ-{self.project[-3:]}-"
		# Project Custom fixtures: a Procurement Package with one Category, and a Category under
		# another package.
		_raw("Procurement Packages", name=self.wp, work_package_name=self.wp)
		self.category = _raw("Category", name=f"Lighting {self.wp}", category_name=f"Lighting {self.wp}", work_package=self.wp)
		self.other_wp = f"TEST WP {frappe.generate_hash(length=4)}"
		_raw("Procurement Packages", name=self.other_wp, work_package_name=self.other_wp)
		self.other_category = _raw(
			"Category", name=f"Valves {self.other_wp}", category_name=f"Valves {self.other_wp}", work_package=self.other_wp
		)

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.commit = self._real_commit
		frappe.db.rollback()

	# ── helpers ────────────────────────────────────────────────────────────────

	def _send(self, rows, project=None):
		return submit_tds_request(project=project or self.project, rows=json.dumps(rows))

	def _pick(self, make="MakeA", **extra):
		return {"tds_item_id": self.item, "make": make, "tds_boq_line_item": "", **extra}

	def _upload(self, owner=None):
		"""A datasheet uploaded by the sender and not yet attached to anything."""
		url = _cloud_url(f"request-{frappe.generate_hash(length=6)}.pdf")
		name = _raw("File", file_name="request.pdf", file_url=url, is_private=1)
		# `db_insert` stamps the session user as owner; the uploader is set after.
		frappe.db.set_value("File", name, "owner", owner or frappe.session.user, update_modified=False)
		return url

	def _new_make(self, make="MakeN", owner=None, **extra):
		return {
			"tds_item_id": self.item,
			"make": make,
			"is_new_request": True,
			"description": "needs a sheet",
			"tds_attachment": self._upload(owner),
			**extra,
		}

	def _custom(self, name="Facade Light", make="Philips", owner=None, **extra):
		return {
			"tds_item_id": "",
			"tds_item_name": name,
			"work_package": self.wp,
			"category": self.category,
			"make": make,
			"is_new_request": True,
			"is_project_custom": True,
			"description": "IP66, 3000K",
			"tds_attachment": self._upload(owner),
			**extra,
		}

	def _rows(self, project=None):
		return frappe.get_all(
			ROW,
			filters={"tdsi_project_id": project or self.project},
			fields=[
				"name",
				"tds_item_id",
				"tds_item_name",
				"tds_make",
				"tds_work_package",
				"tds_status",
				"tds_request_id",
				"tds_attachment",
				"tds_description",
				"tds_category",
			],
			order_by="tds_make asc",
		)

	def _existing(self, status, make="MakeA", project=None, item=None, request_id=None, name="Gate Valve"):
		return _raw(
			ROW,
			tdsi_project_id=project or self.project,
			tds_item_id=item or self.item,
			tds_item_name=name,
			tds_make=make,
			tds_status=status,
			tds_request_id=request_id,
		)

	# ── picks ──────────────────────────────────────────────────────────────────

	def test_a_cart_of_picks_saves_one_pending_row_per_item_under_one_request_id(self):
		out = self._send([self._pick("MakeA"), self._pick("MakeB", tds_boq_line_item="BOQ 4.2")])

		rows = self._rows()
		self.assertEqual([r.tds_make for r in rows], ["MakeA", "MakeB"])
		self.assertEqual({r.tds_status for r in rows}, {"Pending"})
		self.assertEqual({r.tds_request_id for r in rows}, {f"{self.request_prefix}01"})
		self.assertEqual(out["request_id"], f"{self.request_prefix}01")
		# Snapshot comes from the catalogue, not from the browser.
		self.assertEqual(rows[0].tds_item_name, "Gate Valve")
		self.assertEqual(rows[0].tds_work_package, self.wp)
		self.assertEqual(rows[0].tds_attachment, _cloud_url("gate-valve-a.pdf"))
		self.assertEqual(rows[1].tds_attachment, _cloud_url("gate-valve-b.pdf"))
		self.assertEqual(frappe.db.get_value(ROW, rows[1].name, "tds_boq_line_item"), "BOQ 4.2")

	def test_the_request_id_continues_the_projects_series(self):
		self._existing("Approved", make="Old", request_id=f"{self.request_prefix}07")
		self._existing("Approved", make="Older", request_id=f"{self.request_prefix}03")
		# Another project's series is not this project's.
		self._existing(
			"Approved", make="Other", project=self.other_project, request_id=f"{self.request_prefix}40"
		)

		self._send([self._pick()])

		row = next(r for r in self._rows() if r.tds_make == "MakeA")
		self.assertEqual(row.tds_request_id, f"{self.request_prefix}08")

	def test_a_pick_with_no_repository_entry_is_refused(self):
		with self.assertRaises(frappe.ValidationError):
			self._send([self._pick("MakeZ")])
		self.assertEqual(self._rows(), [])

	# ── Request New ────────────────────────────────────────────────────────────

	def test_a_new_make_request_saves_a_new_row_with_its_datasheet_attached(self):
		row_in = self._new_make()
		self._send([row_in])

		(row,) = self._rows()
		self.assertEqual(row.tds_status, "New")
		self.assertEqual(row.tds_make, "MakeN")
		self.assertEqual(row.tds_item_name, "Gate Valve")
		self.assertEqual(row.tds_description, "needs a sheet")
		self.assertEqual(row.tds_attachment, row_in["tds_attachment"])
		file_doc = frappe.db.get_value(
			"File",
			{"file_url": row_in["tds_attachment"]},
			["attached_to_doctype", "attached_to_name", "attached_to_field"],
			as_dict=True,
		)
		self.assertEqual(
			(file_doc.attached_to_doctype, file_doc.attached_to_name, file_doc.attached_to_field),
			(ROW, row.name, "tds_attachment"),
		)

	def test_a_request_with_no_tds_item_is_refused(self):
		"""The brand-new shared TDS Item path is gone: a project asks for a Project Custom Item."""
		with self.assertRaises(frappe.ValidationError):
			self._send(
				[
					{
						"tds_item_id": "",
						"tds_item_name": "Brand New Thing",
						"work_package": self.wp,
						"make": "MakeQ",
						"is_new_request": True,
						"tds_attachment": self._upload(),
					}
				]
			)
		self.assertEqual(self._rows(), [])

	def test_a_request_without_an_uploaded_datasheet_is_refused(self):
		for attachment in ("", _cloud_url("never-uploaded.pdf")):
			with self.subTest(attachment=attachment):
				with self.assertRaises(frappe.ValidationError):
					self._send([self._new_make(tds_attachment=attachment)])
				self.assertEqual(self._rows(), [])

	def test_someone_elses_or_an_attached_upload_is_refused(self):
		someone_else = self._new_make(owner=PM_USER)
		attached = self._new_make()
		frappe.db.set_value(
			"File",
			{"file_url": attached["tds_attachment"]},
			{"attached_to_doctype": "TDS Repository", "attached_to_name": self.entry_a},
		)
		for row_in in (someone_else, attached):
			with self.subTest(row=row_in["tds_attachment"]):
				with self.assertRaises(frappe.ValidationError):
					self._send([row_in])
				self.assertEqual(self._rows(), [])

	def test_request_new_is_refused_for_anyone_but_admin_or_pmo(self):
		frappe.set_user(PM_USER)
		with self.assertRaises(frappe.PermissionError):
			self._send([self._new_make(owner=PM_USER)])
		frappe.set_user("Administrator")
		self.assertEqual(self._rows(), [])

	def test_pmo_may_request_new_and_others_may_still_pick(self):
		frappe.set_user(PMO_USER)
		self._send([self._new_make(owner=PMO_USER)])
		frappe.set_user(PM_USER)
		self._send([self._pick()])
		frappe.set_user("Administrator")

		self.assertEqual(
			[(r.tds_make, r.tds_status) for r in self._rows()],
			[("MakeA", "Pending"), ("MakeN", "New")],
		)

	# ── Project Custom ─────────────────────────────────────────────────────────

	def test_a_project_custom_request_saves_a_pending_row_with_a_pcus_id_and_its_category(self):
		row_in = self._custom()
		out = self._send([row_in])

		(row,) = self._rows()
		self.assertEqual(row.tds_status, "Pending")
		self.assertEqual(row.tds_item_id, "PCUS-000001")
		self.assertEqual(
			(row.tds_item_name, row.tds_work_package, row.tds_category, row.tds_make, row.tds_description),
			("Facade Light", self.wp, self.category, "Philips", "IP66, 3000K"),
		)
		self.assertEqual(row.tds_attachment, row_in["tds_attachment"])
		self.assertEqual(
			frappe.db.get_value("File", {"file_url": row_in["tds_attachment"]}, "attached_to_name"), row.name
		)
		self.assertEqual(out["names"], [row.name])
		# Nothing enters the catalogue.
		self.assertFalse(frappe.db.exists("TDS Items", {"tds_item_name": "Facade Light"}))

	def test_the_same_custom_name_shares_one_pcus_id_and_a_new_name_gets_the_next(self):
		self._send([self._custom(make="Philips"), self._custom(name="  facade LIGHT ", make="Wipro")])
		self._send([self._custom(name="Cove Strip", make="Wipro"), self._custom(name="FACADE light", make="Havells")])

		ids = {(r.tds_item_name.strip().lower(), r.tds_make): r.tds_item_id for r in self._rows()}
		self.assertEqual(
			ids,
			{
				("facade light", "Philips"): "PCUS-000001",
				("facade light", "Wipro"): "PCUS-000001",
				("facade light", "Havells"): "PCUS-000001",
				("cove strip", "Wipro"): "PCUS-000002",
			},
		)

	def test_pcus_ids_continue_past_the_projects_legacy_rows_and_reuse_a_legacy_name(self):
		self._existing("Approved", item="PCUS-000003", name="Plug In Unit", make="Schneider")
		# Another project's series is not this project's.
		self._existing("Approved", item="PCUS-000009", name="Other", make="X", project=self.other_project)

		self._send([self._custom(name="Fresh Item"), self._custom(name="plug in unit", make="Legrand")])

		ids = {r.tds_item_name: r.tds_item_id for r in self._rows() if r.tds_make != "Schneider"}
		self.assertEqual(ids, {"Fresh Item": "PCUS-000004", "plug in unit": "PCUS-000003"})

	def test_the_same_custom_name_and_make_twice_in_one_batch_is_refused(self):
		with self.assertRaises(frappe.ValidationError):
			self._send([self._custom(), self._custom(name="FACADE LIGHT ")])
		self.assertEqual(self._rows(), [])

	def test_a_custom_name_and_make_already_live_on_the_project_is_refused(self):
		for status in ("Pending", "Approved"):
			with self.subTest(status=status):
				existing = self._existing(status, item="PCUS-000001", name="Facade Light", make="Philips")
				with self.assertRaises(frappe.ValidationError):
					self._send([self._custom(name="facade light")])
				self.assertEqual([r.name for r in self._rows()], [existing])
				frappe.db.delete(ROW, existing)

	def test_a_rejected_custom_row_does_not_block_and_lends_its_id(self):
		self._existing("Rejected", item="PCUS-000001", name="Facade Light", make="Philips")
		self._send([self._custom()])
		self.assertEqual(
			sorted((r.tds_item_id, r.tds_status) for r in self._rows()),
			[("PCUS-000001", "Pending"), ("PCUS-000001", "Rejected")],
		)

	def test_a_category_outside_the_chosen_work_package_is_refused(self):
		for category in (self.other_category, "No Such Category"):
			with self.subTest(category=category):
				with self.assertRaises(frappe.ValidationError):
					self._send([self._custom(category=category)])
				self.assertEqual(self._rows(), [])

	def test_a_project_custom_request_needs_name_work_package_category_and_datasheet(self):
		for missing in ("tds_item_name", "work_package", "category", "tds_attachment"):
			with self.subTest(missing=missing):
				with self.assertRaises(frappe.ValidationError):
					self._send([self._custom(**{missing: ""})])
				self.assertEqual(self._rows(), [])

	def test_project_custom_is_refused_for_anyone_but_admin_or_pmo(self):
		frappe.set_user(PM_USER)
		with self.assertRaises(frappe.PermissionError):
			self._send([self._custom(owner=PM_USER, is_new_request=False)])
		frappe.set_user(PMO_USER)
		self._send([self._custom(owner=PMO_USER)])
		frappe.set_user("Administrator")
		self.assertEqual([r.tds_item_id for r in self._rows()], ["PCUS-000001"])

	# ── duplicates ─────────────────────────────────────────────────────────────

	def test_the_same_item_and_make_twice_in_one_batch_is_refused(self):
		for second in (self._pick(), self._new_make(make="MakeA")):
			with self.subTest(second=second.get("is_new_request", False)):
				with self.assertRaises(frappe.ValidationError):
					self._send([self._pick(), second])
				self.assertEqual(self._rows(), [])

	def test_an_item_and_make_already_live_on_the_project_is_refused(self):
		for status in ("Pending", "New", "Approved", None):
			with self.subTest(status=status):
				existing = self._existing(status)
				with self.assertRaises(frappe.ValidationError):
					self._send([self._pick()])
				self.assertEqual([r.name for r in self._rows()], [existing])
				frappe.db.delete(ROW, existing)

	def test_the_same_item_and_make_on_another_project_is_not_a_duplicate(self):
		self._existing("Approved", project=self.other_project)
		self._send([self._pick()])
		self.assertEqual(len(self._rows()), 1)

	# ── replacing a rejected row ───────────────────────────────────────────────

	def test_a_replaced_rejected_row_is_deleted_when_the_send_succeeds(self):
		rejected = self._existing("Rejected")
		self._send([self._pick(previous_doc_name=rejected)])

		rows = self._rows()
		self.assertEqual([(r.tds_make, r.tds_status) for r in rows], [("MakeA", "Pending")])
		self.assertFalse(frappe.db.exists(ROW, rejected))

	def test_a_replace_target_that_is_not_the_same_rejected_row_is_refused(self):
		cases = {
			"not rejected": self._existing("Pending", make="MakeB"),
			"other project": self._existing("Rejected", project=self.other_project),
			"other make": self._existing("Rejected", make="MakeB"),
			"missing": "no-such-row",
		}
		for label, target in cases.items():
			with self.subTest(label):
				before = {r.name for r in self._rows()}
				with self.assertRaises(frappe.ValidationError):
					self._send([self._pick(previous_doc_name=target)])
				self.assertEqual({r.name for r in self._rows()}, before)
				if label != "missing":
					self.assertTrue(frappe.db.exists(ROW, target))

	def test_a_new_make_replaces_its_rejected_row(self):
		"""Request New for a rejected item + make (#1380). The rejected row may have been a pick or
		a New Make; Request Type is not known once a row is rejected."""
		rejected = self._existing("Rejected", make="MakeN")
		row_in = self._new_make(previous_doc_name=rejected)
		self._send([row_in])

		(row,) = self._rows()
		self.assertEqual((row.tds_make, row.tds_status, row.tds_attachment), ("MakeN", "New", row_in["tds_attachment"]))
		self.assertFalse(frappe.db.exists(ROW, rejected))

	def test_a_project_custom_row_replaces_its_rejected_row_by_name_ignoring_case(self):
		rejected = self._existing("Rejected", item="PCUS-000001", name="FACADE light", make="Philips")
		self._send([self._custom(name="Facade Light", previous_doc_name=rejected)])

		(row,) = self._rows()
		self.assertEqual(
			(row.tds_item_id, row.tds_item_name, row.tds_make, row.tds_status),
			("PCUS-000001", "Facade Light", "Philips", "Pending"),
		)
		self.assertFalse(frappe.db.exists(ROW, rejected))

	def test_a_project_custom_row_replaces_a_rejected_row_holding_another_id_for_its_name(self):
		"""Legacy rows may give one name two `PCUS-` ids. The match is name + make, not the id."""
		approved = self._existing("Approved", item="PCUS-000001", name="Facade Light", make="Wipro")
		rejected = self._existing("Rejected", item="PCUS-000002", name="facade light", make="Philips")
		self._send([self._custom(previous_doc_name=rejected)])

		self.assertEqual(
			sorted((r.tds_item_id, r.tds_make, r.tds_status) for r in self._rows()),
			[("PCUS-000001", "Philips", "Pending"), ("PCUS-000001", "Wipro", "Approved")],
		)
		self.assertFalse(frappe.db.exists(ROW, rejected))
		self.assertTrue(frappe.db.exists(ROW, approved))

	def test_a_project_custom_row_may_replace_only_its_own_rejected_row(self):
		cases = {
			"other name": self._existing("Rejected", item="PCUS-000001", name="Cove Strip", make="Philips"),
			"other make": self._existing("Rejected", item="PCUS-000002", name="Facade Light", make="Wipro"),
			"a TDS Item row": self._existing("Rejected", make="Philips", name="Facade Light"),
		}
		for label, target in cases.items():
			with self.subTest(label):
				before = {r.name for r in self._rows()}
				with self.assertRaises(frappe.ValidationError):
					self._send([self._custom(previous_doc_name=target)])
				self.assertEqual({r.name for r in self._rows()}, before)

	def test_a_new_make_may_not_replace_a_rejected_project_custom_row(self):
		rejected = self._existing("Rejected", item="PCUS-000001", name="Gate Valve", make="MakeN")
		with self.assertRaises(frappe.ValidationError):
			self._send([self._new_make(previous_doc_name=rejected)])
		self.assertEqual([r.name for r in self._rows()], [rejected])

	def test_a_failed_resubmit_keeps_the_rejected_row(self):
		cases = {
			"new make": (dict(make="MakeN"), self._new_make),
			"project custom": (dict(item="PCUS-000001", name="Facade Light", make="Philips"), self._custom),
		}
		for label, (rejected_fields, resubmit) in cases.items():
			with self.subTest(label):
				rejected = self._existing("Rejected", **rejected_fields)
				row_in = resubmit(previous_doc_name=rejected)
				with patch("frappe.delete_doc", side_effect=frappe.ValidationError("disk on fire")):
					with self.assertRaises(frappe.ValidationError):
						self._send([row_in])

				self.assertEqual([r.name for r in self._rows()], [rejected])
				self.assertEqual(frappe.db.get_value(ROW, rejected, "tds_status"), "Rejected")
				frappe.db.delete(ROW, rejected)

	def test_nothing_is_saved_when_a_write_fails_part_way(self):
		rejected = self._existing("Rejected")
		with patch("frappe.delete_doc", side_effect=frappe.ValidationError("disk on fire")):
			with self.assertRaises(frappe.ValidationError):
				self._send([self._new_make(), self._pick(previous_doc_name=rejected)])

		self.assertEqual([r.name for r in self._rows()], [rejected])
		self.assertEqual(frappe.db.get_value(ROW, rejected, "tds_status"), "Rejected")

	# ── concurrency ────────────────────────────────────────────────────────────

	def test_two_sends_at_once_never_share_a_request_id(self):
		"""Two sends on their own connections. The first pauses part-way through its writes; the
		second must wait for it, then take the next id. Each commits for real."""
		# The other connections only see committed data, so this test commits its fixtures.
		self._real_commit()
		self.addCleanup(self._cleanup_committed, [self.item], [self.entry_a, self.entry_b])

		first_inside, release_first = threading.Event(), threading.Event()
		first_out, second_out = {}, {}
		site = (frappe.local.site, frappe.local.sites_path, self.project)
		first = threading.Thread(
			target=_send_from_own_connection,
			args=(*site, [self._pick("MakeA")], first_out),
			kwargs={"pause": (first_inside, release_first)},
		)
		second = threading.Thread(
			target=_send_from_own_connection, args=(*site, [self._pick("MakeB")], second_out)
		)

		first.start()
		try:
			self.assertTrue(first_inside.wait(30), first_out.get("error"))
			second.start()
			time.sleep(1.5)
			self.assertTrue(second.is_alive(), "the second send did not wait for the first")
		finally:
			release_first.set()
			first.join(30)
			if second.ident:
				second.join(30)

		self.assertNotIn("error", first_out, first_out.get("error"))
		self.assertNotIn("error", second_out, second_out.get("error"))
		self.assertEqual(first_out["result"]["request_id"], f"{self.request_prefix}01")
		self.assertEqual(second_out["result"]["request_id"], f"{self.request_prefix}02")
		self.assertEqual(
			{(r.tds_make, r.tds_request_id) for r in self._rows()},
			{("MakeA", f"{self.request_prefix}01"), ("MakeB", f"{self.request_prefix}02")},
		)

	def _cleanup_committed(self, items, entries):
		_delete_project_rows(self.project)
		for entry in entries:
			frappe.db.delete("TDS Repository", entry)
		for item in items:
			frappe.db.delete("TDS Items", item)
		frappe.db.commit()


def _send_from_own_connection(site, sites_path, project, rows, out, pause=None):
	"""Run one send on a fresh connection, as a second web request would.

	`pause=(inside, release)` holds the send at its savepoint, i.e. after it has the project's
	send lock and before it writes, until `release` is set."""
	frappe.init(site=site, sites_path=sites_path)
	try:
		frappe.connect()
		frappe.set_user("Administrator")
		if pause:
			inside, release = pause
			real_savepoint = frappe.db.savepoint

			def paused_savepoint(name):
				real_savepoint(name)
				inside.set()
				release.wait(30)

			frappe.db.savepoint = paused_savepoint
		out["result"] = submit_tds_request(project=project, rows=json.dumps(rows))
	except Exception as e:
		out["error"] = e
	finally:
		frappe.destroy()
