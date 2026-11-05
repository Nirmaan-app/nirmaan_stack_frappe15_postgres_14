import frappe

from nirmaan_stack.services.asset_history import DEPARTMENT_SET, add_history
from nirmaan_stack.services.exited_employees import switch_off_login
from nirmaan_stack.services.nirmaan_users import forget_nirmaan_users
from nirmaan_stack.services.payees.own_accounts import check_own_account, delete_own_account


def validate(doc, method):
    """The person's own bank account (Reimbursements) changes only through
    `services/payees/own_accounts.add_own_account`, and is never another person's."""
    check_own_account(doc)
    check_role_profile_copy(doc)


def check_role_profile_copy(doc):
    """`role_profile` is a copy of the Frappe User's `role_profile_name`, and changes only through the
    User's sync (`on_user_update` / `create_user_profile`), for everyone, Admin included (owner, 2026-11-05).

    Many roles may write their own Nirmaan Users record, and about 100 gates read this copy
    (`services/role_profiles`), so a copy that differs from the User is refused. A User admin gives a
    role profile on the User (the Users screen does). The site install writes Administrator's copy.
    """
    if frappe.flags.in_install or not doc.has_value_changed("role_profile"):
        return
    on_user = frappe.db.get_value("User", doc.name, "role_profile_name")
    if (doc.role_profile or None) != (on_user or None):
        frappe.throw(
            "A role profile is changed on the user's login (Users page), not here.", frappe.PermissionError
        )


def after_insert(doc, method):
    """A new Nirmaan user: the login gate's cached set must take them in."""
    forget_nirmaan_users()


def after_delete(doc, method):
    """The person's own bank account goes with them (owner, 2026-10-28), unless a Vendor is also paid into it.
    Here, not in `on_trash`: the person's row must be gone first, or Frappe refuses to delete the Payee it links.
    The login gate's cached set of Nirmaan users drops them at once."""
    forget_nirmaan_users()
    delete_own_account(doc.get("payee"))


def on_update(doc, method):
    """A person's department set for the first time: the assets they hold that have no department
    take it, each with a "Department Set" row in its history.

    A later change (someone moving from one department to another) moves nothing: the assets keep
    their department, and the next assignment asks for a reason. `set_value` skips Asset Master's
    validate on purpose -- filling an EMPTY department is always allowed there, and nothing is derived
    from the field.
    """
    if not doc.department or not doc.has_value_changed("department"):
        return
    before = doc.get_doc_before_save()
    if before and before.department:
        return

    for asset in frappe.get_all(
        "Asset Master",
        filters=[["current_assignee", "=", doc.name], ["department", "is", "not set"]],
        pluck="name",
    ):
        frappe.db.set_value("Asset Master", asset, "department", doc.department)
        add_history(asset, DEPARTMENT_SET, assigned_to=doc.name, to_department=doc.department)


def on_trash(doc, method):
    """
    The person has left: delete their User Permissions and Notifications, and switch their login off
    (`services/exited_employees.switch_off_login`). The Frappe User is kept, because many records link
    to it; deleting it failed on those links, and the failure was swallowed.
    """
    email = doc.name

    # Delete User Permissions (safe even if none exist)
    try:
        frappe.db.delete("User Permission", {"user": ("=", email)})
    except Exception as e:
        frappe.log_error(
            f"Failed to delete User Permissions for {email}: {str(e)}",
            "Nirmaan Users Delete"
        )

    # Delete Nirmaan Notifications (safe even if none exist)
    try:
        frappe.db.delete("Nirmaan Notifications", {"recipient": ("=", email)})
        frappe.db.delete("Nirmaan Notifications", {"sender": ("=", email)})
    except Exception as e:
        frappe.log_error(
            f"Failed to delete Notifications for {email}: {str(e)}",
            "Nirmaan Users Delete"
        )

    if frappe.db.exists("User", email):
        switch_off_login(email)


def after_rename(doc, method, old_name, new_name, merge):
    """
    Update email field after document rename, and drop the login gate's cached set of Nirmaan users.
    Called when Nirmaan Users document is renamed (email change).
    """
    forget_nirmaan_users()
    try:
        # Update the email field to match the new name (primary key)
        frappe.db.set_value("Nirmaan Users", new_name, "email", new_name, update_modified=False)
    except Exception as e:
        frappe.log_error(
            f"Failed to update email after rename from {old_name} to {new_name}: {str(e)}",
            "Nirmaan Users Rename"
        )
