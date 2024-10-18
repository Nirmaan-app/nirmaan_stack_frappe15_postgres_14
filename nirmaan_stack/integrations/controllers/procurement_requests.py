import frappe
import json
from ..Notifications.pr_notifications import PrNotification, leads
from frappe import _

def after_insert(doc, method):
    # if(frappe.db.exists({"doctype": "Procurement Requests", "project": doc.project, "work_package": doc.work_package, "owner": doc.owner, "workflow_state": "Pending"})):
    last_prs = frappe.db.get_list("Procurement Requests", 
                                     filters={
                                         "project": doc.project,
                                         "work_package": doc.work_package,
                                         "owner": doc.owner,
                                         "workflow_state": "Pending"
                                         },
                                         fields=['name', 'project', 'work_package', 'owner', 'workflow_state', 'procurement_list', 'category_list'],
                                         order_by='creation desc'
                                         )
    if(len(last_prs)>1):
        last_pr = last_prs[1]
        new_item_ids = [item['name'] for item in doc.procurement_list['list']]
        new_procurement_list = doc.procurement_list
        for item in last_pr.procurement_list['list']:
            if item['name'] in new_item_ids:
                update_quantity(new_procurement_list, item['name'], item['quantity'])
            else:
                new_procurement_list['list'].append(item)
        
        # doc.procurement_list = new_procurement_list
        
        new_category_list = doc.category_list
        existing_names = {item['name'] for item in new_category_list['list']}
        for item in last_pr.category_list['list']:
            if item['name'] not in existing_names:
                new_category_list['list'].append(item)
            
        # doc.category_list = new_category_list
        # doc.save(ignore_permissions=True)
        frappe.db.set_value("Procurement Requests", doc.name, {
            "procurement_list": json.dumps(new_procurement_list),
            "category_list": json.dumps(new_category_list)
        })
        
        comments = frappe.db.get_all("Nirmaan Comments", {
            "reference_name": last_pr.name
        })

        if len(comments)>0:
            for comment in comments:
                frappe.db.set_value("Nirmaan Comments", comment.name, {
                    "reference_name": doc.name
                })

        frappe.delete_doc("Procurement Requests", last_pr.name)
    else: 
        lead_admin_users = leads(doc)
        if lead_admin_users:
            for user in lead_admin_users:
                # Dynamically generate notification title/body for each lead
                notification_title = f"Procurement Request Created for Project {doc.project}"
                notification_body = (
                    f"Hi {user['full_name']}, a new procurement request for the {doc.work_package} "
                    f"work package has been submitted and is awaiting your review."
                    )
                # Send notification for each lead
                PrNotification(user, notification_title, notification_body)
        else:
            print("No project leads found with push notifications enabled.")

        message = {
            "title": _("New PR Created"),
            "description": _(f"A new PR {doc.name} has been created."),
            "project": doc.project,
            "work_package": doc.work_package,
            "created_by": doc.owner,
            "docname": doc.name
        }

        # Find the users who should receive this notification based on their project permissions
        allowed_users = get_allowed_users(doc.project)

        # Emit the event to the allowed users
        for user in allowed_users:
            new_notification_doc = frappe.new_doc('Nirmaan Notifications')
            new_notification_doc.recipient = user['name']
            new_notification_doc.recipient_role = user['role_profile']
            if doc.owner != 'Administrator':
                new_notification_doc.sender = doc.owner
            new_notification_doc.title = message["title"]
            new_notification_doc.description = message["description"]
            new_notification_doc.document = 'Procurement Requests'
            new_notification_doc.docname = doc.name
            new_notification_doc.project = doc.project
            new_notification_doc.work_package = doc.work_package
            new_notification_doc.seen = "false"
            new_notification_doc.type = "info"
            new_notification_doc.event_id = "pr:new"
            new_notification_doc.action_url = f"approve-order/{doc.name}"
            new_notification_doc.insert()
            frappe.db.commit()

            message["notificationId"] = new_notification_doc.name
            print(f"running publish realtime for: {user}")

            frappe.publish_realtime(
                event="pr:new",  # Custom event name
                message=message,
                user=user['name']  # Notify only specific users
            )


# def after_insert(doc, method):
    # users = []
    # pls = frappe.db.get_list('User Permission',
    #                          filters={
    #                              'for_value': doc.project
    #                          },
    #                          fields=['user'])
    # users += [pl['user'] for pl in pls]
    # admins = frappe.db.get_list('Nirmaan Users',
    #                             filters={
    #                                 'role_profile': 'Nirmaan Admin Profile'
    #                             },
    #                             fields=['email'])
    # users += [admin['email'] for admin in admins]
    # for user in users:
    #     frappe.publish_realtime(
    #         "pr:created",
    #         message=doc,
    #         doctype=doc.doctype,
    #         user=user
    #         )
    # pass

def get_allowed_users(project):
    """ Get the list of users who have access to the given project """
    allowed_users = frappe.get_all("Nirmaan User Permissions", 
                                   filters={"for_value": project}, 
                                   fields=["user"])
    allowed_users_ids = [user['user'] for user in allowed_users]

    lead_admin_users = frappe.db.get_list(
            'Nirmaan Users',
            filters={
                'name': ['in', allowed_users_ids],
                'role_profile': ['in', ['Nirmaan Project Lead Profile', 'Nirmaan Admin Profile']],
            },
            fields=['name', 'role_profile']
        )
    return lead_admin_users



def update_quantity(data, target_name, new_quantity):
    for item in data['list']:
        if item['name'] == target_name:
            item['quantity'] += new_quantity

def on_update(doc, method):
    if doc.workflow_state == "Vendor Selected":
        lead_users = leads(doc)
        if lead_users:
            for lead in lead_users:
                notification_title = f"Vendors Selected for Project {doc.project}"
                notification_body = (
                        f"Hi {lead['full_name']}, Vendors have been selected been selected for the {doc.work_package} work package. "
                        "Please review the selection and proceed with approval or rejection."
                    )
                PrNotification(lead, notification_title, notification_body)
        else:
            print("No project leads found with push notifications enabled.")
    pass
        

def on_trash(doc, method):
    frappe.db.delete("Nirmaan Comments", {
        "reference_name" : ("=", doc.name)
    })
    frappe.db.delete("Nirmaan Notifications", {
        "docname": ("=", doc.name)
    })