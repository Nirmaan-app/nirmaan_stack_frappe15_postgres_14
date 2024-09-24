import frappe

def after_insert(doc, method):
    """
    Enable/checks has project == true if 
    new user permission is added
    """
    user = doc.user
    nuser = frappe.get_doc("Nirmaan Users", user)
    event = frappe.publish_realtime(
        "user: project added", 
        {
            "task_id": "qwerty5431we",
            "user": user, 
            "project": doc.for_value,
        },
        user='pe@pe2.pe'
    )
    print(event)
    if(nuser.has_project=="false"):
        nuser.has_project = "true"
        nuser.save(ignore_permissions=True)
    