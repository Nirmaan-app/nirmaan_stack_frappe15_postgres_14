import frappe

from nirmaan_stack.services.asset_history import DEPARTMENT_SET, add_history
from nirmaan_stack.services.payees.own_accounts import check_own_account, delete_own_account


def validate(doc, method):
    """The person's own bank account (Reimbursements) changes only through
    `services/payees/own_accounts.add_own_account`, and is never another person's."""
    check_own_account(doc)


def after_delete(doc, method):
    """The person's own bank account goes with them (owner, 2026-10-28), unless a Vendor is also paid into it.
    Here, not in `on_trash`: the person's row must be gone first, or Frappe refuses to delete the Payee it links."""
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
    Delete associated User Permissions, Notifications, and User Doctype
    when a Nirmaan Users record is deleted.

    Handles edge cases where associated records may not exist.
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

    # Delete Frappe User - with existence check
    try:
        if frappe.db.exists("User", email):
            user = frappe.get_doc("User", email)
            user.delete()
        else:
            # Log for debugging - User doesn't exist but Nirmaan Users did
            frappe.log_error(
                f"Frappe User {email} does not exist but Nirmaan Users did. "
                "This indicates a sync issue between User and Nirmaan Users doctypes.",
                "Nirmaan Users Sync Warning"
            )
    except Exception as e:
        frappe.log_error(
            f"Failed to delete Frappe User {email}: {str(e)}",
            "Nirmaan Users Delete"
        )


def after_rename(doc, method, old_name, new_name, merge):
    """
    Update email field after document rename.
    Called when Nirmaan Users document is renamed (email change).
    """
    try:
        # Update the email field to match the new name (primary key)
        frappe.db.set_value("Nirmaan Users", new_name, "email", new_name, update_modified=False)
    except Exception as e:
        frappe.log_error(
            f"Failed to update email after rename from {old_name} to {new_name}: {str(e)}",
            "Nirmaan Users Rename"
        )
