import frappe


def on_trash(doc, method):
    """
    Delete associated User Permissions and User Doctype
    """
    try:
        email = doc.name
        frappe.db.delete("User Permission", {"user": ("=", email)})
        frappe.db.delete("Nirmaan Notifications", {"recipient": ("=", email)})
        frappe.db.delete("Nirmaan Notifications", {"sender": ("=", email)})
        user = frappe.get_doc("User", email)
        user.delete()

    except Exception as e:
        frappe.log_error("Error deleting user", frappe.get_traceback())


def after_rename(doc, method, old_name, new_name, merge):
    """
    Update email field after document rename.
    Called when Nirmaan Users document is renamed (email change).
    """
    try:
        # Update the email field to match the new name (primary key)
        frappe.db.set_value("Nirmaan Users", new_name, "email", new_name, update_modified=False)
    except Exception as e:
        frappe.log_error("Error updating email after rename", frappe.get_traceback())