import frappe


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
