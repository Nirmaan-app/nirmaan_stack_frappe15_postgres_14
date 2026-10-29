# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Financials -> Project Ledger: the customer receivable ledger narrowed to one project.

Fixtures are raw inserts (`db_insert`, no hooks) on scratch projects and throwaway users, never
committed, rolled back and then purged by name prefix in `tearDownClass`.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.projects.project_ledger import get_project_ledger_data
from nirmaan_stack.services.role_profiles import PROJECT_LEDGER_PROFILES

USER_PREFIX = "test-pledger-"


def _raw(doctype, **fields):
    """Insert a row with only the given fields, skipping every hook and validation."""
    doc = frappe.new_doc(doctype)
    doc.update(fields)
    doc.name = f"TEST-PLEDGER-{frappe.generate_hash(length=10)}"
    doc.db_insert()
    return doc.name


class TestProjectLedger(FrappeTestCase):
    """Project P has, out of date order on purpose:

    - an invoice of 1,000 on 10-Feb (customer X);
    - an advance inflow of 400 on 05-Jan (customer X);
    - an undated inflow of 250 created 01-Mar, booked to customer Y (the project's customer changed);
    - two same-day invoices on 20-Feb (300 created first, 200 second).

    Project Q has an invoice of 9,999 that must not leak into P's ledger.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.P = _raw("Projects", project_name="TEST-PLEDGER-P", status="WIP")
        cls.Q = _raw("Projects", project_name="TEST-PLEDGER-Q", status="WIP")
        cls.inv = _raw("Project Invoices", project=cls.P, customer="X", invoice_no="INV-1",
                       invoice_date="2026-02-10", amount=1000, creation="2026-02-10 09:00:00")
        cls.adv = _raw("Project Inflows", project=cls.P, customer="X", utr="UTR-ADV",
                       payment_date="2026-01-05", amount=400, creation="2026-01-05 09:00:00")
        cls.undated = _raw("Project Inflows", project=cls.P, customer="Y", utr="UTR-NODATE",
                           amount=250, creation="2026-03-01 11:00:00")
        cls.second = _raw("Project Invoices", project=cls.P, customer="X", invoice_no="INV-3",
                          invoice_date="2026-02-20", amount=200, creation="2026-02-20 12:00:00")
        cls.first = _raw("Project Invoices", project=cls.P, customer="X", invoice_no="INV-2",
                         invoice_date="2026-02-20", amount=300, creation="2026-02-20 08:00:00")
        _raw("Project Invoices", project=cls.Q, customer="X", invoice_no="INV-Q",
             invoice_date="2026-02-15", amount=9999, creation="2026-02-15 09:00:00")

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        # By name prefix, so the empty project and the users made inside a test are caught too.
        # One scope per try, each committed: a failed delete must not strand the rest.
        failures = []
        scopes = [
            ("Project Invoices", {"name": ["like", "TEST-PLEDGER-%"]}),
            ("Project Inflows", {"name": ["like", "TEST-PLEDGER-%"]}),
            ("Projects", {"name": ["like", "TEST-PLEDGER-%"]}),
            ("User Permission", {"user": ["like", f"{USER_PREFIX}%"]}),
            ("Has Role", {"parent": ["like", f"{USER_PREFIX}%"], "parenttype": "User"}),
            ("Nirmaan Users", {"name": ["like", f"{USER_PREFIX}%"]}),
            ("User", {"name": ["like", f"{USER_PREFIX}%"]}),
        ]
        for doctype, filters in scopes:
            try:
                frappe.db.delete(doctype, filters)
                frappe.db.commit()
            except Exception as e:
                frappe.db.rollback()
                failures.append(f"{doctype}: {e}")
        super().tearDownClass()
        if failures:
            raise AssertionError(f"test_project_ledger clean-up failed: {failures}")

    def tearDown(self):
        frappe.set_user("Administrator")

    def _user(self, profile, projects=()):
        """A throwaway user on `profile` (its Nirmaan Users row and the profile's roles), held to
        `projects` by User Permission rows. Written with `db_insert`: a normal insert runs our
        Nirmaan Users / User Permission hooks."""
        user = f"{USER_PREFIX}{frappe.generate_hash(length=8)}@example.com"
        now = frappe.utils.now()

        def insert(doc, name):
            doc.name = name
            doc.creation = doc.modified = now
            doc.owner = doc.modified_by = "Administrator"
            doc.db_insert()

        insert(frappe.get_doc({
            "doctype": "User", "email": user, "first_name": "Project ledger test", "enabled": 1,
            "user_type": "System User", "send_welcome_email": 0, "role_profile_name": profile,
        }), user)
        insert(frappe.get_doc({
            "doctype": "Nirmaan Users", "email": user, "first_name": "Project ledger test", "role_profile": profile,
        }), user)
        for i, role in enumerate(r.role for r in frappe.get_doc("Role Profile", profile).roles):
            insert(frappe.get_doc({
                "doctype": "Has Role", "role": role, "parent": user, "parenttype": "User",
                "parentfield": "roles", "idx": i + 1,
            }), frappe.generate_hash(length=10))
        for project in projects:
            insert(frappe.get_doc({
                "doctype": "User Permission", "user": user, "allow": "Projects", "for_value": project,
            }), f"TEST-PLEDGER-UP-{frappe.generate_hash(length=10)}")
        frappe.cache.hdel("user_permissions", user)
        frappe.cache.hdel("roles", user)
        frappe.local.role_cache = {}
        return user

    def test_rows_are_this_project_only_in_date_order(self):
        rows = get_project_ledger_data(self.P)

        self.assertEqual(
            [(r["date"], r["type"], r["invoice"], r["inflow"]) for r in rows],
            [
                ("2026-01-05", "Inflow Received", 0, 400),
                ("2026-02-10", "Invoice Raised", 1000, 0),
                # Same day: `creation` breaks the tie.
                ("2026-02-20", "Invoice Raised", 300, 0),
                ("2026-02-20", "Invoice Raised", 200, 0),
                # No payment_date: falls back to the creation date, not today.
                ("2026-03-01", "Inflow Received", 0, 250),
            ],
        )
        self.assertTrue(all(r["project_id"] == self.P for r in rows))
        self.assertEqual(rows[0]["project"], "TEST-PLEDGER-P")
        self.assertIn(f"Ref: {self.first}", rows[2]["details"])

    def test_closing_receivable(self):
        rows = get_project_ledger_data(self.P)
        self.assertEqual(sum(r["invoice"] - r["inflow"] for r in rows), 1000 + 300 + 200 - 400 - 250)

    def test_project_with_no_activity_is_empty(self):
        empty = _raw("Projects", project_name="TEST-PLEDGER-EMPTY", status="WIP")
        self.assertEqual(get_project_ledger_data(empty), [])

    def test_project_id_is_required(self):
        with self.assertRaises(frappe.ValidationError):
            get_project_ledger_data("")

    def test_unknown_project_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            get_project_ledger_data("TEST-PLEDGER-DOES-NOT-EXIST")

    def test_profiles_outside_the_ledger_list_are_refused(self):
        # Sales, Estimates and Billing keep other Financials sub-tabs but not the ledger (owner, 2026-10-28).
        refused = [
            "Nirmaan Sales Executive Profile", "Nirmaan Sales Lead Profile",
            "Nirmaan Estimates Executive Profile", "Nirmaan Billing Executive Profile",
            "Nirmaan Project Manager Profile", "Nirmaan Project Lead Profile",
            "Nirmaan Procurement Executive Profile",
        ]
        checked = 0
        for profile in refused:
            if not frappe.db.exists("Role Profile", profile):
                continue
            frappe.set_user(self._user(profile))
            with self.assertRaises(frappe.PermissionError, msg=profile):
                get_project_ledger_data(self.P)
            frappe.set_user("Administrator")
            checked += 1
        self.assertGreater(checked, 0, "no refused profile exists on this site, so this test proves nothing")

    def test_ledger_profiles_read_an_unrestricted_project(self):
        for profile in PROJECT_LEDGER_PROFILES:
            frappe.set_user(self._user(profile))
            rows = get_project_ledger_data(self.P)
            frappe.set_user("Administrator")
            self.assertEqual(len(rows), 5, profile)

    def test_a_user_permission_limits_which_projects(self):
        # PMO held to Q by a User Permission row reads Q's ledger but not P's.
        frappe.set_user(self._user("Nirmaan PMO Executive Profile", projects=[self.Q]))
        self.assertEqual([r["invoice"] for r in get_project_ledger_data(self.Q)], [9999])
        with self.assertRaises(frappe.PermissionError):
            get_project_ledger_data(self.P)
