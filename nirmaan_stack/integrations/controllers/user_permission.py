import frappe

def after_insert(doc, method):
    """
    Enable/checks has project == true if 
    new user permission is added
    """
    user = doc.user
    nuser = frappe.get_doc("Nirmaan Users", user)
    # event = frappe.publish_realtime(
    #     "user: project added", 
    #     {
    #         "task_id": "qwerty5431we",
    #         "user": user, 
    #         "project": doc.for_value,
    #     },
    # )
    # print(event)
    if(nuser.has_project=="false"):
        nuser.has_project = "true"
        nuser.save(ignore_permissions=True)

def add_nirmaan_user_permissions(doc, medthod):
    """
    Added mirrored nirmaan user permissions for frontend use
    """
    nup = frappe.new_doc("Nirmaan User Permissions")
    nup.user = doc.user
    nup.allow = doc.allow
    nup.for_value = doc.for_value
    nup.insert(ignore_permissions=True)

def on_trash(doc, method):
    """
    Remove mirrored nirmaan user permissions and other checks
    """
    nup = frappe.db.delete("Nirmaan User Permissions", {
                                 'user': doc.user,
                                 'allow': doc.allow,
                                 'for_value': doc.for_value
                             })
    up = frappe.db.get_all("Nirmaan User Permissions", 
            filters={
                'user':doc.user
            })
    if(len(up)==0):
       nuser = frappe.get_doc("Nirmaan Users", doc.user)
       nuser.has_project = "false"
       nuser.save(ignore_permissions=True)

    
    