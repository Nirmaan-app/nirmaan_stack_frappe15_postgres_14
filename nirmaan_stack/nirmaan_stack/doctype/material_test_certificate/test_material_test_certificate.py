# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt
"""Material Test Certificate (MTC) -- rules, edit, delete, PO cascade and project scope.

Runs against the LIVE site: raw fixtures (a Won project, a vendor, a Delivered Billable PO with
four lines) inside ONE transaction whose commits are stubbed, rolled back in `tearDown`. Fixture
users are real accounts read from the site; a test is skipped when one is missing. A test that
writes a `User Permission` row also evicts that user's permission cache before AND after, so
the rolled-back row can never linger in Redis.

Run ONLY this module:
    bench --site localhost run-tests --skip-before-tests --skip-test-records \
        --module nirmaan_stack.nirmaan_stack.doctype.material_test_certificate.test_material_test_certificate
"""

import unittest

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.material_test_certificates import mtc_api
from nirmaan_stack.integrations.controllers.material_test_certificate import delete_mtcs_for_po
from nirmaan_stack.integrations.controllers.procurement_orders import cleanup_po_linked_docs
from nirmaan_stack.services import mtc_rules

MTC = "Material Test Certificate"
PROCUREMENT_PROFILE = "Nirmaan Procurement Executive Profile"
PM_PROFILE = "Nirmaan Project Manager Profile"
OLD_URL = "/api/method/frappe_gcp_attachment.controller.generate_file?key=mtc-test-old&file_name=old.pdf"
NEW_URL = "/api/method/frappe_gcp_attachment.controller.generate_file?key=mtc-test-new&file_name=new.pdf"


def _raw(doctype, **fields):
	doc = frappe.new_doc(doctype)
	doc.update(fields)
	if not doc.name:
		doc.name = frappe.generate_hash(length=12)
	doc.db_insert()
	return doc.name


def _user(profile, *, with_projects):
	"""An enabled user of `profile` that has (or has no) project assignment."""
	for name in frappe.get_all("Nirmaan Users", filters={"role_profile": profile}, pluck="name"):
		if not frappe.db.exists("User", {"name": name, "enabled": 1}):
			continue
		has = frappe.db.exists("User Permission", {"user": name, "allow": "Projects"})
		if bool(has) == with_projects:
			return name
	return None


def _evict_permission_cache(user):
	frappe.cache.hdel("user_permissions", user)
	frappe.local.cache.clear()


class TestMTCRules(unittest.TestCase):
	"""The pure line rules -- no database."""

	def test_line_key_normalises_blanks(self):
		self.assertEqual(mtc_rules.line_key(" ITEM-1 ", None), ("ITEM-1", ""))
		self.assertEqual(mtc_rules.line_key("ITEM-1", " Tata "), ("ITEM-1", "Tata"))

	def test_po_block_reason(self):
		for status in ("PO Approved", "Partially Dispatched", "Dispatched", "Partially Delivered", "Delivered"):
			self.assertIsNone(mtc_rules.po_block_reason("Billable", status), status)
		for status in ("Merged", "Cancelled", "Inactive"):
			self.assertIn(status, mtc_rules.po_block_reason("Billable", status) or "")
		self.assertIn("Billable", mtc_rules.po_block_reason("Non-Billable", "Delivered") or "")
		self.assertIsNotNone(mtc_rules.po_block_reason("", "Delivered"))
		self.assertIsNotNone(mtc_rules.po_block_reason("Billable", ""))

	def test_certificate_date_problem(self):
		from datetime import date

		today = date(2026, 10, 7)
		self.assertIsNone(mtc_rules.certificate_date_problem(today, today))
		self.assertIsNone(mtc_rules.certificate_date_problem(date(2025, 1, 1), today))
		self.assertIn("future", mtc_rules.certificate_date_problem(date(2026, 10, 8), today) or "")
		self.assertIsNotNone(mtc_rules.certificate_date_problem(None, today))

	def test_billable_lines_skips_non_billable_and_keeps_first(self):
		rows = [
			{"item_id": "A", "make": "Tata", "billing_status": "Billable", "item_name": "first"},
			{"item_id": "A", "make": "Tata", "billing_status": "Billable", "item_name": "second"},
			{"item_id": "A", "make": "Local", "billing_status": "Billable", "item_name": "other make"},
			{"item_id": "C", "make": "", "billing_status": "Non-Billable", "item_name": "nb"},
		]
		lines = mtc_rules.billable_lines(rows)
		self.assertEqual(set(lines), {("A", "Tata"), ("A", "Local")})
		self.assertEqual(lines[("A", "Tata")]["item_name"], "first")


