# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""
Phase-3 tests for the Project Action Item READ endpoints (api/action_items/read.py).

THE WHOLE POINT of this slice is the PERMISSION GATE (red-team "Critical": a bare
whitelist would leak cross-project data). So the load-bearing assertions run as a
NON-SUPERUSER via `frappe.set_user(test_user_email)` — tests otherwise run as
Administrator, who is a superuser and bypasses the project-scoping the gate enforces.

Fixture chain (built in setUpClass, torn down in tearDownClass):
  * TWO Projects: one the test user may access (`allowed_project`) and one they may NOT
    (`forbidden_project`), each seeded with one Open `Project Action Item`.
  * A THIRD project (`orphan_project`) with an Open row but NO assigned PM — proves a
    full-access user (Administrator) still sees orphan-project rows in get_my_action_items.
  * A real Frappe `User` + a `Nirmaan Users` row (name == email, `role_profile` =
    "Nirmaan Project Manager Profile" → a FILTERED_ACCESS_ROLE) so the gate treats the
    test user as scoped, NOT full-access.
  * A `Nirmaan User Permissions` row (user=email, allow=Projects, for_value=allowed_project)
    granting access to EXACTLY the allowed project.
  * A SECOND scoped user (`noperm`) with a Nirmaan Users row but ZERO permissions →
    proves get_my_action_items returns [] (no leak) for an unassigned user.

Every test that switches user resets back to Administrator in a `finally`, and tearDown
hard-resets, so the suite is never left on a switched user.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.action_items.read import (
    get_my_action_items,
    get_project_action_items,
)
from nirmaan_stack.services.action_items.predicates import (
    ACTION_DC_PENDING,
    ACTION_DN_PENDING,
    ASSIGNED_ROLE_PM,
)

# A FILTERED_ACCESS_ROLE — the gate must SCOPE (not full-access) a user carrying it.
_PM_ROLE = "Nirmaan Project Manager Profile"
_REFERENCE_DOCTYPE = "Procurement Orders"


def _make_project(suffix):
    project = frappe.new_doc("Projects")
    project.project_name = f"_TEST_PAI_READ_{suffix}_{frappe.generate_hash(length=6)}"
    project.project_start_date = frappe.utils.now()[:19]
    project.project_end_date = frappe.utils.add_to_date(
        frappe.utils.now()[:19], years=1
    )[:19]
    project.project_scopes = {"scopes": []}
    project.insert(ignore_permissions=True)
    return project.name


def _make_action_item(project, action_type, ref_name, status="Open"):
    """Insert an Open Project Action Item directly (the reconciler is not under test)."""
    doc = frappe.new_doc("Project Action Item")
    doc.project = project
    doc.action_type = action_type
    doc.reference_doctype = _REFERENCE_DOCTYPE
    doc.reference_name = ref_name
    doc.status = status
    doc.assigned_role = ASSIGNED_ROLE_PM
    doc.dedup_key = f"{project}::{ref_name}::{action_type}"
    doc.title = f"{action_type} — {ref_name}"
    doc.action_url = f"/projects/{project}?page=projectdcmir"
    doc.first_opened_at = frappe.utils.now_datetime()
    doc.last_opened_at = frappe.utils.now_datetime()
    doc.source = "reconcile"
    doc.insert(ignore_permissions=True, ignore_links=True)
    return doc.name


