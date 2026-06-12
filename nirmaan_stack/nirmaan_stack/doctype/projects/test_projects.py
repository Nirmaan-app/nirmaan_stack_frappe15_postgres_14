# Copyright (c) 2024, Abhishek and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.projects._project_population import apply_full_project_details
from nirmaan_stack.patches.v3_0.migrate_project_status_created_to_won import (
	execute as migrate_created_to_won,
)

TEST_CITY = "ZzMigTestCity"
POP_TEST_CITY = "ZzPopTestCity"


def _make_project(name_suffix, status):
	doc = frappe.get_doc(
		{
			"doctype": "Projects",
			"project_name": f"MigTest {name_suffix}",
			"project_city": TEST_CITY,
			"project_state": "Test State",
			"project_start_date": "2025-01-01 00:00:00",
			"project_end_date": "2025-12-31 00:00:00",
			"project_scopes": {"scopes": []},
			"status": status,
		}
	).insert(ignore_permissions=True)
	return doc.name


class TestProjects(FrappeTestCase):
	def tearDown(self):
		for name in frappe.get_all("Projects", filters={"project_city": TEST_CITY}, pluck="name"):
			frappe.delete_doc("Projects", name, ignore_permissions=True, force=True)
		frappe.db.commit()

	def test_migrate_created_to_won(self):
		"""The Created->Won migration renames Created projects and leaves others alone."""
		created_name = _make_project("created", "Created")
		wip_name = _make_project("wip", "WIP")

		migrate_created_to_won()

		self.assertEqual(frappe.db.get_value("Projects", created_name, "status"), "Won")
		self.assertEqual(frappe.db.get_value("Projects", wip_name, "status"), "WIP")
		# The retired "Created" status must no longer exist on any project.
		self.assertEqual(frappe.db.count("Projects", {"status": "Created"}), 0)


def _pick_existing(doctype, **filters):
	"""Return one existing docname for `doctype` matching filters, or None."""
	rows = frappe.get_all(doctype, filters=filters or None, pluck="name", limit=1)
	return rows[0] if rows else None


