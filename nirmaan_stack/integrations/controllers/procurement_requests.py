import frappe
import json
from ..Notifications.pr_notifications import PrNotification, get_allowed_users
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
        lead_admin_users = get_allowed_users(doc)
        if lead_admin_users:
            for user in lead_admin_users:
                if user["push_notification"] == "true":
                    # Dynamically generate notification title/body for each lead
                    notification_title = f"New PR Created for Project {doc.project}"
                    notification_body = (
                        f"Hi {user['full_name']}, a new procurement request for the {doc.work_package} "
                        f"work package has been submitted and is awaiting your review."
                        )
                    click_action_url = f"{frappe.utils.get_url()}/frontend/approve-order"
                    # Send notification for each lead
                    PrNotification(user, notification_title, notification_body, click_action_url)
                else:
                    print(f"push notifications were not enabled for user: {user['full_name']}")
        else:
            print("No project leads or admins found with push notifications enabled.")

        message = {
            "title": _("New PR Created"),
            "description": _(f"A new PR: {doc.name} has been created."),
            "project": doc.project,
            "work_package": doc.work_package,
            "sender": doc.owner,
            "docname": doc.name
        }
        # Emit the event to the allowed users
        for user in lead_admin_users:
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

# def get_allowed_users(project):
#     """ Get the list of users who have access to the given project """
#     allowed_users = frappe.get_all("Nirmaan User Permissions", 
#                                    filters={"for_value": project}, 
#                                    fields=["user"])
#     allowed_users_ids = [user['user'] for user in allowed_users]

#     lead_admin_users = frappe.db.get_list(
#             'Nirmaan Users',
#             filters={
#                 'name': ['in', allowed_users_ids],
#                 'role_profile': ['in', ['Nirmaan Project Lead Profile', 'Nirmaan Admin Profile']],
#             },
#             fields=['name', 'role_profile']
#         )
#     return lead_admin_users

def update_quantity(data, target_name, new_quantity):
    for item in data['list']:
        if item['name'] == target_name:
            item['quantity'] += new_quantity