def _make_po(project, vendor_name, dispatch_date, latest_delivery_date):
    """Seed a Procurement Order row carrying the three fields Surface A hydrates.

    Inserted directly into `tabProcurement Orders` (NOT via doc.insert) on purpose: the PO
    controller's after_insert demands a full PR graph + fires notifications/vendor-credit
    logic, none of which this read-endpoint test needs. The enrichment reads the PO via
    `frappe.get_all` (a plain SELECT over the table), so a direct row insert is sufficient
    and keeps the fixture minimal. Procurement Orders has no autoname → we set `name`.
    """
    name = f"PO/PAI-{frappe.generate_hash(length=8)}"
    frappe.db.sql(
        """
        INSERT INTO `tabProcurement Orders`
            (name, creation, modified, owner, modified_by,
             project, vendor_name, dispatch_date, latest_delivery_date)
        VALUES (%(name)s, %(now)s, %(now)s, %(user)s, %(user)s,
             %(project)s, %(vendor_name)s, %(dispatch_date)s, %(latest_delivery_date)s)
        """,
        {
            "name": name,
            "now": frappe.utils.now(),
            "user": frappe.session.user,
            "project": project,
            "vendor_name": vendor_name,
            "dispatch_date": dispatch_date,
            "latest_delivery_date": latest_delivery_date,
        },
    )
    return name


def _make_scoped_user(email, role_profile):
    """Create a Frappe User + a Nirmaan Users row (name==email) with a role_profile.

    The gate's `_get_user_role` reads `Nirmaan Users.<email>.role_profile`, and
    `frappe.set_user(email)` needs a real enabled User. We create both explicitly
    (ignore_permissions) and force the role_profile so the user is treated as scoped.
    """
    if not frappe.db.exists("User", email):
        user = frappe.new_doc("User")
        user.email = email
        user.first_name = "PAI"
        user.last_name = "Tester"
        user.send_welcome_email = 0
        user.enabled = 1
        user.insert(ignore_permissions=True)

    # The User after_insert hook may auto-create the Nirmaan Users row; ensure it
    # exists and carries the role_profile the gate must read.
    if not frappe.db.exists("Nirmaan Users", email):
        nu = frappe.new_doc("Nirmaan Users")
        nu.first_name = "PAI"
        nu.last_name = "Tester"
        nu.email = email
        nu.role_profile = role_profile
        nu.insert(ignore_permissions=True)
    else:
        frappe.db.set_value(
            "Nirmaan Users", email, "role_profile", role_profile, update_modified=False
        )


def _grant_project(email, project):
    """Grant the user access to a project via Nirmaan User Permissions (allow=Projects)."""
    perm = frappe.new_doc("Nirmaan User Permissions")
    perm.user = email
    perm.allow = "Projects"
    perm.for_value = project
    perm.insert(ignore_permissions=True, ignore_links=True)
    return perm.name


