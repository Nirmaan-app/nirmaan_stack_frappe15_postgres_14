import frappe

def after_insert(doc, method):
    """
    Enable/checks has project == true if 
    new user permission is added
    """
    user = doc.user
    nuser = frappe.get_doc("Nirmaan Users", user)
    if(nuser.has_project=="false"):
        nuser.has_project = "true"
        nuser.save(ignore_permissions=True)