class _MTCCase(FrappeTestCase):
	def setUp(self):
		self._real_commit = frappe.db.commit
		self._real_publish = frappe.publish_realtime
		frappe.db.commit = lambda *a, **k: None
		frappe.publish_realtime = lambda *a, **k: None
		frappe.set_user("Administrator")
		self._evicted = set()

		tag = frappe.generate_hash(length=6)
		self.project = _raw("Projects", project_name=f"TEST_MTC_{tag}", tendering_status="Won")
		self.vendor = _raw("Vendors", vendor_name=f"TEST MTC Vendor {tag}")
		self.po = _raw(
			"Procurement Orders",
			name=f"PO/TEST-MTC/{tag}",
			project=self.project,
			vendor=self.vendor,
			status="Delivered",
			billing_status="Billable",
		)
		lines = [
			("ITEM-A", "Tata", "Billable", "MS Pipe 25mm"),
			("ITEM-B", "Jindal", "Billable", "GI Elbow 25mm"),
			("ITEM-C", "", "Non-Billable", "Freight"),
			("ITEM-A", "Local", "Billable", "MS Pipe 25mm"),
		]
		self.line_rows = {}
		for idx, (item_id, make, billing, name) in enumerate(lines, start=1):
			self.line_rows[(item_id, make)] = _raw(
				"Purchase Order Item",
				parent=self.po,
				parenttype="Procurement Orders",
				parentfield="items",
				idx=idx,
				item_id=item_id,
				item_name=name,
				make=make,
				category="Plumbing",
				procurement_package="MEP",
				billing_status=billing,
			)

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.commit = self._real_commit
		frappe.publish_realtime = self._real_publish
		frappe.db.rollback()
		for user in self._evicted:
			_evict_permission_cache(user)

	# helpers -------------------------------------------------------------------------------

	def _mtc(self, items, *, user="Administrator", attachment=OLD_URL, **extra):
		extra.setdefault("certificate_date", frappe.utils.today())
		frappe.set_user(user)
		try:
			doc = frappe.get_doc(
				{
					"doctype": MTC,
					"procurement_order": self.po,
					"attachment": attachment,
					"items": [{"item_id": i, "make": m} for i, m in items],
					**extra,
				}
			)
			doc.insert()
			return doc
		finally:
			frappe.set_user("Administrator")

	def _po_status(self, status=None, billing=None):
		if status:
			frappe.db.set_value("Procurement Orders", self.po, "status", status, update_modified=False)
		if billing:
			frappe.db.set_value(
				"Procurement Orders", self.po, "billing_status", billing, update_modified=False
			)

	def _assign(self, user, project):
		_raw("User Permission", user=user, allow="Projects", for_value=project, apply_to_all_doctypes=1)
		self._evicted.add(user)
		_evict_permission_cache(user)

	def _as(self, user, fn, *args, **kwargs):
		frappe.set_user(user)
		try:
			return fn(*args, **kwargs)
		finally:
			frappe.set_user("Administrator")


