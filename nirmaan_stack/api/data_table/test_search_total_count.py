# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The data-table total must count only the rows the user may see.

A project-scoped user (User Permission rows on Projects) saw "1-5 of 5" over 4 rows: the standard
list path counted with `frappe.db.count`, which applies no permissions, while the rows came through
reportview, which does.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Nothing here commits: the projects, the user, its role and
its User Permission rows are all written inside the test's transaction and rolled back in
`tearDown`, then the per-user permission caches are dropped.

Run:  bench --site localhost run-tests --module nirmaan_stack.api.data_table.test_search_total_count
"""

import unittest

import frappe

from nirmaan_stack.api.data_table.search import get_list_with_count_enhanced_impl

READ_ROLE = "Nirmaan Project Manager"  # can read Projects; scoping comes only from User Permissions


class DataTableTotalCountTest(unittest.TestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.prefix = f"TEST-DTCNT-{frappe.generate_hash(length=6).upper()}"
        self.project_a = self._project("A")
        self.project_b = self._project("B")
        self.users = []

    def tearDown(self):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        for user in self.users:
            frappe.cache.hdel("user_permissions", user)
            frappe.cache.hdel("roles", user)
        leaked = frappe.db.exists("Projects", {"name": ["like", f"{self.prefix}-%"]})
        self.assertFalse(leaked, f"test data for {self.prefix} survived the rollback")
        super().tearDown()

    # --- fixtures (direct inserts: a normal insert would run our hooks) -----------------------

    def _project(self, suffix):
        name = f"{self.prefix}-{suffix}"
        frappe.get_doc({
            "doctype": "Projects",
            "name": name,
            "project_name": name,
            "tendering_status": "Won",
        }).db_insert()
        return name

    def _user(self, *projects):
        """A user with READ_ROLE whose Projects User Permissions allow only `projects` (none = all)."""
        user = f"dt-count-{frappe.generate_hash(length=8)}@example.com"
        self.users.append(user)
        now = frappe.utils.now()

        def insert(doc, name):
            doc.name = name
            doc.creation = doc.modified = now
            doc.owner = doc.modified_by = "Administrator"
            doc.db_insert()

        insert(frappe.get_doc({"doctype": "User", "email": user, "first_name": "DT count test",
                               "enabled": 1, "user_type": "System User", "send_welcome_email": 0}), user)
        insert(frappe.get_doc({"doctype": "Has Role", "parent": user, "parenttype": "User",
                               "parentfield": "roles", "role": READ_ROLE}), frappe.generate_hash(length=10))
        for project in projects:
            insert(frappe.get_doc({"doctype": "User Permission", "user": user, "allow": "Projects",
                                   "for_value": project}), frappe.generate_hash(length=10))
        frappe.cache.hdel("user_permissions", user)
        frappe.cache.hdel("roles", user)
        return user

    def _list_as(self, user):
        frappe.set_user(user)
        try:
            return get_list_with_count_enhanced_impl(
                doctype="Projects",
                fields=["name"],
                filters=[["Projects", "name", "like", f"{self.prefix}-%"]],
                limit_page_length=50,
            )
        finally:
            frappe.set_user("Administrator")

    # --- tests -------------------------------------------------------------------------------

    def test_scoped_user_total_counts_only_permitted_rows(self):
        result = self._list_as(self._user(self.project_a))
        self.assertEqual([row["name"] for row in result["data"]], [self.project_a])
        self.assertEqual(result["total_count"], 1)

    def test_unscoped_user_total_counts_every_row(self):
        result = self._list_as(self._user())
        self.assertEqual(sorted(row["name"] for row in result["data"]), [self.project_a, self.project_b])
        self.assertEqual(result["total_count"], 2)

    def test_total_equals_rows_on_a_single_page(self):
        result = self._list_as(self._user(self.project_a, self.project_b))
        self.assertEqual(result["total_count"], len(result["data"]))


if __name__ == "__main__":
    unittest.main()
