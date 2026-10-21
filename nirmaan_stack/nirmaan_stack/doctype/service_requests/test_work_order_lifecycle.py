# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Who may move a Work Order, and who may read its remarks and items (#1529, spec #1528).

Each test acts as a throwaway user of the role profile it names (created in `setUpClass` with the
profile's real roles, removed in `tearDownClass`), saves the Work Order the way Desk and the SPA do
(`doc.save()` as that user), and checks the refusal or the stored status.

Run: DEVENV test --module nirmaan_stack.nirmaan_stack.doctype.service_requests.test_work_order_lifecycle

⚠️ RUNS AGAINST THE SITE DATABASE. Work Orders are planted with the GST Hold fixture (`TEST-GSTH-*`) and
purged after each test. The notifications hook is patched out (`patch_notifications`) except where a
test checks the notifications themselves (`test_work_order_notifications`).
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.sr_items import get_sr_items_for_parents
from nirmaan_stack.api.sr_remarks import (
    add_sr_remark,
    get_sr_recent_remarks,
    get_sr_remarks,
    get_sr_remarks_count,
)
from nirmaan_stack.api.vendor.test_gst_hold import _Fixture
from nirmaan_stack.patches.v3_0 import pmo_write_on_work_orders as pmo_patch

SR = "Service Requests"
NOTIFY_ON_UPDATE = "nirmaan_stack.integrations.controllers.service_requests.on_update"
DECIDE_REFUSAL = "Only Admin and Project Lead can approve or reject a Work Order, or accept or revert its amendment."

ADMIN = "Nirmaan Admin Profile"
PROJECT_LEAD = "Nirmaan Project Lead Profile"
PROJECT_MANAGER = "Nirmaan Project Manager Profile"
ACCOUNTANT = "Nirmaan Accountant Profile"
DESIGN_EXECUTIVE = "Nirmaan Design Executive Profile"
PMO = "Nirmaan PMO Executive Profile"
PMO_ROLE = "Nirmaan PMO Executive"

#: profile -> throwaway user holding that profile's roles.
USERS = {
    ADMIN: "test-wo-life-admin@example.com",
    PROJECT_LEAD: "test-wo-life-pl@example.com",
    PROJECT_MANAGER: "test-wo-life-pm@example.com",
    ACCOUNTANT: "test-wo-life-accountant@example.com",
    DESIGN_EXECUTIVE: "test-wo-life-design@example.com",
    PMO: "test-wo-life-pmo-profile@example.com",
}
#: Holds the PMO Executive Role alone (the real profile also carries System Manager, which writes every
#: Work Order already), so the patch's own grant is what is tested.
PMO_ONLY_USER = "test-wo-life-pmo@example.com"


def _make_user(email, profile, *, roles=None):
    if not frappe.db.exists("User", email):
        user = frappe.new_doc("User")
        user.update({"email": email, "first_name": email.split("@")[0], "send_welcome_email": 0})
        if roles is None:
            user.role_profile_name = profile   # the profile's real roles
        user.flags.no_welcome_mail = True
        user.insert(ignore_permissions=True)   # its after_insert creates the Nirmaan Users row
        if roles:
            user.add_roles(*roles)
    frappe.db.set_value("Nirmaan Users", email, "role_profile", profile, update_modified=False)


def _drop_user(email):
    frappe.db.rollback()
    for doctype, filters in (
        ("User Permission", {"user": email}),
        ("Nirmaan User Permissions", {"user": email}),
        ("Nirmaan Users", {"name": email}),
    ):
        try:
            frappe.db.delete(doctype, filters)
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            print(f"!! could not remove test {doctype} for {email}")
    try:
        if frappe.db.exists("User", email):
            frappe.delete_doc("User", email, force=True, ignore_permissions=True)
        frappe.db.commit()
    except Exception:
        frappe.db.rollback()
        print(f"!! could not remove test User {email}")
        raise


class _AsRoleCase(FrappeTestCase):
    #: Patch the notifications hook out, so a test of something else writes no Nirmaan Notifications.
    patch_notifications = True

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        for profile, email in USERS.items():
            _make_user(email, profile)
        _make_user(PMO_ONLY_USER, PMO, roles=[PMO_ROLE])
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        for email in (*USERS.values(), PMO_ONLY_USER):
            _drop_user(email)
        super().tearDownClass()

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.fx = _Fixture()
        self.addCleanup(self._purge)
        self.project = self.fx.project()
        self.vendor = self.fx.vendor()
        if self.patch_notifications:
            notify = patch(NOTIFY_ON_UPDATE)
            notify.start()
            self.addCleanup(notify.stop)

    def _purge(self):
        frappe.db.rollback()
        frappe.set_user("Administrator")
        if self.fx.srs:
            for doctype, filters in (
                ("Nirmaan Comments", {"reference_name": ("in", self.fx.srs)}),
                ("Nirmaan Versions", {"docname": ("in", self.fx.srs)}),
                ("Deleted Document", {"deleted_doctype": SR, "deleted_name": ("in", self.fx.srs)}),
            ):
                try:
                    frappe.db.delete(doctype, filters)
                    frappe.db.commit()
                except Exception:
                    frappe.db.rollback()
                    print(f"!! could not remove test {doctype} rows")
        self.fx.purge()

    def _wo(self, status="Vendor Selected", project=None):
        return self.fx.work_order(project or self.project, self.vendor, 100_000, status=status)

    def _as(self, user, fn, *args, **kwargs):
        frappe.set_user(user)
        try:
            return fn(*args, **kwargs)
        finally:
            frappe.set_user("Administrator")

    def _save(self, user, name, **changes):
        """Save the Work Order as `user` the way Desk and the SPA do: load it, change it, save it."""
        def save():
            doc = frappe.get_doc(SR, name)
            doc.update(changes)
            doc.save()
        self._as(user, save)

    def _status(self, name):
        return frappe.db.get_value(SR, name, "status")


class TestWhoDecidesAWorkOrder(_AsRoleCase):
    def test_others_cannot_approve_or_reject_one(self):
        for profile in (PROJECT_MANAGER, ACCOUNTANT, DESIGN_EXECUTIVE):
            for decision in ("Approved", "Rejected"):
                with self.subTest(profile=profile, decision=decision):
                    wo = self._wo()
                    with self.assertRaises(frappe.ValidationError) as refused:
                        self._save(USERS[profile], wo, status=decision)
                    self.assertIn(DECIDE_REFUSAL, str(refused.exception))
                    self.assertEqual(self._status(wo), "Vendor Selected")

    def test_others_cannot_accept_or_revert_an_amendment(self):
        for profile in (PROJECT_MANAGER, ACCOUNTANT, DESIGN_EXECUTIVE):
            with self.subTest(profile=profile):
                wo = self._wo("Amendment")
                with self.assertRaises(frappe.ValidationError) as refused:
                    self._save(USERS[profile], wo, status="Approved")
                self.assertIn(DECIDE_REFUSAL, str(refused.exception))
                self.assertEqual(self._status(wo), "Amendment")

    def test_admin_and_project_lead_approve_reject_and_accept_an_amendment(self):
        for profile in (ADMIN, PROJECT_LEAD):
            with self.subTest(profile=profile):
                approved, rejected, amended = self._wo(), self._wo(), self._wo("Amendment")
                self._save(USERS[profile], approved, status="Approved")
                self._save(USERS[profile], rejected, status="Rejected")
                self._save(USERS[profile], amended, status="Approved")
                self.assertEqual(
                    [self._status(n) for n in (approved, rejected, amended)], ["Approved", "Rejected", "Approved"]
                )

    def test_anyone_who_writes_a_work_order_may_still_amend_it(self):
        """Amend (Approved -> Amendment) is not a decision; the approver decides it afterwards."""
        wo = self._wo("Approved")
        self._save(USERS[PROJECT_MANAGER], wo, status="Amendment")
        self.assertEqual(self._status(wo), "Amendment")


class _PmoPatchCase(_AsRoleCase):
    """Plants the Work Order permissions as they were before the patch (the doctype's own rows, PMO read
    only) and restores the site's real Custom DocPerm rows afterwards."""

    def setUp(self):
        super().setUp()
        self._saved_perms = frappe.get_all("Custom DocPerm", filters={"parent": SR}, fields="*")
        self.addCleanup(self._restore_perms)
        frappe.db.delete("Custom DocPerm", {"parent": SR})
        frappe.clear_cache(doctype=SR)

    def _restore_perms(self):
        frappe.db.rollback()
        frappe.db.delete("Custom DocPerm", {"parent": SR})
        for row in self._saved_perms:
            frappe.get_doc({**row, "doctype": "Custom DocPerm"}).db_insert()
        frappe.db.commit()
        frappe.clear_cache(doctype=SR)

    def _rights(self):
        return {
            (p.role, p.permlevel, p.read, p.write, p.create, p.delete)
            for p in frappe.get_all("Custom DocPerm", filters={"parent": SR}, fields="*")
        }


class TestPmoWritePatch(_PmoPatchCase):
    def test_it_gives_pmo_write_and_delete_on_work_orders(self):
        self.assertFalse(frappe.has_permission(SR, "write", user=PMO_ONLY_USER))
        pmo_patch.execute()
        for right in ("read", "write", "delete"):
            self.assertTrue(frappe.has_permission(SR, right, user=PMO_ONLY_USER), right)

    def test_it_leaves_every_other_role_as_it_was(self):
        before = {
            (p.role, p.permlevel, p.read, p.write, p.create, p.delete)
            for p in frappe.get_all("DocPerm", filters={"parent": SR}, fields="*")
            if p.role != PMO_ROLE
        }
        pmo_patch.execute()
        self.assertEqual({r for r in self._rights() if r[0] != PMO_ROLE}, before)

    def test_a_second_run_changes_nothing(self):
        pmo_patch.execute()
        first = self._rights()
        self.assertEqual(pmo_patch.missing_rights(), [])
        pmo_patch.execute()
        self.assertEqual(self._rights(), first)


class TestPmoUsesAWorkOrder(_PmoPatchCase):
    def setUp(self):
        super().setUp()
        pmo_patch.execute()

    def test_edit_terms_and_amend_work(self):
        """The GST flag is no longer typed by anyone (#1538: it follows the vendor), so PMO's write is
        Edit terms and Amend."""
        wo = self._wo("Approved")
        self._save(PMO_ONLY_USER, wo, notes={"list": ["Revised terms"]}, project_gst="29ABFCS9095N1Z9")
        self._save(PMO_ONLY_USER, wo, status="Amendment")
        row = frappe.db.get_value(SR, wo, ["project_gst", "status"], as_dict=True)
        self.assertEqual((row.project_gst, row.status), ("29ABFCS9095N1Z9", "Amendment"))

    def test_delete_works(self):
        wo = self._wo("Approved")
        self._as(PMO_ONLY_USER, frappe.delete_doc, SR, wo)
        self.assertFalse(frappe.db.exists(SR, wo))

    def test_invoices_and_payment_requests_are_open_to_pmo(self):
        """Invoices ride on the PMO Role itself; a payment request on the System Manager Role the PMO
        profile carries (the PMO Role alone only reads Project Payments)."""
        self.assertTrue(frappe.has_permission("Vendor Invoices", "create", user=PMO_ONLY_USER))
        self.assertTrue(frappe.has_permission("Project Payments", "create", user=USERS[PMO]))

    def test_approval_is_still_refused(self):
        """Neither the patched Role nor the System Manager Role the PMO profile carries makes PMO an approver."""
        for user in (PMO_ONLY_USER, USERS[PMO]):
            for wo, decision in ((self._wo(), "Approved"), (self._wo(), "Rejected"), (self._wo("Amendment"), "Approved")):
                with self.subTest(user=user, decision=decision):
                    before = self._status(wo)
                    with self.assertRaises(frappe.ValidationError) as refused:
                        self._save(user, wo, status=decision)
                    self.assertIn(DECIDE_REFUSAL, str(refused.exception))
                    self.assertEqual(self._status(wo), before)


class TestRemarksAndItemsNeedReadAccess(_AsRoleCase):
    """A Project Manager on another project may not read this project's Work Order details."""

    def setUp(self):
        super().setUp()
        self.other_project = self.fx.project()
        self.wo = self._wo("Approved")
        self.other_wo = self._wo("Approved", project=self.other_project)
        self.pm = USERS[PROJECT_MANAGER]
        perm = frappe.get_doc({
            "doctype": "User Permission", "user": self.pm, "allow": "Projects", "for_value": self.other_project,
        }).insert(ignore_permissions=True)
        frappe.db.commit()
        self.addCleanup(self._remove_permission, perm.name)

    @staticmethod
    def _remove_permission(name):
        frappe.db.rollback()
        try:
            frappe.db.delete("User Permission", {"name": name})
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            print(f"!! could not remove test User Permission {name}")
            raise

    def test_remark_calls_refuse_a_work_order_the_user_cannot_read(self):
        for call, args in (
            (get_sr_remarks, (self.wo,)),
            (get_sr_remarks_count, (self.wo,)),
            (get_sr_recent_remarks, (self.wo,)),
            (add_sr_remark, (self.wo, "peek")),
        ):
            with self.subTest(call=call.__name__):
                with self.assertRaises(frappe.PermissionError):
                    self._as(self.pm, call, *args)
        self.assertFalse(frappe.db.exists("Nirmaan Comments", {"reference_name": self.wo}))

    def test_remark_calls_work_on_a_work_order_the_user_can_read(self):
        self._as(self.pm, add_sr_remark, self.other_wo, "on my project")
        res = self._as(self.pm, get_sr_remarks, self.other_wo)
        self.assertEqual([r["content"] for r in res["remarks"]], ["on my project"])
        self.assertEqual(self._as(self.pm, get_sr_remarks_count, self.other_wo), {"count": 1})

    def test_items_of_a_work_order_the_user_cannot_read_are_not_returned(self):
        named = self._as(self.pm, get_sr_items_for_parents, [self.wo, self.other_wo])
        self.assertEqual(list(named), [self.other_wo])
        self.assertEqual([i["item_name"] for i in named[self.other_wo]], ["Test work"])

    def test_items_with_no_names_return_only_readable_work_orders(self):
        everything = self._as(self.pm, get_sr_items_for_parents)
        self.assertNotIn(self.wo, everything)
        self.assertIn(self.other_wo, everything)
        # The user is on one project only, so every Work Order returned is on it.
        projects = set(frappe.get_all(SR, filters={"name": ("in", list(everything))}, pluck="project"))
        self.assertEqual(projects, {self.other_project})