class TestMTCCreate(_MTCCase):
	def test_creates_and_copies_every_field_from_the_po(self):
		other_project = _raw("Projects", project_name="TEST_MTC_OTHER", tendering_status="Won")
		other_vendor = _raw("Vendors", vendor_name="TEST MTC Other Vendor")
		doc = self._mtc([("ITEM-A", "Tata")], project=other_project, vendor=other_vendor)
		doc.reload()
		self.assertEqual(doc.project, self.project)
		self.assertEqual(doc.vendor, self.vendor)
		row = doc.items[0]
		self.assertEqual(
			(row.item_name, row.make, row.category, row.procurement_package),
			("MS Pipe 25mm", "Tata", "Plumbing", "MEP"),
		)
		self.assertTrue(doc.name.startswith("MTC-"))

	def test_tampered_item_fields_are_overwritten(self):
		frappe.set_user("Administrator")
		doc = frappe.get_doc(
			{
				"doctype": MTC,
				"procurement_order": self.po,
				"attachment": OLD_URL,
				"certificate_date": frappe.utils.today(),
				"items": [{"item_id": "ITEM-A", "make": "Tata", "item_name": "HACK", "category": "HACK"}],
			}
		).insert()
		self.assertEqual((doc.items[0].item_name, doc.items[0].category), ("MS Pipe 25mm", "Plumbing"))

	def test_refuses_a_non_billable_po(self):
		self._po_status(billing="Non-Billable")
		with self.assertRaises(frappe.ValidationError):
			self._mtc([("ITEM-A", "Tata")])

	def test_refuses_a_merged_cancelled_or_inactive_po(self):
		for status in ("Merged", "Cancelled", "Inactive"):
			self._po_status(status=status)
			with self.assertRaises(frappe.ValidationError, msg=status):
				self._mtc([("ITEM-A", "Tata")])

	def test_every_live_status_is_allowed(self):
		lines = [("ITEM-A", "Tata"), ("ITEM-B", "Jindal"), ("ITEM-A", "Local")]
		statuses = ("PO Approved", "Partially Dispatched", "Dispatched", "Partially Delivered")
		for line, status in zip(lines, statuses):
			self._po_status(status=status)
			self.assertTrue(self._mtc([line]).name, status)

	def test_refuses_a_non_billable_line(self):
		with self.assertRaises(frappe.ValidationError):
			self._mtc([("ITEM-C", "")])

	def test_refuses_a_line_not_on_the_po(self):
		with self.assertRaises(frappe.ValidationError):
			self._mtc([("ITEM-Z", "Tata")])
		with self.assertRaises(frappe.ValidationError, msg="right item, wrong make"):
			self._mtc([("ITEM-B", "Tata")])

	def test_refuses_zero_items(self):
		with self.assertRaises(frappe.ValidationError):
			self._mtc([])

	def test_refuses_the_same_line_twice(self):
		with self.assertRaises(frappe.ValidationError):
			self._mtc([("ITEM-A", "Tata"), ("ITEM-A", "Tata")])

	def test_one_line_one_mtc_per_po(self):
		first = self._mtc([("ITEM-A", "Tata")])
		with self.assertRaises(frappe.ValidationError) as ctx:
			self._mtc([("ITEM-B", "Jindal"), ("ITEM-A", "Tata")])
		self.assertIn("another certificate", str(ctx.exception))
		self.assertNotIn(first.name, str(ctx.exception), "MTC ids are never shown to users")

	def test_same_item_with_another_make_is_a_separate_line(self):
		self._mtc([("ITEM-A", "Tata")])
		self.assertTrue(self._mtc([("ITEM-A", "Local")]).name)

	def test_certificate_date_is_required(self):
		with self.assertRaises(frappe.ValidationError):
			self._mtc([("ITEM-A", "Tata")], certificate_date=None)

	def test_certificate_date_cannot_be_in_the_future(self):
		tomorrow = frappe.utils.add_days(frappe.utils.today(), 1)
		with self.assertRaises(frappe.ValidationError):
			self._mtc([("ITEM-A", "Tata")], certificate_date=tomorrow)

	def test_today_and_past_certificate_dates_are_allowed(self):
		self.assertTrue(self._mtc([("ITEM-A", "Tata")], certificate_date=frappe.utils.today()).name)
		past = frappe.utils.add_days(frappe.utils.today(), -400)
		self.assertTrue(self._mtc([("ITEM-B", "Jindal")], certificate_date=past).name)

	def test_a_project_manager_cannot_upload(self):
		pm = _user(PM_PROFILE, with_projects=True) or _user(PM_PROFILE, with_projects=False)
		if not pm:
			raise unittest.SkipTest("no Project Manager on this site")
		with self.assertRaises(frappe.PermissionError):
			self._mtc([("ITEM-A", "Tata")], user=pm)

	def test_procurement_can_upload(self):
		# Uses a buyer WITH project assignments, which every buyer on this site has. Frappe's
		# create check runs before `validate` copies the project from the PO, so project
		# assignment does not gate the upload -- as with DC/MIR, whose endpoint skips
		# permissions entirely. The PO page itself is the project gate.
		buyer = _user(PROCUREMENT_PROFILE, with_projects=True) or _user(
			PROCUREMENT_PROFILE, with_projects=False
		)
		if not buyer:
			raise unittest.SkipTest("no Procurement Executive on this site")
		doc = self._mtc([("ITEM-A", "Tata")], user=buyer)
		self.assertEqual(doc.owner, buyer)


