# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt
"""The one-time department setup table (`patches/v3_0/setup_nirmaan_departments`).

The patch is not run here (its dry run rolls back the whole transaction). These tests pin the table
it uses: every role profile on the site gets a starting department except the two Tendering roles
(owner, 2026-10-12: no Tendering department), and only the listed departments are used.

Who may add, rename or delete a department, and that a switched-off department can't be given to
anyone, are tested with real rows in `doctype/asset_management/test_asset_management.py`.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.patches.v3_0.setup_nirmaan_departments import DEPARTMENTS, ROLE_PROFILE_DEPARTMENT

TENDERING_PROFILES = {"Nirmaan Tendering Executive Profile", "Nirmaan Tendering Lead Profile"}
# Profiles made after the one-time setup ran: their people get a department in Edit User (ADR-0051, Technology).
LATER_PROFILES = {"Nirmaan Software Developer Profile"}


class TestDepartmentSetupTable(FrappeTestCase):
    def test_every_role_profile_except_tendering_gets_a_starting_department(self):
        profiles = {name for name in frappe.get_all("Role Profile", pluck="name") if name.startswith("Nirmaan ")}
        self.assertEqual(profiles - TENDERING_PROFILES - LATER_PROFILES - set(ROLE_PROFILE_DEPARTMENT), set())

    def test_only_listed_departments_are_used(self):
        self.assertLessEqual(set(ROLE_PROFILE_DEPARTMENT.values()), set(DEPARTMENTS))

    def test_ten_departments_and_no_tendering(self):
        self.assertEqual(len(DEPARTMENTS), 10)
        self.assertNotIn("Tendering", DEPARTMENTS)
        self.assertFalse(TENDERING_PROFILES & set(ROLE_PROFILE_DEPARTMENT))


class TestTechnologyDepartmentPatch(FrappeTestCase):
    """`patches/v3_0/add_technology_department` (ADR-0051 decision 2). Each test rolls back, so the row a migrate
    made on this site is back as it was afterwards."""

    def setUp(self):
        from nirmaan_stack.patches.v3_0 import add_technology_department

        self.patch = add_technology_department
        frappe.db.rollback()
        if frappe.db.exists("Nirmaan Department", "Technology"):
            frappe.delete_doc("Nirmaan Department", "Technology", force=True, ignore_permissions=True)

    def tearDown(self):
        frappe.db.rollback()

    def test_the_patch_creates_technology_active(self):
        self.patch.execute()
        self.assertEqual(frappe.db.get_value("Nirmaan Department", "Technology", "is_active"), 1)

    def test_a_rerun_changes_nothing(self):
        self.patch.execute()
        before = frappe.db.get_value("Nirmaan Department", "Technology", ["modified", "is_active"], as_dict=True)
        self.patch.execute()
        after = frappe.db.get_value("Nirmaan Department", "Technology", ["modified", "is_active"], as_dict=True)
        self.assertEqual(before, after)
        self.assertEqual(frappe.db.count("Nirmaan Department", {"name": "Technology"}), 1)

    def test_a_dry_run_saves_nothing(self):
        self.assertTrue(self.patch.run(dry_run=True))
        self.assertFalse(frappe.db.exists("Nirmaan Department", "Technology"))
