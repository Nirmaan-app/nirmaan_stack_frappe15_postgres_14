"""A person always sees the assets assigned to them, whatever project they are booked against.

The person is a Project Manager whose User Permission allows one project; the asset is booked against
another. Their normal Asset Master read hides it (the gap), `get_my_assets` returns it. Nothing commits.

Run: bench --site localhost run-tests --module nirmaan_stack.api.assets.test_mine
"""

import unittest

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.assets.mine import MY_ASSET_FIELDS, get_my_assets
from nirmaan_stack.nirmaan_stack.doctype.asset_management.test_asset_management import (
    CATEGORY_PREFIX,
    _make_person,
    _purge,
    ensure_departments,
)

PM_PROFILE = "Nirmaan Project Manager Profile"
PM_ROLE = "Nirmaan Project Manager"


class TestGetMyAssets(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        projects = frappe.get_all("Projects", pluck="name", limit=2, order_by="creation asc")
        if len(projects) < 2:
            raise unittest.SkipTest("needs two Projects on the site")
        cls.my_project, cls.other_project = projects
        cls.departments = ensure_departments("Projects")
        cls.category = f"{CATEGORY_PREFIX} Mine {frappe.generate_hash(length=6)}"
        frappe.get_doc({"doctype": "Asset Category", "asset_category": cls.category, "category_type": "Project"}).insert(
            ignore_permissions=True
        )
        cls.person = _make_person("mine", PM_PROFILE, "Projects")
        cls.other = _make_person("other", PM_PROFILE, "Projects")
        cls.people = [cls.person, cls.other]
        # A role that reads Asset Master, limited to one project by a User Permission.
        frappe.get_doc({
            "doctype": "Has Role", "name": frappe.generate_hash(length=10), "parent": cls.person,
            "parenttype": "User", "parentfield": "roles", "role": PM_ROLE,
        }).db_insert()
        frappe.get_doc({
            "doctype": "User Permission", "name": frappe.generate_hash(length=10), "user": cls.person,
            "allow": "Projects", "for_value": cls.my_project, "apply_to_all_doctypes": 1,
        }).db_insert()
        frappe.clear_cache(user=cls.person)
        cls.assets = []

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        frappe.db.delete("Has Role", {"parent": ["in", cls.people], "parenttype": "User"})
        frappe.db.delete("User Permission", {"user": ["in", cls.people]})
        frappe.db.commit()
        _purge(cls.category, cls.assets or ["__none__"], cls.people, cls.departments)
        frappe.clear_cache(user=cls.person)
        super().tearDownClass()

    def tearDown(self):
        frappe.set_user("Administrator")

    def _asset(self, holder=None, project=None):
        """An asset booked against `project`, assigned to `holder` (as Administrator)."""
        frappe.set_user("Administrator")
        asset = frappe.get_doc({
            "doctype": "Asset Master", "asset_name": "Mine test meter", "asset_category": self.category,
            "department": "Projects", "project": project,
        }).insert(ignore_permissions=True).name
        self.assets.append(asset)
        if holder:
            frappe.get_doc({
                "doctype": "Asset Management", "asset": asset, "asset_assigned_to": holder,
                "asset_assigned_on": frappe.utils.today(),
            }).insert(ignore_permissions=True)
        return asset

    def test_an_asset_on_another_project_is_hidden_from_the_normal_read_but_returned_here(self):
        asset = self._asset(holder=self.person, project=self.other_project)
        frappe.set_user(self.person)
        self.assertEqual(frappe.get_list("Asset Master", filters={"name": asset}, pluck="name"), [])  # the gap
        mine = {row.name: row for row in get_my_assets()}
        self.assertIn(asset, mine)
        self.assertEqual(mine[asset].current_assignee, self.person)
        self.assertEqual(mine[asset].asset_category, self.category)

    def test_only_the_card_fields_come_back(self):
        self._asset(holder=self.person, project=self.other_project)
        frappe.set_user(self.person)
        for row in get_my_assets():
            self.assertEqual(set(row), set(MY_ASSET_FIELDS))  # no value, project or credentials

    def test_someone_elses_asset_is_not_returned(self):
        theirs = self._asset(holder=self.other, project=self.other_project)
        frappe.set_user(self.person)
        self.assertNotIn(theirs, [row.name for row in get_my_assets()])

    def test_an_assignment_row_for_an_asset_held_by_someone_else_still_names_the_asset(self):
        """A leftover row on the person's profile still needs the asset's name and category."""
        asset = self._asset(holder=self.other, project=self.other_project)
        frappe.get_doc({
            "doctype": "Asset Management", "name": f"zzd-mine-{frappe.generate_hash(length=6)}", "asset": asset,
            "asset_assigned_to": self.person, "asset_assigned_on": frappe.utils.today(),
        }).db_insert()
        frappe.set_user(self.person)
        mine = {row.name: row for row in get_my_assets()}
        self.assertIn(asset, mine)
        self.assertEqual(mine[asset].current_assignee, self.other)  # so the badge does not count it

    def test_guest_is_refused(self):
        frappe.set_user("Guest")
        with self.assertRaises(frappe.PermissionError):
            get_my_assets()

