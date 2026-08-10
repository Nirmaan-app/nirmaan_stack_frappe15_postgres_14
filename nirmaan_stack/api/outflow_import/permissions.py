# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Single-point access gate for Bulk Import Outflow (slice S3).

THIS MODULE IS THE ENFORCEMENT BOUNDARY. The frontend mirrors the same set for UX -- hiding a
sidebar entry and a button -- but that is convenience only: a custom whitelisted endpoint that does
its own `save_file` and `insert(ignore_permissions=True)` never runs Frappe's own permission
machinery, so without this gate the endpoint would be reachable by any logged-in user.

ROLE PROFILE, NOT `frappe.get_roles()`. This app's admin detection reads
`Nirmaan Users.role_profile` (or the literal user id `Administrator`) -- the repo convention, and
the same source the frontend's `useUserData()` reads, so the two agree by construction rather than
by luck. The exact strings below were re-queried against the live database on 2026-08-06;
`Nirmaan Accountant Lead Profile` exists as a Role Profile with no users assigned yet, which is
correct to include and would be invisible to a users-table-only check.
"""

import frappe

__all__ = ["OUTFLOW_IMPORT_PROFILES", "require_outflow_access", "has_outflow_access"]

# Owner ruling: Accountant, Accountant Lead, Admin.
OUTFLOW_IMPORT_PROFILES = frozenset(
    {
        "Nirmaan Admin Profile",
        "Nirmaan Accountant Profile",
        "Nirmaan Accountant Lead Profile",
    }
)


def has_outflow_access(user: str | None = None) -> bool:
    """Whether this user may reach the Bulk Import Outflow module. No side effects.

    ⚠️ `None` means "not supplied, use the session"; an EMPTY STRING means "explicitly nobody" and
    is denied. `user or frappe.session.user` would conflate the two and silently escalate a blank
    caller to the session user -- which in a test runner is Administrator, and in a request is
    whoever happens to be logged in.
    """
    if user is None:
        user = frappe.session.user
    if not user or user == "Guest":
        return False
    if user == "Administrator":
        return True
    profile = frappe.db.get_value("Nirmaan Users", user, "role_profile")
    return profile in OUTFLOW_IMPORT_PROFILES


def require_outflow_access(user: str | None = None) -> str:
    """Gate every endpoint in this module. Returns the session user, or raises PermissionError."""
    if user is None:
        user = frappe.session.user
    if not has_outflow_access(user):
        frappe.throw(
            "You do not have access to Bulk Import Outflow. "
            "This module is limited to Accountants and Admins.",
            frappe.PermissionError,
            title="Not permitted",
        )
    return user
