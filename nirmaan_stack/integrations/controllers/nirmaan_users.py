import frappe

def on_trash(doc, method):
    """
    Delete associated User Permissions and User Doctype
    """
    try:
        # frappe.db.begin()

        email = doc.name
        # print("Deleting user:", email)
        frappe.db.delete("User Permission", {"user": ("=",email)})
        frappe.db.delete("Nirmaan Notifications", {"recipient": ("=", email)})
        frappe.db.delete("Nirmaan Notifications", {"sender": ("=", email)})
        user = frappe.get_doc("User", email)
        user.delete()

        # frappe.db.commit()
        
    except Exception as e:
        # frappe.db.rollback()
        # print(f"Error deleting user: {str(e)}")
        frappe.log_error("Error deleting user", frappe.get_traceback())