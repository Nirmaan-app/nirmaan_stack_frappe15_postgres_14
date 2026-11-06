"""The Frappe User: only User admins create one or give it a role profile, in Desk or through the API too.

All people here are made up (`*@example.com`).
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.integrations.controllers.test_nirmaan_users import make_user, remove_user
from nirmaan_stack.services.role_profiles import ADMIN_PROFILE, PMO_EXECUTIVE_PROFILE

# Project Lead bundles System Manager, so Frappe's own permissions let it edit any User.
PROJECT_LEAD_PROFILE = "Nirmaan Project Lead Profile"
LEAD = "uv-lead@example.com"
PMO = "uv-pmo@example.com"
TARGET = "uv-target@example.com"
NEW = "uv-new@example.com"
REFUSED = "Only Admin, PMO and HR"


class TestUserAdminGate(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        make_user(LEAD, PROJECT_LEAD_PROFILE)
        make_user(PMO, PMO_EXECUTIVE_PROFILE)
        make_user(TARGET, "Nirmaan Project Manager Profile")
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        for email in (LEAD, PMO, TARGET, NEW):
            remove_user(email)
        super().tearDownClass()

    def tearDown(self):
        frappe.set_user("Administrator")
        frappe.db.rollback()

    def _give_admin(self, actor, target):
        frappe.set_user(actor)
        user = frappe.get_doc("User", target)
        user.role_profile_name = ADMIN_PROFILE
        user.save()

    def test_the_lead_could_edit_users_without_the_gate(self):
        self.assertIn("System Manager", frappe.get_roles(LEAD))

    def test_non_user_admin_may_not_give_a_role_profile(self):
        for target in (LEAD, TARGET):
            with self.subTest(target), self.assertRaisesRegex(frappe.PermissionError, REFUSED):
                self._give_admin(LEAD, target)

    def test_non_user_admin_may_not_create_a_user(self):
        frappe.set_user(LEAD)
        user = frappe.new_doc("User")
        user.update({"email": NEW, "first_name": "New", "send_welcome_email": 0})
        with self.assertRaisesRegex(frappe.PermissionError, REFUSED):
            user.insert()

    def test_user_admin_may_give_any_role_profile(self):
        self._give_admin(PMO, TARGET)
        self.assertEqual(frappe.db.get_value("Nirmaan Users", TARGET, "role_profile"), ADMIN_PROFILE)

    def test_other_user_fields_stay_editable(self):
        frappe.set_user(LEAD)
        user = frappe.get_doc("User", TARGET)
        user.last_name = "Edited"
        user.save()
        self.assertEqual(frappe.db.get_value("User", TARGET, "last_name"), "Edited")
