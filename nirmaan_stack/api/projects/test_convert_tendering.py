# Copyright (c) 2026, Abhishek and Contributors
# See license.txt

"""
Integration tests for the Tendering -> Won conversion API (Slice 7, module B4):
`nirmaan_stack.api.projects.tendering.convert_tendering_to_won`.

Exercises the observable, external behavior of the public whitelisted endpoint:
  - a Tendering stub is converted in place to a fully-populated "Won" project
    (same docname, status flips to "Won", an Address is linked, the
    `project_wp_category_makes` child table is populated);
  - the one-way invariant is enforced server-side (converting a project that is
    NOT currently "Tendering" is rejected).

Follows the established `FrappeTestCase` real-fixture pattern from
`doctype/projects/test_projects.py::TestApplyFullProjectDetails`: work packages,
categories, makes and work headers are resolved from real masters via
`frappe.get_all`, and all projects/addresses created by the tests are cleaned up
in `tearDown` via a marker city.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.projects.tendering import (
	convert_tendering_to_won,
	create_tendering_project,
)

# Marker city used for cleanup. The stub is created with this city, so the frozen
# docname is `{CONVERT_TEST_CITY}-PROJ-#####`.
CONVERT_TEST_CITY = "ZzConvTestCity"


def _pick_existing(doctype, **filters):
	"""Return one existing docname for `doctype` matching filters, or None."""
	rows = frappe.get_all(doctype, filters=filters or None, pluck="name", limit=1)
	return rows[0] if rows else None


class TestConvertTenderingToWon(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		# Resolve real fixtures so the population helper's `frappe.db.exists`
		# guards pass and child rows are actually appended.
		cls.wp = _pick_existing("Procurement Packages")
		cls.cat = _pick_existing("Category", work_package=cls.wp) or _pick_existing("Category")
		cls.make = _pick_existing("Makelist")

	def tearDown(self):
		# Clean up projects created by these tests (stubs + converted Won).
		for name in frappe.get_all(
			"Projects", filters={"project_city": CONVERT_TEST_CITY}, pluck="name"
		):
			frappe.delete_doc("Projects", name, ignore_permissions=True, force=True)
		# Clean up Address docs created via the conversion (titled by project_name).
		for name in frappe.get_all(
			"Address", filters={"address_title": ["like", "ConvTest%"]}, pluck="name"
		):
			frappe.delete_doc("Address", name, ignore_permissions=True, force=True)
		frappe.db.commit()

	def _create_stub(self, name_suffix):
		"""Create a real Tendering stub via the public create API; return docname."""
		res = create_tendering_project(
			project_name=f"ConvTest {name_suffix}",
			project_state="Test State",
			project_city=CONVERT_TEST_CITY,
			customer=None,
		)
		self.assertEqual(res["status"], 200, msg=res)
		return res["project_name"]

	def _full_payload(self, name_suffix):
		"""A representative full wizard payload (same shape as create_project_with_address)."""
		return {
			"project_name": f"ConvTest {name_suffix}",
			"customer": None,
			"project_type": None,
			"project_value": "1000",
			"project_value_gst": "1180",
			"carpet_area": "500",
			"project_gst": None,
			"project_start_date": "2025-01-01T00:00:00.000Z",
			"project_end_date": "2025-12-31T00:00:00.000Z",
			# City/State as they would arrive from the real pincode lookup. Kept on
			# the marker city so the converted Address/Project is still cleaned up.
			"project_city": CONVERT_TEST_CITY,
			"project_state": "Test State",
			"address_line_1": "Line 1",
			"address_line_2": "Line 2",
			"pin": "560001",
			"email": "convtest@example.com",
			"phone": "9999999999",
			"project_scopes": {"scopes": []},
			"enable_project_milestone_tracking": False,
			"project_work_packages": {
				"work_packages": [
					{
						"work_package_name": self.wp,
						"category_list": {
							"list": [
								{
									"name": self.cat,
									"makes": [{"label": self.make, "value": self.make}],
								}
							]
						},
					}
				]
			},
			"project_work_header_entries": [],
		}

	def test_convert_succeeds_in_place(self):
		"""
		Converting a Tendering stub: same docname, tendering_status flips to Won,
		execution status flips to Created, an Address is linked, and the
		`project_wp_category_makes` child table is populated.
		"""
		stub_name = self._create_stub("ok")
		# Sanity: starts as a stub on the bid dimension, no execution stage yet.
		self.assertEqual(
			frappe.db.get_value("Projects", stub_name, "tendering_status"),
			"Tendering",
		)
		self.assertIn(
			frappe.db.get_value("Projects", stub_name, "status") or "",
			("", None),
		)

		res = convert_tendering_to_won(project_id=stub_name, values=self._full_payload("ok"))

		self.assertEqual(res["status"], 200, msg=res)
		# Frozen docname: the returned name is the SAME stub docname.
		self.assertEqual(res["project_name"], stub_name)

		converted = frappe.get_doc("Projects", stub_name)
		self.assertEqual(converted.tendering_status, "Won")
		self.assertEqual(converted.status, "Won")
		# Address now linked.
		self.assertTrue(converted.project_address)
		self.assertTrue(frappe.db.exists("Address", converted.project_address))
		# Work-package/category/make child rows populated.
		self.assertTrue(len(converted.project_wp_category_makes) >= 1)
		row = converted.project_wp_category_makes[0]
		self.assertEqual(row.procurement_package, self.wp)
		self.assertEqual(row.category, self.cat)

	def test_docname_frozen_when_city_changes(self):
		"""
		If the wizard payload carries a different city (real pincode lookup), the
		`project_city` field updates but the frozen docname does NOT change.
		"""
		stub_name = self._create_stub("freeze")

		payload = self._full_payload("freeze")
		# A different city arriving from the pincode lookup. Still on the marker
		# city prefix in the docname (frozen at stub creation), but the field moves.
		payload["project_city"] = CONVERT_TEST_CITY + "Pin"

		res = convert_tendering_to_won(project_id=stub_name, values=payload)

		self.assertEqual(res["status"], 200, msg=res)
		# Docname unchanged even though city differs.
		self.assertEqual(res["project_name"], stub_name)
		converted = frappe.get_doc("Projects", stub_name)
		self.assertEqual(converted.name, stub_name)
		self.assertEqual(converted.project_city, CONVERT_TEST_CITY + "Pin")

	def test_convert_rejects_non_tendering_project(self):
		"""
		Converting a project that is not currently Tendering is rejected (one-way
		invariant enforced server-side).
		"""
		stub_name = self._create_stub("oneway")
		# First conversion succeeds -> now it is "Won".
		first = convert_tendering_to_won(project_id=stub_name, values=self._full_payload("oneway"))
		self.assertEqual(first["status"], 200, msg=first)

		# Second conversion on the (now Won) project must be rejected.
		second = convert_tendering_to_won(project_id=stub_name, values=self._full_payload("oneway"))
		self.assertEqual(second["status"], 400)
		self.assertIn("cannot be converted", second["error"])
		# Bid + execution dimensions untouched by the rejected call.
		self.assertEqual(
			frappe.db.get_value("Projects", stub_name, "tendering_status"),
			"Won",
		)
		self.assertEqual(
			frappe.db.get_value("Projects", stub_name, "status"),
			"Won",
		)

	def test_convert_rejects_missing_project(self):
		"""Converting a non-existent project is rejected with a 400."""
		res = convert_tendering_to_won(
			project_id="ZzNoSuchProject-PROJ-99999", values=self._full_payload("missing")
		)
		self.assertEqual(res["status"], 400)
		self.assertIn("does not exist", res["error"])
