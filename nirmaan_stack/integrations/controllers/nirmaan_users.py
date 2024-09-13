import frappe

def on_trash(doc, method):
    """
    Delete associated User Permissions and User Doctype
    """
    email = doc.email
    frappe.db.delete("User Permission", {"user": ("=",email)})
    user = frappe.get_doc("User", email)
    user.delete()