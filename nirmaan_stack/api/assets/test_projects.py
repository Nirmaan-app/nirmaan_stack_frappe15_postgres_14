"""The Assign dialog's Project picker lists every Won project, whatever the assigner is allowed on.

The assigner is a procurement user whose User Permission allows one project: their plain Projects
read shows only that one (the gap); `get_won_projects` shows them all. Nothing commits.

Run: bench --site localhost run-tests --module nirmaan_stack.api.assets.test_projects
"""

import unittest

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.assets.projects import PROJECT_FIELDS, get_won_projects
from nirmaan_stack.nirmaan_stack.doctype.asset_management.test_asset_management import _make_person


class TestGetWonProjects(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        cls.won = frappe.get_all("Projects", filters={"tendering_status": "Won"}, pluck="name")
        if len(cls.won) < 2:
            raise unittest.SkipTest("needs two Won projects on the site")
        cls.procurement = cls._person("proc", "Nirmaan Procurement Executive Profile", "Nirmaan Procurement Executive")
        cls.pm = cls._person("pm", "Nirmaan Project Manager Profile", "Nirmaan Project Manager")
        cls.people = [cls.procurement, cls.pm]
        frappe.get_doc({
            "doctype": "User Permission", "name": frappe.generate_hash(length=10), "user": cls.procurement,
            "allow": "Projects", "for_value": cls.won[0], "apply_to_all_doctypes": 1,
        }).db_insert()
        frappe.clear_cache(user=cls.procurement)

    @classmethod
    def _person(cls, tag, profile, role):
        email = _make_person(tag, profile)
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
        for doctype, filters in (
            ("Has Role", {"parent": ["in", cls.people], "parenttype": "User"}),
            ("User Permission", {"user": ["in", cls.people]}),
            ("Nirmaan Users", {"name": ["in", cls.people]}),
            ("User", {"name": ["in", cls.people]}),
        ):
            frappe.db.delete(doctype, filters)
        frappe.db.commit()
        frappe.clear_cache(user=cls.procurement)
        super().tearDownClass()

    def tearDown(self):
        frappe.set_user("Administrator")

    def test_procurement_allowed_on_one_project_gets_every_won_project(self):
        frappe.set_user(self.procurement)
        self.assertEqual(frappe.get_list("Projects", filters={"tendering_status": "Won"}, pluck="name"), [self.won[0]])  # the gap
        self.assertEqual(sorted(row.name for row in get_won_projects()), sorted(self.won))

    def test_only_won_projects_and_only_the_picker_fields(self):
        frappe.set_user(self.procurement)
        for row in get_won_projects():
            self.assertEqual(row.tendering_status, "Won")
            self.assertEqual(set(row), set(PROJECT_FIELDS))

    def test_someone_who_cannot_assign_is_refused(self):
        frappe.set_user(self.pm)
        with self.assertRaises(frappe.PermissionError):
            get_won_projects()
