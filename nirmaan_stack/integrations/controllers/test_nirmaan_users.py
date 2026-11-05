"""Nirmaan Users lifecycle: the role copy is locked to the Frappe User's role profile.

All people here are made up (`*@example.com`).
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.role_profiles import ADMIN_PROFILE, is_nirmaan_admin

PM_PROFILE = "Nirmaan Project Manager Profile"
PM = "nu-lock-pm@example.com"
OTHER = "nu-lock-other@example.com"
ADMIN = "nu-lock-admin@example.com"


def give_role_profile(email: str, profile: str | None) -> None:
    """Give a test user a role profile the way the Users screen does: on the Frappe User.

    The User's sync copies it into `Nirmaan Users.role_profile`, the only way that copy changes.
    Frappe replaces the User's Roles with the profile's, so add any extra Roles after this.
    """
    user = frappe.get_doc("User", email)
    user.role_profile_name = profile
    user.save(ignore_permissions=True)


def set_role_copy_for_test(email: str, profile: str | None) -> None:
    """Test-only: write `Nirmaan Users.role_profile` below the lock, leaving the User's Roles exactly as the
    test set them.

    For a test that needs one set of Frappe Roles and a different role profile. `give_role_profile` would
    replace those Roles with the profile's, and so would every later save of that User. Production code never
    writes the copy: a direct change is refused (`controllers/nirmaan_users.check_role_profile_copy`).
    """
    frappe.db.set_value("Nirmaan Users", email, "role_profile", profile, update_modified=False)


def make_user(email: str, profile: str | None = None) -> None:
    """A made-up user with a Frappe User and a Nirmaan Users record, holding `profile`."""
    if not frappe.db.exists("User", email):
        user = frappe.new_doc("User")
        user.update({"email": email, "first_name": email.split("@")[0], "send_welcome_email": 0})
        user.flags.no_welcome_mail = True
        user.insert(ignore_permissions=True)
    if profile and frappe.db.get_value("User", email, "role_profile_name") != profile:
        give_role_profile(email, profile)


def left_the_old_way(email: str) -> None:
    """Remove a made-up person's Nirmaan Users record without its hooks, as exits did before their login was
    switched off: the login stays on. Drops the login gate's cached set, as the hooks would."""
    from nirmaan_stack.services.nirmaan_users import forget_nirmaan_users

    frappe.db.delete("Nirmaan Users", {"name": email})
    forget_nirmaan_users()


def remove_user(email: str) -> None:
    """Remove a made-up user, both records. Each in its own try so one failure strands nothing else."""
    frappe.db.rollback()
    frappe.set_user("Administrator")
    for doctype in ("Nirmaan Users", "User"):
        try:
            if frappe.db.exists(doctype, email):
                frappe.delete_doc(doctype, email, force=True, ignore_permissions=True)
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            print(f"test_nirmaan_users: could not remove {doctype} {email}: {frappe.get_traceback()}")


class TestRoleCopyLocked(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        make_user(PM, PM_PROFILE)
        make_user(OTHER, PM_PROFILE)
        make_user(ADMIN, ADMIN_PROFILE)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        for email in (PM, OTHER, ADMIN):
            remove_user(email)
        super().tearDownClass()

    def tearDown(self):
        frappe.set_user("Administrator")
        frappe.db.rollback()

    def _save_as(self, actor: str, target: str, **changes) -> None:
        frappe.set_user(actor)
        doc = frappe.get_doc("Nirmaan Users", target)
        doc.update(changes)
        doc.save()

    def test_project_manager_cannot_make_self_admin(self):
        with self.assertRaises(frappe.PermissionError):
            self._save_as(PM, PM, role_profile=ADMIN_PROFILE)
        frappe.set_user("Administrator")
        self.assertFalse(is_nirmaan_admin(PM))

    def test_project_manager_cannot_make_another_admin(self):
        with self.assertRaises(frappe.PermissionError):
            self._save_as(PM, OTHER, role_profile=ADMIN_PROFILE)
        frappe.set_user("Administrator")
        self.assertFalse(is_nirmaan_admin(OTHER))

    def test_admin_cannot_change_the_copy_directly_either(self):
        with self.assertRaises(frappe.PermissionError):
            self._save_as(ADMIN, OTHER, role_profile=ADMIN_PROFILE)
        frappe.set_user("Administrator")
        self.assertFalse(is_nirmaan_admin(OTHER))

    def test_other_fields_stay_editable(self):
        self._save_as(PM, PM, last_name="Changed")
        self.assertEqual(frappe.db.get_value("Nirmaan Users", PM, "last_name"), "Changed")

    def test_role_profile_change_on_user_is_copied(self):
        frappe.set_user(ADMIN)
        user = frappe.get_doc("User", OTHER)
        user.role_profile_name = ADMIN_PROFILE
        user.save(ignore_permissions=True)
        self.assertEqual(frappe.db.get_value("Nirmaan Users", OTHER, "role_profile"), ADMIN_PROFILE)
        self.assertTrue(is_nirmaan_admin(OTHER))