class TestMTCEdit(_MTCCase):
	def test_unticking_frees_a_line_for_another_mtc(self):
		first = self._mtc([("ITEM-A", "Tata"), ("ITEM-B", "Jindal")])
		mtc_api.update_mtc(first.name, [{"item_id": "ITEM-A", "make": "Tata"}])
		self.assertEqual(len(frappe.get_doc(MTC, first.name).items), 1)
		self.assertTrue(self._mtc([("ITEM-B", "Jindal")]).name)

	def test_edit_can_tick_a_free_line(self):
		first = self._mtc([("ITEM-A", "Tata")])
		mtc_api.update_mtc(
			first.name,
			frappe.as_json([{"item_id": "ITEM-A", "make": "Tata"}, {"item_id": "ITEM-B", "make": "Jindal"}]),
		)
		self.assertEqual(
			{(r.item_id, r.make) for r in frappe.get_doc(MTC, first.name).items},
			{("ITEM-A", "Tata"), ("ITEM-B", "Jindal")},
		)

	def test_edit_changes_the_certificate_date_but_not_to_the_future(self):
		first = self._mtc([("ITEM-A", "Tata")])
		past = frappe.utils.add_days(frappe.utils.today(), -10)
		mtc_api.update_mtc(first.name, [{"item_id": "ITEM-A", "make": "Tata"}], certificate_date=past)
		self.assertEqual(str(frappe.db.get_value(MTC, first.name, "certificate_date")), past)
		tomorrow = frappe.utils.add_days(frappe.utils.today(), 1)
		with self.assertRaises(frappe.ValidationError):
			mtc_api.update_mtc(first.name, [{"item_id": "ITEM-A", "make": "Tata"}], certificate_date=tomorrow)

	def test_edit_refuses_unticking_every_item(self):
		first = self._mtc([("ITEM-A", "Tata")])
		with self.assertRaises(frappe.ValidationError):
			mtc_api.update_mtc(first.name, [])

	def test_edit_cannot_claim_a_line_on_another_mtc(self):
		self._mtc([("ITEM-B", "Jindal")])
		first = self._mtc([("ITEM-A", "Tata")])
		with self.assertRaises(frappe.ValidationError):
			mtc_api.update_mtc(
				first.name,
				[{"item_id": "ITEM-A", "make": "Tata"}, {"item_id": "ITEM-B", "make": "Jindal"}],
			)

	def test_edit_keeps_a_row_a_revision_removed(self):
		first = self._mtc([("ITEM-A", "Tata"), ("ITEM-B", "Jindal")])
		# A revision deletes the ITEM-B line from the PO.
		frappe.db.delete("Purchase Order Item", {"name": self.line_rows[("ITEM-B", "Jindal")]})
		mtc_api.update_mtc(
			first.name,
			[{"item_id": "ITEM-A", "make": "Tata"}, {"item_id": "ITEM-B", "make": "Jindal"}],
			attachment=NEW_URL,
		)
		kept = {r.item_id: r for r in frappe.get_doc(MTC, first.name).items}
		self.assertEqual(kept["ITEM-B"].item_name, "GI Elbow 25mm", "kept row keeps its saved values")
		# ...but a removed line can't be ticked on a NEW certificate.
		with self.assertRaises(frappe.ValidationError):
			self._mtc([("ITEM-B", "Jindal")])

	def test_replacing_the_file_keeps_the_old_file_and_records_a_version(self):
		old_file = _raw(
			"File",
			file_name="old.pdf",
			file_url=OLD_URL,
			attached_to_doctype="Procurement Orders",
			attached_to_name=self.po,
			is_private=1,
		)
		first = self._mtc([("ITEM-A", "Tata")])
		mtc_api.update_mtc(first.name, [{"item_id": "ITEM-A", "make": "Tata"}], attachment=NEW_URL)
		self.assertEqual(frappe.db.get_value(MTC, first.name, "attachment"), NEW_URL)
		self.assertTrue(frappe.db.exists("File", old_file), "the replaced file is kept")
		self.assertTrue(frappe.db.exists("Version", {"ref_doctype": MTC, "docname": first.name}))

	def test_edit_is_refused_once_the_po_is_inactive(self):
		first = self._mtc([("ITEM-A", "Tata")])
		self._po_status(status="Inactive")
		with self.assertRaises(frappe.ValidationError):
			mtc_api.update_mtc(first.name, [{"item_id": "ITEM-A", "make": "Tata"}])

	def test_a_project_manager_cannot_edit(self):
		pm = _user(PM_PROFILE, with_projects=True) or _user(PM_PROFILE, with_projects=False)
		if not pm:
			raise unittest.SkipTest("no Project Manager on this site")
		first = self._mtc([("ITEM-A", "Tata")])
		with self.assertRaises(frappe.PermissionError):
			self._as(pm, mtc_api.update_mtc, first.name, [{"item_id": "ITEM-A", "make": "Tata"}])


