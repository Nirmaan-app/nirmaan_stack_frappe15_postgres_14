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
    sync_has_project(doc.user)


def sync_has_project(user):
    """Set `Nirmaan Users.has_project` to "false" once the user has no mirror row left.

    Shared by `on_trash` above and `api/projects/assignees.remove_project_assignee`, which
    also clears mirror rows that have no `User Permission` behind them -- one owner for the
    rule, so the two paths cannot disagree.

    Skips a user with no `Nirmaan Users` row: the mirror table holds rows for users deleted
    since (`Nirmaan Users` deletion does not cascade to it), and `get_doc` would raise.
    """
    if frappe.db.exists("Nirmaan User Permissions", {"user": user}):
        return
    if not frappe.db.exists("Nirmaan Users", user):
        return
    nuser = frappe.get_doc("Nirmaan Users", user)
    nuser.has_project = "false"
    nuser.save(ignore_permissions=True)

    
    