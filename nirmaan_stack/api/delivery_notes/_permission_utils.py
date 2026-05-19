import frappe
from datetime import date


ALWAYS_EDIT_ROLES = [
    "Nirmaan Admin Profile",
    "Nirmaan PMO Executive Profile",
    "Nirmaan Project Lead Profile",
    "Nirmaan Procurement Executive Profile",
]


def check_dn_edit_permission(dn):
    """
    Shared permission check for Delivery Note edit endpoints (PO + ITM).

    Rules:
        - Admin, PMO, Procurement Exec, Project Lead: always allowed
        - Project Manager: only if they created the DN AND it was created today
        - All others: denied
    """
    current_user = frappe.session.user

    if current_user == "Administrator":
        return

    role_profile = frappe.db.get_value(
        "Nirmaan Users", current_user, "role_profile"
    )

    if role_profile in ALWAYS_EDIT_ROLES:
        return

    if role_profile == "Nirmaan Project Manager Profile":
        is_creator = dn.updated_by_user == current_user
        is_created_today = dn.creation.date() == date.today()

        if is_creator and is_created_today:
            return

        frappe.throw(
            "Project Managers can only edit delivery notes they created on the same day",
            frappe.PermissionError,
        )

    frappe.throw(
        "Insufficient permissions to edit this delivery note",
        frappe.PermissionError,
    )
