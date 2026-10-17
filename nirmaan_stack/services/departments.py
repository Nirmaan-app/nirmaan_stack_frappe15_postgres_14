"""Departments (`Nirmaan Department`) -- who may change them, and which may be given to someone.

The list is managed in the app by Admin and HR (owner, 2026-10-12). A person (`Nirmaan Users`) and an
asset (`Asset Master`) each link to one department. A switched-off department stays on the records
that already have it, but can't be given to anyone new.
"""

import frappe

from nirmaan_stack.services.role_profiles import DEPARTMENT_EDIT_PROFILES, get_role_profile

DEPARTMENT_DOCTYPE = "Nirmaan Department"


def is_department_editor(user: str | None = None) -> bool:
    """Admin, HR Executive, HR Lead, or the Administrator user (checked by role PROFILE)."""
    user = user or frappe.session.user
    return user == "Administrator" or get_role_profile(user) in DEPARTMENT_EDIT_PROFILES


def require_department_editor(message: str = "Only Admin and HR can change departments.") -> None:
    """Refuse the current user unless they may manage departments."""
    if not is_department_editor():
        frappe.throw(message, frappe.PermissionError)


def assert_active_department(department: str | None) -> None:
    """Refuse giving someone (or an asset) a department that is switched off."""
    if department and not frappe.db.get_value(DEPARTMENT_DOCTYPE, department, "is_active"):
        frappe.throw(f"The department {department} is switched off. Choose an active department.")
