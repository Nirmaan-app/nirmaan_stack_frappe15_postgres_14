import frappe
import json
from ..Notifications.pr_notifications import PrNotification, get_admin_users, get_allowed_lead_users, get_allowed_procurement_users, get_allowed_manager_users
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
    project_data = frappe.get_doc("Projects", doc.project)
    if len(last_prs)>1 and doc.work_package is not None:
        last_pr = last_prs[1]
        new_item_ids = [item['name'] for item in doc.procurement_list['list']]
        new_procurement_list = doc.procurement_list
        for item in last_pr.procurement_list['list']:
            if item['name'] in new_item_ids:
                update_quantity(new_procurement_list, item['name'], item['quantity'])
            else:
                new_procurement_list['list'].append(item)
        
        # doc.procurement_list = new_procurement_list
        
        # new_category_list = doc.category_list
        # existing_names = {item['name'] for item in new_category_list['list']}
        # for item in last_pr.category_list['list']:
        #     if item['name'] not in existing_names:
        #         new_category_list['list'].append(item)
        combined_request = last_pr.procurement_list['list'] + new_procurement_list['list']
        new_categories = []

        for item in combined_request:
            is_duplicate = any(
                category["name"] == item["category"] and category["status"] == item["status"]
                for category in new_categories
            )
            if not is_duplicate:
                makes = get_makes_for_category(project_data, item["category"])
                new_categories.append({"name": item["category"], "status": item["status"], "makes": makes})
            
        # doc.category_list = new_category_list
        # doc.save(ignore_permissions=True)
        frappe.db.set_value("Procurement Requests", doc.name, {
            "procurement_list": json.dumps(new_procurement_list),
            "category_list": json.dumps({"list" : new_categories})
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
    elif doc.work_package is not None:
        lead_admin_users = get_allowed_lead_users(doc) + get_admin_users(doc)
        custom = True if doc.work_package is None else False
        if lead_admin_users:
            for user in lead_admin_users:
                if user["push_notification"] == "true":
                    # Dynamically generate notification title/body for each lead
                    notification_title = f"New {'Custom PR' if custom else 'PR'} Created for Project {doc.project}"
                    notification_body = (
                        f"Hi {user['full_name']}, a new {'custom procurement' if custom else 'procurement'} procurement request for the {doc.project if custom else doc.work_package}"
                        f"{' project' if custom else ' work package'} has been submitted and is awaiting your review."
                        )
                    click_action_url = f"{frappe.utils.get_url()}/frontend/procurement-requests?tab=Approve%20PR"
                    # Send notification for each lead
                    PrNotification(user, notification_title, notification_body, click_action_url)
                else:
                    print(f"push notifications were not enabled for user: {user['full_name']}")
        else:
            print("No project leads or admins found with push notifications enabled.")

        message = {
            "title": _(f"New {'Custom PR' if custom else 'PR'} Created"),
            "description": _(f"A new {'Custom PR' if custom else 'PR'}: {doc.name} has been created."),
            "project": doc.project,
            "work_package": doc.work_package if not custom else "Custom",
            "sender": doc.owner,
            "docname": doc.name
        }
        # Emit the event to the allowed users
        for user in lead_admin_users:
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
            new_notification_doc.work_package = doc.work_package if not custom else "Custom"
            new_notification_doc.seen = "false"
            new_notification_doc.type = "info"
            new_notification_doc.event_id = "pr:new"
            new_notification_doc.action_url = f"procurement-requests/{doc.name}?tab=Approve%20PR"
            new_notification_doc.insert()
            frappe.db.commit()

            message["notificationId"] = new_notification_doc.name
            print(f"running publish realtime for: {user}")

            frappe.publish_realtime(
                event="pr:new",  # Custom event name
                message=message,
                user=user['name']  # Notify only specific users
            )

def update_quantity(data, target_name, new_quantity):
    for item in data['list']:
        if item['name'] == target_name:
            item['quantity'] += new_quantity

def on_update(doc, method):
    custom = True if doc.work_package is None else False
    old_doc = doc.get_doc_before_save()
    if old_doc and old_doc.workflow_state in ('In Progress', 'Pending') and doc.workflow_state == "Vendor Selected":
        lead_admin_users = get_allowed_lead_users(doc) + get_admin_users(doc)
        if lead_admin_users:
            for user in lead_admin_users:
                if user["push_notification"] == "true":
                    notification_title = None
                    if custom:
                        notification_title = f"New Custom PR: {doc.name} created and Vendors Selected!"
                    else:
                        notification_title = f"Vendors Selected for the PR: {doc.name}!"
                    notification_body = None
                    if custom:
                        notification_body = (
                            f"Hi {user['full_name']}, A new Custom PR: {doc.name} created and Vendors have been selected. "
                            "Please review it and proceed with approval or rejection."
                        )
                    else:
                        notification_body = (
                                f"Hi {user['full_name']}, Vendors have been selected for the {doc.work_package} work package. "
                                "Please review the selection and proceed with approval or rejection."
                            )
                    click_action_url = f"{frappe.utils.get_url()}/frontend/purchase-orders?tab=Approve%20PO"
                    print(f"click_action_url: {click_action_url}")
                    PrNotification(user, notification_title, notification_body, click_action_url)
                else:
                    print(f"push notifications were not enabled for user: {user['full_name']}")

                # send in-app notification for all allowed users
                title = None
                if custom:
                    title = f"New Custom PR created and Vendors Selected!"
                else:
                    title = f"PR Status Updated!"
                
                description = None
                if custom:
                    description = f"A new Custom PR: {doc.name} created and Vendors have been selected."
                else:
                    description = f"Vendors have been selected for the PR: {doc.name}!"
                message = {
                    "title": _(title),
                    "description": _(description),
                    "project": doc.project,
                    "work_package": doc.work_package if not custom else "Custom",
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
                new_notification_doc.work_package = doc.work_package if not custom else "Custom"
                new_notification_doc.seen = "false"
                new_notification_doc.type = "info"
                new_notification_doc.event_id = "pr:vendorSelected"
                new_notification_doc.action_url = f"purchase-orders/{doc.name}?tab=Approve%20PO"
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


    elif old_doc and old_doc.workflow_state == "Pending" and doc.workflow_state == "Approved":
        proc_admin_users = get_allowed_procurement_users(doc) + get_admin_users(doc)
        if proc_admin_users:
            for user in proc_admin_users:
                if user["push_notification"] == "true":
                    # Dynamically generate notification title/body for each lead
                    notification_title = f"New PR Request for Project {doc.project}"
                    notification_body = (
                        f"Hi {user['full_name']}, a new procurement request for the {doc.work_package} "
                        f"work package has been approved by {get_user_name(frappe.session.user)}, click here to take action."
                        )
                    click_action_url = f"{frappe.utils.get_url()}/frontend/procurement-requests?tab=New%20PR%20Request"
                    # Send notification for each lead
                    PrNotification(user, notification_title, notification_body, click_action_url)
                else:
                    print(f"push notifications were not enabled for user: {user['full_name']}")
        else:
            print("No Proc Execs or admins found with push notifications enabled.")

        message = {
            "title": _("New PR Request"),
            "description": _(f"New PR: {doc.name} has been approved."),
            "project": doc.project,
            "work_package": doc.work_package,
            "sender": frappe.session.user,
            "docname": doc.name
        }
        # Emit the event to the allowed users
        for user in proc_admin_users:
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
            new_notification_doc.event_id = "pr:approved"
            new_notification_doc.action_url = f"procurement-requests/{doc.name}?tab=New%20PR%20Request"
            new_notification_doc.insert()
            frappe.db.commit()

            message["notificationId"] = new_notification_doc.name
            print(f"running publish realtime for: {user}")

            frappe.publish_realtime(
                event="pr:approved",  # Custom event name
                message=message,
                user=user['name']  # Notify only specific users
            )


    elif old_doc and old_doc.workflow_state in ('Pending', 'Vendor Selected') and doc.workflow_state == "Rejected":
        manager_admin_users = get_allowed_manager_users(doc) + get_admin_users(doc)
        if manager_admin_users:
            for user in manager_admin_users:
                if user["push_notification"] == "true":
                    # Dynamically generate notification title/body for each lead
                    notification_body = None
                    if custom:
                        notification_body = (
                            f"Hi {user['full_name']}, the Custom PR: {doc.name} has been rejected by {get_user_name(frappe.session.user)}, click here to resolve."
                        )
                    else:
                        notification_body = (
                            f"Hi {user['full_name']}, the procurement request: {doc.name} for the {doc.work_package} "
                            f"work package has been rejected by {get_user_name(frappe.session.user)}, click here to resolve."
                        )
                    notification_title = f"{'Custom PR' if custom else 'PR'}: {doc.name} Rejected!"
                    click_action_url = f"{frappe.utils.get_url()}/frontend/prs&milestones/procurement-requests/{doc.name}"
                    # Send notification for each lead
                    PrNotification(user, notification_title, notification_body, click_action_url)
                else:
                    print(f"push notifications were not enabled for user: {user['full_name']}")
        else:
            print("No Managers or admins found with push notifications enabled.")

        message = {
            "title": _(f"{'Custom PR' if custom else 'PR'} Status Updated"),
            "description": _(f"{'Custom PR' if custom else 'PR'}: {doc.name} has been rejected."),
            "project": doc.project,
            "work_package": doc.work_package if not custom else "Custom",
            "sender": frappe.session.user,
            "docname": doc.name
        }
        # Emit the event to the allowed users
        for user in manager_admin_users:
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
            new_notification_doc.work_package = doc.work_package if not custom else "Custom"
            new_notification_doc.seen = "false"
            new_notification_doc.type = "info"
            new_notification_doc.event_id = "pr:rejected"
            new_notification_doc.action_url = f"prs&milestones/procurement-requests/{doc.name}"
            new_notification_doc.insert()
            frappe.db.commit()

            message["notificationId"] = new_notification_doc.name
            print(f"running publish realtime for: {user}")

            frappe.publish_realtime(
                event="pr:rejected",  # Custom event name
                message=message,
                user=user['name']  # Notify only specific users
            )

def get_makes_for_category(project, category):
    # Parse project_work_packages if it's a string
    project_work_packages = project.get('project_work_packages', "[]")
    if isinstance(project_work_packages, str):
        try:
            project_work_packages = json.loads(project_work_packages)
        except json.JSONDecodeError:
            raise ValueError("Invalid JSON in project_work_packages")

    # Flatten all category lists across work packages
    all_categories = [
        cat for wp in project_work_packages.get('work_packages', [])
        for cat in wp.get('category_list', {}).get('list', [])
    ]

    # Filter categories matching the given category name
    matching_categories = [cat for cat in all_categories if cat.get('name') == category]

    # Extract and flatten makes for the matched categories
    makes = [make for cat in matching_categories for make in cat.get('makes', [])]

    return makes
        

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
    frappe.db.delete("Category BOQ Attachments", {
        "procurement_request" : ("=", doc.name)
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