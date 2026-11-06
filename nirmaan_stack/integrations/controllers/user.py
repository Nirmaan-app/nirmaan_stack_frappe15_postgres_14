import frappe

from nirmaan_stack.services.role_profiles import assert_user_admin


def validate(doc, method):
    """Only a User admin creates a user or gives or changes a role profile (owner, 2026-11-05), in Desk and
    through the REST API as on the Users screen. System Manager rides on several profiles, so Frappe's own
    User permissions cannot say this.

    A user made by a Guest request (Frappe's sign-up and social login) is not checked here: those doors
    are outside this gate.
    """
    if doc.is_new():
        if frappe.session.user != "Guest":
            assert_user_admin(frappe.session.user)
    elif doc.has_value_changed("role_profile_name"):
        assert_user_admin(frappe.session.user)
