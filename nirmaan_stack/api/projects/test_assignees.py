# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for `api/projects/assignees.remove_project_assignee`.

These run against the LIVE site DB (there is no separate test DB), so every row created
here is removed again, and the one real user borrowed for the assignment is chosen so it
is left exactly as it was: someone already on at least one OTHER project, so removing the
test assignment never flips their `Nirmaan Users.has_project`.
"""

import unittest
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.projects import assignees
from nirmaan_stack.services import role_profiles


def _raw(doctype, name=None, **fields):
    """Insert a row with only the given fields, skipping ALL hooks/validation."""
    d = frappe.new_doc(doctype)
    d.update(fields)
    d.name = name or frappe.generate_hash(length=12)
    d.db_insert()
    return d.name


class TestRemoveProjectAssignee(FrappeTestCase):
    #: Every `User Permission` this suite inserts, so tearDownClass can clear the
    #: `Deleted Document` rows its removals leave behind -- and nobody else's.
    _created_permissions = set()

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        rows = frappe.db.sql(
            """
            select u."user" from "tabUser Permission" u
            join "tabNirmaan Users" n on n.name = u."user"
            where u.allow = 'Projects' and n.has_project = 'true'
            limit 1
            """
        )
        if not rows:
            raise unittest.SkipTest("No live user is assigned to a project to borrow.")
        cls.user = rows[0][0]

        cls.project = "TEST-ASSIGN-" + frappe.generate_hash(length=8)
        _raw("Projects", name=cls.project, project_name=cls.project)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        for row in frappe.get_all(
            "Deleted Document",
            filters={"deleted_doctype": "User Permission"},
            fields=["name", "deleted_name"],
            limit_page_length=0,
        ):
            if row.deleted_name in cls._created_permissions:
                frappe.delete_doc("Deleted Document", row.name, force=True, ignore_permissions=True)
        frappe.db.delete("Projects", {"name": cls.project})
        frappe.db.commit()
        super().tearDownClass()

    def tearDown(self):
        frappe.set_user("Administrator")
        for name in frappe.get_all("User Permission", filters=self._match(), pluck="name"):
            frappe.delete_doc("User Permission", name, ignore_permissions=True)
        frappe.db.delete("Nirmaan User Permissions", {"allow": "Projects", "for_value": self.project})
        frappe.db.commit()

    # -- helpers ---------------------------------------------------------------

    def _match(self):
        return {"user": self.user, "allow": "Projects", "for_value": self.project}

    def _assign(self):
        """Assign the way the card does: a real insert, so the mirror row is made by the hook."""
        doc = frappe.get_doc({"doctype": "User Permission", **self._match()})
        doc.insert(ignore_permissions=True)
        type(self)._created_permissions.add(doc.name)
        frappe.db.commit()
        return doc.name

    # -- tests -----------------------------------------------------------------

    def test_admin_removes_the_assignment_and_the_card_row(self):
        self._assign()
        # The after_insert hook mirrored it -- this row is what the Assignees card reads.
        self.assertTrue(frappe.db.exists("Nirmaan User Permissions", self._match()))

        assignees.remove_project_assignee(project=self.project, user=self.user)

        self.assertFalse(frappe.db.exists("User Permission", self._match()))
        self.assertFalse(frappe.db.exists("Nirmaan User Permissions", self._match()))
        # Still on other projects, so the flag is untouched.
        self.assertEqual(frappe.db.get_value("Nirmaan Users", self.user, "has_project"), "true")

    def test_a_card_row_with_no_user_permission_behind_it_is_still_removed(self):
        # The drift case: the card shows a mirror row that has no real assignment.
        _raw("Nirmaan User Permissions", user=self.user, allow="Projects", for_value=self.project)
        frappe.db.commit()

        assignees.remove_project_assignee(project=self.project, user=self.user)

        self.assertFalse(frappe.db.exists("Nirmaan User Permissions", self._match()))
        self.assertEqual(frappe.db.get_value("Nirmaan Users", self.user, "has_project"), "true")

    def test_only_an_admin_may_remove(self):
        self._assign()
        try:
            # PMO and Project Lead may ASSIGN, but not remove -- the narrowing is the point.
            for profile in ("Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile"):
                frappe.session.user = "assignee-tester@example.com"
                with patch.object(role_profiles, "get_role_profile", return_value=profile):
                    with self.assertRaises(frappe.PermissionError):
                        assignees.remove_project_assignee(project=self.project, user=self.user)
        finally:
            frappe.session.user = "Administrator"

        self.assertTrue(frappe.db.exists("User Permission", self._match()))
        self.assertTrue(frappe.db.exists("Nirmaan User Permissions", self._match()))

    def test_removing_someone_not_assigned_says_so(self):
        with self.assertRaises(frappe.ValidationError):
            assignees.remove_project_assignee(project=self.project, user=self.user)
