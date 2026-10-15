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


class _SerializationFailure(Exception):
    """PostgreSQL's "could not serialize access due to concurrent update" (what a second, simultaneous lock gets)."""

    pgcode = "40001"


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
        cls.hr_lead = cls._person("hrlead", "Nirmaan HR Lead Profile", "Nirmaan HR Lead")
        cls.project_lead = cls._person("pl", "Nirmaan Project Lead Profile", "System Manager")
        cls.holder = _make_person("holder", "Nirmaan Project Manager Profile", "Projects")
        cls.people = [cls.procurement, cls.pmo, cls.hr_lead, cls.project_lead, cls.holder]
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

    def test_hr_lead_assigns_and_unassigns_every_kind_like_hr_executive(self):
        """HR Lead has every asset permission HR Executive has (owner, 2026-10-15)."""
        for kind in ("IT", "Project"):
            asset = self._asset(kind)
            frappe.set_user(self.hr_lead)
            with patch("frappe.db.commit"):
                assign_asset(asset, self.holder, frappe.utils.today())
                self.assertEqual(self._holder(asset), self.holder, kind)
                unassign_asset(asset, REASON)
            self.assertIsNone(self._holder(asset), kind)

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


    # -- safeguards (owner, 2026-10-15): a plain message when two people act at once (#6), no move into an
    # inactive department (#8), a Won project on a Project asset only (#9). Run as Administrator.

    def _assign(self, asset, project=None, person=None):
        frappe.set_user("Administrator")
        with patch("frappe.db.commit"):
            return assign_asset(asset, person or self.holder, frappe.utils.today(), project=project)

    def _project(self, won=True):
        project = frappe.db.get_value("Projects", {"tendering_status": "Won" if won else ["!=", "Won"]}, "name")
        if not project:
            self.skipTest(f"no {'Won' if won else 'non-Won'} project on this site")
        return project

    # -- #6: two people at once --------------------------------------------------------------------

    def test_a_second_simultaneous_assign_gets_a_plain_message(self):
        asset = self._asset("IT")
        real = frappe.db.get_value

        def lock_fails(*args, **kwargs):
            if kwargs.get("for_update"):
                raise _SerializationFailure()
            return real(*args, **kwargs)

        with patch.object(frappe.db, "get_value", side_effect=lock_fails):
            with self.assertRaisesRegex(frappe.ValidationError, "just assigned or changed by someone else"):
                self._assign(asset)

    # -- #8: inactive department -------------------------------------------------------------------

    def test_assigning_into_an_inactive_department_is_refused(self):
        frappe.set_user("Administrator")
        department = f"ZZD Inactive {frappe.generate_hash(length=6)}"
        frappe.get_doc({"doctype": "Nirmaan Department", "department_name": department, "is_active": 0}).insert(
            ignore_permissions=True
        )
        self.departments.append(department)
        person = _make_person("inactive-dept", "Nirmaan Project Manager Profile", department)
        self.people.append(person)
        asset = self._asset("IT")
        with self.assertRaisesRegex(frappe.ValidationError, f"The {department} department is inactive. Report it to the admin."):
            self._assign(asset, person=person)
        self.assertIsNone(self._holder(asset))
        self.assertEqual(frappe.db.get_value("Asset Master", asset, "department"), "Projects")

    # -- #9: a Won project on a Project asset only -----------------------------------------------------

    def test_assign_books_a_won_project_on_a_project_asset(self):
        project = frappe.db.get_value(
            "Projects", {"tendering_status": "Won", "project_city": ["is", "set"]}, ["name", "project_city"], as_dict=True
        ) or frappe._dict(name=self._project(), project_city=None)
        asset = self._asset("Project")
        self._assign(asset, project=project.name)
        booked = frappe.db.get_value("Asset Master", asset, ["project", "asset_city"], as_dict=True)
        self.assertEqual((booked.project, booked.asset_city), (project.name, project.project_city))

    def test_assign_refuses_a_bad_project_and_writes_nothing(self):
        cases = [("Project", "ZZD-NO-SUCH-PROJECT", "doesn't exist"), ("IT", self._project(), "Only Project assets")]
        not_won = frappe.db.get_value("Projects", {"tendering_status": ["!=", "Won"]}, "name")
        if not_won:
            cases.append(("Project", not_won, "isn't Won"))
        for kind, project, message in cases:
            asset = self._asset(kind)
            with self.assertRaisesRegex(frappe.ValidationError, message, msg=(kind, project)):
                self._assign(asset, project=project)
            self.assertIsNone(self._holder(asset), (kind, project))
            self.assertFalse(frappe.db.get_value("Asset Master", asset, "project"), (kind, project))

    def test_editing_an_asset_checks_the_project_only_when_it_changes(self):
        asset = self._asset("Project")
        frappe.set_user("Administrator")
        doc = frappe.get_doc("Asset Master", asset)
        doc.project = self._project(won=False)
        with self.assertRaisesRegex(frappe.ValidationError, "isn't Won"):
            doc.save(ignore_permissions=True)
        # Booked earlier to a project that is no longer Won: an unrelated edit still saves.
        frappe.db.set_value("Asset Master", asset, "project", doc.project)
        doc = frappe.get_doc("Asset Master", asset)
        doc.asset_description = "edited later"
        doc.save(ignore_permissions=True)
        doc.project = self._project()
        doc.save(ignore_permissions=True)
        self.assertEqual(frappe.db.get_value("Asset Master", asset, "project"), doc.project)
