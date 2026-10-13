"""Who may assign and unassign which kind of asset (owner, 2026-10-13).

Admin, HR and PMO assign and unassign every asset; procurement only Project assets. A profile that only
bundles a Role with Asset Management create/delete (Project Lead carries System Manager) is refused.

The people are bare User + Nirmaan Users rows (see test_asset_management) plus the Role their profile
bundles, so the doctype permissions pass and the profile rule is what decides. Nothing commits.

Run: bench --site localhost run-tests --module nirmaan_stack.api.assets.test_assign_access
"""

import unittest
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.assets.assign import assign_asset, unassign_asset
from nirmaan_stack.nirmaan_stack.doctype.asset_management.test_asset_management import (
    CATEGORY_PREFIX,
    _make_person,
    _purge,
    ensure_departments,
)
from nirmaan_stack.services.asset_assign_access import assign_refusal

REASON = "Returned – no longer needed"


class TestAssignRefusal(unittest.TestCase):
    def test_admin_hr_and_pmo_handle_every_kind(self):
        for kind in ("Project", "IT", None):
            self.assertIsNone(assign_refusal(kind, all_kinds=True, project_kind=False, action="assign"))

    def test_procurement_handles_project_assets_only(self):
        self.assertIsNone(assign_refusal("Project", all_kinds=False, project_kind=True, action="assign"))
        self.assertEqual(
            assign_refusal("IT", all_kinds=False, project_kind=True, action="unassign"),
            "Procurement can unassign Project assets only. Ask Admin, HR or PMO to unassign this one.",
        )
        self.assertIsNotNone(assign_refusal(None, all_kinds=False, project_kind=True, action="assign"))

    def test_everyone_else_is_refused(self):
        self.assertEqual(
            assign_refusal("Project", all_kinds=False, project_kind=False, action="assign"),
            "You don't have permission to assign assets.",
        )


class TestAssignAccess(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        cls.departments = ensure_departments("Projects")
        tag = frappe.generate_hash(length=6)
        cls.categories = {}
        for kind in ("Project", "IT"):
            name = f"{CATEGORY_PREFIX} Access {kind} {tag}"
            frappe.get_doc({"doctype": "Asset Category", "asset_category": name, "category_type": kind}).insert(
                ignore_permissions=True
            )
            cls.categories[kind] = name
        cls.procurement = cls._person("proc", "Nirmaan Procurement Executive Profile", "Nirmaan Procurement Executive")
        cls.pmo = cls._person("pmo", "Nirmaan PMO Executive Profile", "Nirmaan PMO Executive")
        cls.project_lead = cls._person("pl", "Nirmaan Project Lead Profile", "System Manager")
        cls.holder = _make_person("holder", "Nirmaan Project Manager Profile", "Projects")
        cls.people = [cls.procurement, cls.pmo, cls.project_lead, cls.holder]
        cls.assets = []

    @classmethod
    def _person(cls, tag, profile, role):
        """A test person whose profile bundles `role`, so the doctype permissions let them through."""
        email = _make_person(tag, profile, "Projects")
        frappe.get_doc({
            "doctype": "Has Role", "name": frappe.generate_hash(length=10), "parent": email,
            "parenttype": "User", "parentfield": "roles", "role": role,
        }).db_insert()
        frappe.clear_cache(user=email)
        return email

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        frappe.db.delete("Has Role", {"parent": ["in", cls.people], "parenttype": "User"})
        frappe.db.commit()
        for category in cls.categories.values():
            _purge(category, cls.assets or ["__none__"], cls.people, cls.departments)
        super().tearDownClass()

    def tearDown(self):
        frappe.set_user("Administrator")

    def _asset(self, kind, holder=None):
        """A free asset of `kind`, or one already held by `holder` (assigned as Administrator)."""
        frappe.set_user("Administrator")
        asset = frappe.get_doc({
            "doctype": "Asset Master", "asset_name": f"Access test {kind}",
            "asset_category": self.categories[kind], "department": "Projects",
        }).insert(ignore_permissions=True).name
        self.assets.append(asset)
        if holder:
            frappe.get_doc({
                "doctype": "Asset Management", "asset": asset, "asset_assigned_to": holder,
                "asset_assigned_on": frappe.utils.today(),
            }).insert(ignore_permissions=True)
        return asset

    def _holder(self, asset):
        return frappe.db.get_value("Asset Master", asset, "current_assignee")

    # -- procurement: Project assets only ---------------------------------------------------------

    def test_procurement_assigns_and_unassigns_a_project_asset(self):
        asset = self._asset("Project")
        frappe.set_user(self.procurement)
        with patch("frappe.db.commit"):
            assign_asset(asset, self.holder, frappe.utils.today())
            self.assertEqual(self._holder(asset), self.holder)
            unassign_asset(asset, REASON)
        self.assertIsNone(self._holder(asset))

    def test_procurement_cannot_assign_an_it_asset(self):
        asset = self._asset("IT")
        frappe.set_user(self.procurement)
        with patch("frappe.db.commit"):
            with self.assertRaisesRegex(frappe.PermissionError, "Project assets only"):
                assign_asset(asset, self.holder, frappe.utils.today())
        self.assertFalse(frappe.db.exists("Asset Management", {"asset": asset}))
        self.assertIsNone(self._holder(asset))

    def test_procurement_cannot_unassign_an_it_asset(self):
        asset = self._asset("IT", holder=self.holder)
        frappe.set_user(self.procurement)
        with patch("frappe.db.commit"):
            with self.assertRaisesRegex(frappe.PermissionError, "Project assets only"):
                unassign_asset(asset, REASON)
        self.assertEqual(self._holder(asset), self.holder)
        self.assertTrue(frappe.db.exists("Asset Management", {"asset": asset}))

    def test_a_direct_insert_cannot_skip_the_rule(self):
        """The REST API / Desk create the record without the endpoint; the doctype still refuses."""
        asset = self._asset("IT")
        frappe.set_user(self.procurement)
        with self.assertRaisesRegex(frappe.PermissionError, "Project assets only"):
            frappe.get_doc({
                "doctype": "Asset Management", "asset": asset, "asset_assigned_to": self.holder,
                "asset_assigned_on": frappe.utils.today(),
            }).insert()
        self.assertIsNone(self._holder(asset))

    # -- Admin, HR, PMO: every asset ----------------------------------------------------------------

    def test_pmo_assigns_and_unassigns_an_it_asset(self):
        asset = self._asset("IT")
        frappe.set_user(self.pmo)
        with patch("frappe.db.commit"):
            assign_asset(asset, self.holder, frappe.utils.today())
            self.assertEqual(self._holder(asset), self.holder)
            unassign_asset(asset, REASON)
        self.assertIsNone(self._holder(asset))

    # -- a Role is not enough -----------------------------------------------------------------------

    def test_project_lead_with_system_manager_is_refused(self):
        project_asset = self._asset("Project")
        held_asset = self._asset("Project", holder=self.holder)
        frappe.set_user(self.project_lead)
        self.assertTrue(frappe.has_permission("Asset Management", "create"))  # the Role alone would allow it
        with patch("frappe.db.commit"):
            with self.assertRaisesRegex(frappe.PermissionError, "permission to assign assets"):
                assign_asset(project_asset, self.holder, frappe.utils.today())
            with self.assertRaisesRegex(frappe.PermissionError, "permission to unassign assets"):
                unassign_asset(held_asset, REASON)
        self.assertIsNone(self._holder(project_asset))
        self.assertEqual(self._holder(held_asset), self.holder)
