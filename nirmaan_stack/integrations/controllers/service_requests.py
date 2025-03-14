import frappe
from ..Notifications.pr_notifications import PrNotification, get_allowed_users, get_allowed_procurement_users, get_allowed_accountants
from frappe import _
from .procurement_requests import get_user_name

def on_trash(doc, method):
    frappe.db.delete("Nirmaan Comments", {
        "reference_name" : ("=", doc.name)
    })
    print(f"flagged for delete sr document: {doc} {doc.modified_by} {doc.owner}")
    notifications = frappe.db.get_all("Nirmaan Notifications", 
                                      filters={"docname": doc.name},
                                      fields={"name", "recipient"}
                                      )

    if notifications:
        for notification in notifications:
            print(f"running delete notification event for user: {notification['recipient']} with {notification['name']}")
            message = {
            "title": _("SR Deleted"),
            "description": _(f"SR: {doc.name} has been deleted."),
            "docname": doc.name,
            "sender": frappe.session.user,
            "notificationId" : notification["name"]
            }
            frappe.publish_realtime(
                event="sr:delete",
                message=message,
                user=notification["recipient"]
            )
    frappe.db.delete("Nirmaan Notifications", {
        "docname": ("=", doc.name)
    })

def on_update(doc, method):

    previous_doc = doc.get_doc_before_save()

    if doc.status == "Vendor Selected":
        lead_admin_users = get_allowed_users(doc)
        if lead_admin_users:
            for user in lead_admin_users:
                if user["push_notification"] == "true":
                    # Dynamically generate notification title/body for each lead
                    notification_title = f"Vendors Selected for SR: {doc.name}"
                    notification_body = (
                            f"Hi {user['full_name']}, Vendors have been selected for the {doc.name} Service Request. "
                            "Please review the selection and proceed with approval or rejection."
                        )
                    click_action_url = f"{frappe.utils.get_url()}/frontend/service-requests?tab=approve-service-order"
                    # Send notification for each lead
                    PrNotification(user, notification_title, notification_body, click_action_url)
                else:
                    print(f"push notifications were not enabled for user: {user['full_name']}")
        else:
            print("No project leads or admins found with push notifications enabled.")

        message = {
            "title": _("SR Status Updated"),
            "description": _(f"Vendors have been selected for the SR: {doc.name}!"),
            "project": doc.project,
            "work_package": "Services",
            "sender": frappe.session.user,
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
            new_notification_doc.document = 'Service Requests'
            new_notification_doc.docname = doc.name
            new_notification_doc.project = doc.project
            new_notification_doc.work_package = "Services"
            new_notification_doc.seen = "false"
            new_notification_doc.type = "info"
            new_notification_doc.event_id = "sr:vendorSelected"
            new_notification_doc.action_url = f"service-requests/{doc.name}?tab=approve-service-order"
            new_notification_doc.insert()
            frappe.db.commit()

            message["notificationId"] = new_notification_doc.name
            print(f"running publish realtime for: {user}")

            frappe.publish_realtime(
                event="sr:vendorSelected",  # Custom event name
                message=message,
                user=user['name']  # Notify only specific users
            )
    
    if doc.status == "Amendment":
        lead_admin_users = get_allowed_users(doc)
        if lead_admin_users:
            for user in lead_admin_users:
                if user["push_notification"] == "true":
                    # Dynamically generate notification title/body for each lead
                    notification_title = f"SO: {doc.name} has been Amended"
                    notification_body = (
                        f"Hi {user['full_name']}, SO: {doc.name} for the {doc.project} "
                        f"project has been amended by {get_user_name(frappe.session.user)} and is awaiting your review."
                        )
                    click_action_url = f"{frappe.utils.get_url()}/frontend/service-requests?tab=approve-amended-so"
                    # Send notification for each lead
                    PrNotification(user, notification_title, notification_body, click_action_url)
                else:
                    print(f"push notifications were not enabled for user: {user['full_name']}")
        else:
            print("No project leads or admins found with push notifications enabled.")

        message = {
            "title": _("SR Status Updated!"),
            "description": _(f"SO: {doc.name} has been amended!"),
            "project": doc.project,
            "work_package": "Services",
            "sender": frappe.session.user,
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
            new_notification_doc.document = 'Service Requests'
            new_notification_doc.docname = doc.name
            new_notification_doc.project = doc.project
            new_notification_doc.work_package = "Services"
            new_notification_doc.seen = "false"
            new_notification_doc.type = "info"
            new_notification_doc.event_id = "sr:amended"
            new_notification_doc.action_url = f"service-requests/{doc.name}?tab=approve-amended-so"
            new_notification_doc.insert()
            frappe.db.commit()

            message["notificationId"] = new_notification_doc.name
            print(f"running publish realtime for: {user}")

            frappe.publish_realtime(
                event="sr:amended",  # Custom event name
                message=message,
                user=user['name']  # Notify only specific users
            )


    if previous_doc and previous_doc.status == "Vendor Selected" and doc.status == "Approved":
        proc_admin_users = get_allowed_procurement_users(doc)
        accountant_users = get_allowed_accountants(doc)
        proc_admin_accountant_users = proc_admin_users + accountant_users
        if proc_admin_accountant_users:
            for user in proc_admin_accountant_users:
                if user["push_notification"] == "true":

                    notification_title = f"Vendors Approved for SR: {doc.name}"
                    notification_body = (
                            f"Hi {user['full_name']}, Vendors have been approved for the {doc.name} Service Request. "
                            "click here to take action."
                        )
                    if user['role_profile'] != "Nirmaan Accountant Profile":
                        click_action_url = f"{frappe.utils.get_url()}/frontend/service-requests?tab=approved-sr"
                    else:
                        click_action_url = f"{frappe.utils.get_url()}/frontend/project-payments?tab=PO%20Wise"

                    PrNotification(user, notification_title, notification_body, click_action_url)
                else:
                    print(f"push notifications were not enabled for user: {user['full_name']}")
        else:
            print("No Proc Execs, Accountants or Admins found with push notifications enabled.")

        message = {
            "title": _("SR Approved"),
            "description": _(f"Vendors have been approved for the SR: {doc.name}!"),
            "project": doc.project,
            "work_package": "Services",
            "sender": frappe.session.user,
            "docname": doc.name
        }
        # Emit the event to the allowed users
        for user in proc_admin_accountant_users:
            new_notification_doc = frappe.new_doc('Nirmaan Notifications')
            new_notification_doc.recipient = user['name']
            new_notification_doc.recipient_role = user['role_profile']
            if frappe.session.user != 'Administrator':
                new_notification_doc.sender = frappe.session.user
            new_notification_doc.title = message["title"]
            new_notification_doc.description = message["description"]
            new_notification_doc.document = 'Service Requests'
            new_notification_doc.docname = doc.name
            new_notification_doc.project = doc.project
            new_notification_doc.work_package = "Services"
            new_notification_doc.seen = "false"
            new_notification_doc.type = "info"
            new_notification_doc.event_id = "sr:approved"
            if user['role_profile'] != "Nirmaan Accountant Profile":
                new_notification_doc.action_url = f"service-requests/{doc.name}?tab=approved-sr"
            else:
                new_notification_doc.action_url = f"project-payments/{doc.name}"
            new_notification_doc.insert()
            frappe.db.commit()

            message["notificationId"] = new_notification_doc.name
            print(f"running publish realtime for: {user}")

            frappe.publish_realtime(
                event="sr:approved",  # Custom event name
                message=message,
                user=user['name']  # Notify only specific users
            )