class TestMTCDelete(_MTCCase):
	def test_delete_removes_the_file_row_and_frees_the_lines(self):
		file_row = _raw(
			"File",
			file_name="old.pdf",
			file_url=OLD_URL,
			attached_to_doctype="Procurement Orders",
			attached_to_name=self.po,
			is_private=1,
		)
		first = self._mtc([("ITEM-A", "Tata")])
		frappe.delete_doc(MTC, first.name)
		self.assertFalse(frappe.db.exists(MTC, first.name))
		self.assertFalse(frappe.db.exists("File", file_row))
		self.assertTrue(self._mtc([("ITEM-A", "Tata")]).name, "the line is free again")

	def test_delete_leaves_another_documents_file_alone(self):
		other = _raw(
			"File",
			file_name="old.pdf",
			file_url=OLD_URL,
			attached_to_doctype="Procurement Orders",
			attached_to_name="PO/SOMEONE-ELSE",
			is_private=1,
		)
		first = self._mtc([("ITEM-A", "Tata")])
		frappe.delete_doc(MTC, first.name)
		self.assertTrue(frappe.db.exists("File", other))

	def test_delete_is_refused_once_the_po_is_inactive(self):
		first = self._mtc([("ITEM-A", "Tata")])
		self._po_status(status="Inactive")
		with self.assertRaises(frappe.ValidationError):
			frappe.delete_doc(MTC, first.name)

	def test_a_project_manager_cannot_delete(self):
		pm = _user(PM_PROFILE, with_projects=True) or _user(PM_PROFILE, with_projects=False)
		if not pm:
			raise unittest.SkipTest("no Project Manager on this site")
		first = self._mtc([("ITEM-A", "Tata")])
		with self.assertRaises(frappe.PermissionError):
			self._as(pm, frappe.delete_doc, MTC, first.name)
		self.assertTrue(frappe.db.exists(MTC, first.name))

	def test_po_cleanup_removes_mtcs_whatever_the_status(self):
		first = self._mtc([("ITEM-A", "Tata")])
		second = self._mtc([("ITEM-B", "Jindal")])
		self._po_status(status="Cancelled")
		cleanup_po_linked_docs(self.po)
		self.assertFalse(frappe.db.exists(MTC, first.name))
		self.assertFalse(frappe.db.exists(MTC, second.name))

	def test_merge_helper_removes_mtcs(self):
		first = self._mtc([("ITEM-A", "Tata")])
		self._po_status(status="Merged")
		delete_mtcs_for_po(self.po)
		self.assertFalse(frappe.db.exists(MTC, first.name))