class TestApplyFullProjectDetails(FrappeTestCase):
	"""
	B3 (Slice 6) coverage for the extracted population helper
	`apply_full_project_details`. Exercises Address creation, the
	`project_wp_category_makes` child table (both the "category with makes" and
	"category with no makes" branches), and the `project_work_header_entries`
	child table when milestone tracking is enabled.
	"""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		# Resolve real fixtures so the helper's `frappe.db.exists` guards pass and
		# rows are actually appended (the helper silently skips unknown masters).
		cls.wp = _pick_existing("Procurement Packages")
		# A category whose work_package matches the chosen procurement package keeps
		# the payload realistic; the helper itself does not enforce that linkage.
		cls.cat_with_makes = _pick_existing("Category", work_package=cls.wp) or _pick_existing("Category")
		cls.cat_no_makes = (
			frappe.get_all(
				"Category",
				filters={"name": ["!=", cls.cat_with_makes]},
				pluck="name",
				limit=1,
			)
			or [cls.cat_with_makes]
		)[0]
		cls.make = _pick_existing("Makelist")
		cls.work_header = _pick_existing("Work Headers")

	def tearDown(self):
		# Clean up projects created by these tests.
		for name in frappe.get_all("Projects", filters={"project_city": POP_TEST_CITY}, pluck="name"):
			frappe.delete_doc("Projects", name, ignore_permissions=True, force=True)
		# Clean up Address docs created via the helper (titled by project_name).
		for name in frappe.get_all(
			"Address", filters={"address_title": ["like", "PopTest%"]}, pluck="name"
		):
			frappe.delete_doc("Address", name, ignore_permissions=True, force=True)
		frappe.db.commit()

	def _base_values(self, name_suffix, enable_milestones=False):
		return {
			"project_name": f"PopTest {name_suffix}",
			"customer": None,
			"project_type": None,
			"project_value": "1000",
			"project_value_gst": "1180",
			"carpet_area": "500",
			"project_gst": None,
			"project_start_date": "2025-01-01T00:00:00.000Z",
			"project_end_date": "2025-12-31T00:00:00.000Z",
			"project_city": POP_TEST_CITY,
			"project_state": "Test State",
			"address_line_1": "Line 1",
			"address_line_2": "Line 2",
			"pin": "560001",
			"email": "poptest@example.com",
			"phone": "9999999999",
			"project_scopes": {"scopes": []},
			"enable_project_milestone_tracking": enable_milestones,
			"project_work_packages": {
				"work_packages": [
					{
						"work_package_name": self.wp,
						"category_list": {
							"list": [
								# Branch A: category WITH makes
								{
									"name": self.cat_with_makes,
									"makes": [{"label": self.make, "value": self.make}],
								},
								# Branch B: category WITH NO makes
								{
									"name": self.cat_no_makes,
									"makes": [],
								},
							]
						},
					}
				]
			},
			"project_work_header_entries": [],
		}

	def _save_project(self, values, status="Won"):
		project_doc = frappe.new_doc("Projects")
		apply_full_project_details(project_doc, values)
		project_doc.status = status
		project_doc.save(ignore_permissions=True)
		frappe.db.commit()
		return project_doc

	def test_address_doc_created_with_expected_fields(self):
		"""The helper creates a linked Shipping Address with the payload's fields."""
		values = self._base_values("address")
		project_doc = self._save_project(values)

		self.assertTrue(project_doc.project_address)
		address = frappe.get_doc("Address", project_doc.project_address)
		self.assertEqual(address.address_title, values["project_name"])
		self.assertEqual(address.address_type, "Shipping")
		self.assertEqual(address.address_line1, "Line 1")
		self.assertEqual(address.address_line2, "Line 2")
		self.assertEqual(address.city, POP_TEST_CITY)
		self.assertEqual(address.state, "Test State")
		self.assertEqual(address.country, "India")
		self.assertEqual(address.pincode, "560001")
		self.assertEqual(address.email_id, "poptest@example.com")
		self.assertEqual(address.phone, "9999999999")
		# Status is the caller's responsibility; helper must not touch it.
		self.assertEqual(project_doc.status, "Won")

	def test_wp_category_makes_population_both_branches(self):
		"""
		`project_wp_category_makes` gets one row for the category WITH a make and
		one row (make=None) for the category WITH NO makes.
		"""
		values = self._base_values("wpcm")
		project_doc = self._save_project(values)

		rows = project_doc.project_wp_category_makes
		# 1 row for the make + 1 row for the no-makes category = 2 rows.
		self.assertEqual(len(rows), 2)

		# Branch A: category with makes -> a row carrying the make.
		with_make = [r for r in rows if r.category == self.cat_with_makes]
		self.assertEqual(len(with_make), 1)
		self.assertEqual(with_make[0].procurement_package, self.wp)
		self.assertEqual(with_make[0].make, self.make)

		# Branch B: category with no makes -> a row with make unset.
		no_make = [r for r in rows if r.category == self.cat_no_makes]
		self.assertEqual(len(no_make), 1)
		self.assertEqual(no_make[0].procurement_package, self.wp)
		self.assertFalse(no_make[0].make)

		# Legacy JSON field must be cleared by the helper.
		self.assertFalse(project_doc.project_work_packages)

	def test_work_header_entries_populated_when_tracking_enabled(self):
		"""When milestone tracking is enabled, enabled work headers become rows."""
		if not self.work_header:
			self.skipTest("No Work Headers fixture available in this site.")

		values = self._base_values("wh", enable_milestones=True)
		values["project_work_header_entries"] = [
			{"work_header_name": self.work_header, "enabled": True}
		]
		project_doc = self._save_project(values)

		self.assertTrue(project_doc.enable_project_milestone_tracking)
		entries = project_doc.project_work_header_entries
		self.assertEqual(len(entries), 1)
		self.assertEqual(entries[0].project_work_header_name, self.work_header)
		self.assertTrue(entries[0].enabled)

	def test_no_work_header_entries_when_tracking_disabled(self):
		"""With tracking disabled, no work-header rows are appended even if sent."""
		if not self.work_header:
			self.skipTest("No Work Headers fixture available in this site.")

		values = self._base_values("whoff", enable_milestones=False)
		values["project_work_header_entries"] = [
			{"work_header_name": self.work_header, "enabled": True}
		]
		project_doc = self._save_project(values)

		self.assertFalse(project_doc.enable_project_milestone_tracking)
		self.assertEqual(len(project_doc.project_work_header_entries), 0)