def on_update(doc, method):
    print(f"on_update method: {method}")
    if doc.workflow_state == "Vendor Selected":
        lead_admin_users = get_allowed_users(doc)
        if lead_admin_users:
            for user in lead_admin_users:
                if user["push_notification"] == "true":
                    notification_title = f"Vendors Selected for the PR: {doc.name}!"
                    notification_body = (
                            f"Hi {user['full_name']}, Vendors have been selected for the {doc.work_package} work package. "
                            "Please review the selection and proceed with approval or rejection."
                        )
                    click_action_url = f"{frappe.utils.get_url()}/frontend/approve-vendor"
                    print(f"click_action_url: {click_action_url}")
                    PrNotification(user, notification_title, notification_body, click_action_url)
                else:
                    print(f"push notifications were not enabled for user: {user['full_name']}")

                # send in-app notification for all allowed users
                message = {
                    "title": _("PR Status Updated"),
                    "description": _(f"Vendors have been selected for the PR: {doc.name}!"),
                    "project": doc.project,
                    "work_package": doc.work_package,
                    "sender": frappe.session.user,
                    "docname": doc.name
                }
                new_notification_doc = frappe.new_doc('Nirmaan Notifications')
                new_notification_doc.recipient = user['name']
                new_notification_doc.recipient_role = user['role_profile']
                if frappe.session.user != 'Administrator':
                    new_notification_doc.sender = frappe.session.user
                new_notification_doc.title = message["title"]
                new_notification_doc.description = message["description"]
                new_notification_doc.document = 'Procurement Requests'
                new_notification_doc.docname = doc.name
                new_notification_doc.project = doc.project
                new_notification_doc.work_package = doc.work_package
                new_notification_doc.seen = "false"
                new_notification_doc.type = "info"
                new_notification_doc.event_id = "pr:vendorSelected"
                new_notification_doc.action_url = f"approve-vendor/{doc.name}"
                new_notification_doc.insert()
                frappe.db.commit()

                message["notificationId"] = new_notification_doc.name
                print(f"running publish realtime for: {user}")

                frappe.publish_realtime(
                    event="pr:vendorSelected",  # Custom event name
                    message=message,
                    user=user['name']  # Notify only specific users
                )
        else:
            print("No project leads or admins found with push notifications enabled.")
    # elif doc.workflow_state == "Pending":
        # lead_admin_users = get_allowed_users(doc)
        # if lead_admin_users:
        #     for user in lead_admin_users:
        #         if user["push_notification"] == "true":
        #             # Dynamically generate notification title/body for each lead
        #             notification_title = f"PR: {doc.name} Status Updated"
        #             notification_body = (
        #                 f"Hi {user['full_name']}, Rejected PR: {doc.name} for the {doc.work_package} "
        #                 f"work package has been resolved by {get_user_name(frappe.session.user)} and is awaiting your review."
        #                 )
        #             click_action_url = f"{frappe.utils.get_url()}/frontend/approve-order"
        #             # Send notification for each lead
        #             PrNotification(user, notification_title, notification_body, click_action_url)
        #         else:
        #             print(f"push notifications were not enabled for user: {user['full_name']}")
        # else:
        #     print("No project leads or admins found with push notifications enabled.")

        # message = {
        #     "title": _("PR Status Updated"),
        #     "description": _(f"Rejected PR: {doc.name} has been resolved."),
        #     "project": doc.project,
        #     "work_package": doc.work_package,
        #     "sender": frappe.session.user,
        #     "docname": doc.name
        # }
        # # Emit the event to the allowed users
        # for user in lead_admin_users:
        #     new_notification_doc = frappe.new_doc('Nirmaan Notifications')
        #     new_notification_doc.recipient = user['name']
        #     new_notification_doc.recipient_role = user['role_profile']
        #     if frappe.session.user != 'Administrator':
        #         new_notification_doc.sender = frappe.session.user
        #     new_notification_doc.title = message["title"]
        #     new_notification_doc.description = message["description"]
        #     new_notification_doc.document = 'Procurement Requests'
        #     new_notification_doc.docname = doc.name
        #     new_notification_doc.project = doc.project
        #     new_notification_doc.work_package = doc.work_package
        #     new_notification_doc.seen = "false"
        #     new_notification_doc.type = "info"
        #     new_notification_doc.event_id = "pr:resolved"
        #     new_notification_doc.action_url = f"approve-order/{doc.name}"
        #     new_notification_doc.insert()
        #     frappe.db.commit()

        #     message["notificationId"] = new_notification_doc.name
        #     print(f"running publish realtime for: {user}")

        #     frappe.publish_realtime(
        #         event="pr:resolved",  # Custom event name
        #         message=message,
        #         user=user['name']  # Notify only specific users
        #     )
        

def get_user_name(id):
    nirmaan_users = frappe.db.get_list(
        'Nirmaan Users',
        fields=['name', 'full_name']
    )
    for item in nirmaan_users:
        if item['name'] == id:
            return item['full_name']
    
    return None
def on_trash(doc, method):
    frappe.db.delete("Nirmaan Comments", {
        "reference_name" : ("=", doc.name)
    })
    print(f"flagged for delete pr document: {doc} {doc.modified_by} {doc.owner}")
    notifications = frappe.db.get_all("Nirmaan Notifications", 
                                      filters={"docname": doc.name},
                                      fields={"name", "recipient"}
                                      )

    if notifications:
        for notification in notifications:
            print(f"running delete notification event for user: {notification['recipient']} with {notification['name']}")
            message = {
            "title": _("PR Deleted"),
            "description": _(f"PR: {doc.name} has been deleted."),
            "docname": doc.name,
            "sender": frappe.session.user,
            "notificationId" : notification["name"]
            }
            frappe.publish_realtime(
                event="pr:delete",
                message=message,
                user=notification["recipient"]
            )
    frappe.db.delete("Nirmaan Notifications", {
        "docname": ("=", doc.name)
    })

def after_delete(doc, method):
    pass