class TestMTCRead(_MTCCase):
	def test_needs_exactly_one_filter(self):
		with self.assertRaises(frappe.ValidationError):
			mtc_api.get_mtcs()
		with self.assertRaises(frappe.ValidationError):
			mtc_api.get_mtcs(procurement_order=self.po, project=self.project)

	def test_po_listing_carries_items_and_vendor_name(self):
		self._mtc([("ITEM-A", "Tata"), ("ITEM-A", "Local")])
		self._mtc([("ITEM-B", "Jindal")])
		rows = mtc_api.get_mtcs(procurement_order=self.po)
		self.assertEqual(len(rows), 2)
		self.assertTrue(all(r["vendor_name"].startswith("TEST MTC Vendor") for r in rows))
		self.assertEqual(sorted(len(r["items"]) for r in rows), [1, 2])
		# The PM-side PO link needs the PR; this raw PO has none.
		self.assertTrue(all("procurement_request" in r and r["procurement_request"] is None for r in rows))
		self.assertEqual(mtc_api.get_mtcs(project=self.project), rows)

	def test_administrator_is_never_project_scoped(self):
		# Administrator holds every Role, including ones named like the PM / PL profiles.
		self.assertIsNone(mtc_api.mtc_allowed_projects("Administrator"))

	def test_admin_sees_the_project_with_its_count(self):
		self._mtc([("ITEM-A", "Tata")])
		self._mtc([("ITEM-B", "Jindal")])
		out = mtc_api.get_mtc_projects()
		self.assertFalse(out["scoped"])
		counts = {p["project"]: p["mtc_count"] for p in out["projects"]}
		self.assertEqual(counts.get(self.project), 2)

	def test_a_pm_sees_only_assigned_projects(self):
		pm = _user(PM_PROFILE, with_projects=True)
		if not pm:
			raise unittest.SkipTest("no Project Manager with assigned projects")
		self._mtc([("ITEM-A", "Tata")])

		self.assertEqual(self._as(pm, mtc_api.get_mtcs, project=self.project), [])
		out = self._as(pm, mtc_api.get_mtc_projects)
		self.assertTrue(out["scoped"] and out["has_projects"])
		self.assertNotIn(self.project, {p["project"] for p in out["projects"]})

		self._assign(pm, self.project)
		self.assertEqual(len(self._as(pm, mtc_api.get_mtcs, project=self.project)), 1)
		out = self._as(pm, mtc_api.get_mtc_projects)
		self.assertIn(self.project, {p["project"] for p in out["projects"]})

	def test_a_pm_with_no_project_sees_nothing(self):
		pm = _user(PM_PROFILE, with_projects=False)
		if not pm:
			raise unittest.SkipTest("no Project Manager without assigned projects")
		self._mtc([("ITEM-A", "Tata")])
		out = self._as(pm, mtc_api.get_mtc_projects)
		self.assertEqual(out, {"scoped": True, "has_projects": False, "projects": []})
		self.assertEqual(self._as(pm, mtc_api.get_mtcs, project=self.project), [])