class TestActionItemReadEndpoints(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        h = frappe.generate_hash(length=6)
        cls.user_email = f"pai_scoped_{h}@example.com"
        cls.noperm_email = f"pai_noperm_{h}@example.com"

        # --- projects ---------------------------------------------------- #
        cls.allowed_project = _make_project("ALLOW")
        cls.forbidden_project = _make_project("FORBID")
        cls.orphan_project = _make_project("ORPHAN")  # has a row but no assigned PM

        # --- action items ------------------------------------------------ #
        cls.allowed_dn = _make_action_item(
            cls.allowed_project, ACTION_DN_PENDING, "PO/ALLOW-1"
        )
        cls.allowed_dc = _make_action_item(
            cls.allowed_project, ACTION_DC_PENDING, "PO/ALLOW-2"
        )
        cls.forbidden_dn = _make_action_item(
            cls.forbidden_project, ACTION_DN_PENDING, "PO/FORBID-1"
        )
        cls.orphan_dn = _make_action_item(
            cls.orphan_project, ACTION_DN_PENDING, "PO/ORPHAN-1"
        )
        # A Resolved row on the allowed project — must NEVER be returned (Open-only).
        cls.allowed_resolved = _make_action_item(
            cls.allowed_project, ACTION_DC_PENDING, "PO/ALLOW-RESOLVED",
            status="Resolved",
        )

        # --- a real PO + a row referencing it (Surface A enrichment) ------- #
        # Seed a PO on the allowed project with the three hydrated fields set, plus an
        # Open row pointing at it, so get_my_action_items must surface vendor + dates.
        cls.po_vendor = "ACME Cement Co."
        cls.po_dispatch_date = "2026-06-20 10:30:00"
        cls.po_delivery_date = "2026-06-25 16:45:00"
        cls.allowed_po = _make_po(
            cls.allowed_project,
            cls.po_vendor,
            cls.po_dispatch_date,
            cls.po_delivery_date,
        )
        cls.allowed_po_dn = _make_action_item(
            cls.allowed_project, ACTION_DN_PENDING, cls.allowed_po
        )

        # --- users + permissions ----------------------------------------- #
        # Scoped PM user, allowed ONLY the allowed_project.
        _make_scoped_user(cls.user_email, _PM_ROLE)
        cls.perm_name = _grant_project(cls.user_email, cls.allowed_project)
        # A second scoped user with ZERO project permissions.
        _make_scoped_user(cls.noperm_email, _PM_ROLE)

        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        frappe.db.delete(
            "Nirmaan User Permissions",
            {"user": ["in", [cls.user_email, cls.noperm_email]]},
        )
        for project in (cls.allowed_project, cls.forbidden_project, cls.orphan_project):
            frappe.db.delete("Project Action Item", {"project": project})
        # Drop the seeded PO before its project (Procurement Orders links to Projects).
        frappe.db.delete("Procurement Orders", {"project": cls.allowed_project})
        for email in (cls.user_email, cls.noperm_email):
            if frappe.db.exists("Nirmaan Users", email):
                frappe.delete_doc(
                    "Nirmaan Users", email, force=True, ignore_permissions=True
                )
            if frappe.db.exists("User", email):
                frappe.delete_doc("User", email, force=True, ignore_permissions=True)
        for project in (cls.allowed_project, cls.forbidden_project, cls.orphan_project):
            frappe.delete_doc("Projects", project, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDownClass()

    def tearDown(self):
        # Never leave the suite on a switched user, even if a test asserts mid-switch.
        frappe.set_user("Administrator")

    # ================================================================== #
    # (a) scoped user can read its allowed project                       #
    # ================================================================== #

    def test_scoped_user_reads_allowed_project(self):
        frappe.set_user(self.user_email)
        try:
            result = get_project_action_items(self.allowed_project)
        finally:
            frappe.set_user("Administrator")

        items = result["action_items"]
        # Three Open rows on the allowed project: the original DN + DC, plus the row
        # referencing the seeded PO (the Resolved one is excluded).
        self.assertEqual(len(items), 3)
        projects = {row["project"] for row in items}
        self.assertEqual(projects, {self.allowed_project})
        statuses = {row["status"] for row in items}
        self.assertEqual(statuses, {"Open"})
        # The payload carries the display + grouping fields.
        for row in items:
            self.assertIn("title", row)
            self.assertIn("action_url", row)
            self.assertIn("assigned_role", row)

    def test_resolved_row_is_never_returned(self):
        frappe.set_user(self.user_email)
        try:
            result = get_project_action_items(self.allowed_project)
        finally:
            frappe.set_user("Administrator")
        names = {row["name"] for row in result["action_items"]}
        self.assertNotIn(self.allowed_resolved, names)

    # ================================================================== #
    # (b) scoped user is DENIED a forbidden project (the Critical gate)  #
    # ================================================================== #

    def test_scoped_user_denied_forbidden_project(self):
        frappe.set_user(self.user_email)
        try:
            with self.assertRaises(frappe.PermissionError):
                get_project_action_items(self.forbidden_project)
        finally:
            frappe.set_user("Administrator")

    # ================================================================== #
    # (c) get_my_action_items as the scoped user → ONLY allowed rows     #
    # ================================================================== #

    def test_my_action_items_scoped_user_sees_only_allowed(self):
        frappe.set_user(self.user_email)
        try:
            result = get_my_action_items()
        finally:
            frappe.set_user("Administrator")

        items = result["action_items"]
        projects = {row["project"] for row in items}
        # ONLY the allowed project — never the forbidden or orphan project.
        self.assertEqual(projects, {self.allowed_project})
        self.assertNotIn(self.forbidden_project, projects)
        self.assertNotIn(self.orphan_project, projects)
        self.assertTrue(all(row["status"] == "Open" for row in items))

    # ================================================================== #
    # (d) full-access (Administrator) sees rows across projects, incl.   #
    #     the orphan (no-PM) project                                     #
    # ================================================================== #

    def test_my_action_items_admin_sees_all_including_orphan(self):
        # Runs as Administrator (the default test user → full-access, no scoping).
        result = get_my_action_items()
        projects = {row["project"] for row in result["action_items"]}
        self.assertIn(self.allowed_project, projects)
        self.assertIn(self.forbidden_project, projects)
        # The orphan case: a project with an Open row but NO assigned PM is still
        # visible to a full-access user on Surface A.
        self.assertIn(self.orphan_project, projects)

    def test_admin_reads_any_project_without_permission(self):
        # Administrator may read the forbidden project directly (full-access bypass).
        result = get_project_action_items(self.forbidden_project)
        self.assertEqual(len(result["action_items"]), 1)
        self.assertEqual(
            result["action_items"][0]["project"], self.forbidden_project
        )

    # ================================================================== #
    # (d2) Surface A enrichment: rows carry the referenced PO's vendor +  #
    #      dates, hydrated by ONE bulk PO fetch                           #
    # ================================================================== #

    def test_my_action_items_rows_hydrate_po_vendor_and_dates(self):
        # As the scoped PM (sees only the allowed project, which holds the seeded PO).
        frappe.set_user(self.user_email)
        try:
            result = get_my_action_items()
        finally:
            frappe.set_user("Administrator")

        items = result["action_items"]
        # Every Surface-A row carries the three hydrated keys (present even when None).
        for row in items:
            self.assertIn("vendor_name", row)
            self.assertIn("dispatch_date", row)
            self.assertIn("latest_delivery_date", row)

        # The row pointing at the seeded PO carries that PO's vendor + dates.
        row = next(r for r in items if r["reference_name"] == self.allowed_po)
        self.assertEqual(row["vendor_name"], self.po_vendor)
        self.assertEqual(str(row["dispatch_date"]), self.po_dispatch_date)
        self.assertEqual(str(row["latest_delivery_date"]), self.po_delivery_date)

    def test_my_action_items_dangling_po_ref_hydrates_to_none(self):
        # The original allowed-project rows reference made-up PO names ("PO/ALLOW-1") that
        # do not exist as Procurement Orders → enrichment must set the three keys to None
        # (defensive: never drop the row, never trip on a dangling ref).
        result = get_my_action_items()  # Administrator → sees all rows
        dangling = next(
            r for r in result["action_items"] if r["reference_name"] == "PO/ALLOW-1"
        )
        self.assertIsNone(dangling["vendor_name"])
        self.assertIsNone(dangling["dispatch_date"])
        self.assertIsNone(dangling["latest_delivery_date"])

    # ================================================================== #
    # (e) a user with NO project permissions → get_my_action_items == [] #
    # ================================================================== #

    def test_my_action_items_user_without_permissions_is_empty(self):
        frappe.set_user(self.noperm_email)
        try:
            result = get_my_action_items()
        finally:
            frappe.set_user("Administrator")
        self.assertEqual(result["action_items"], [])

    def test_noperm_user_denied_every_project(self):
        frappe.set_user(self.noperm_email)
        try:
            for project in (
                self.allowed_project,
                self.forbidden_project,
                self.orphan_project,
            ):
                with self.assertRaises(frappe.PermissionError):
                    get_project_action_items(project)
        finally:
            frappe.set_user("Administrator")

    # ================================================================== #
    # guard: missing project_name throws                                #
    # ================================================================== #

    def test_missing_project_name_throws(self):
        with self.assertRaises(frappe.ValidationError):
            get_project_action_items("")
