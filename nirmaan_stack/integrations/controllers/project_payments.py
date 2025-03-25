from ..Notifications.pr_notifications import PrNotification, get_allowed_lead_users, get_admin_users, get_allowed_accountants, get_allowed_manager_users, get_allowed_procurement_users
import frappe
from frappe import _
from .procurement_requests import get_user_name

def after_insert(doc, method):
        admin_users = get_admin_users()

        project = frappe.get_doc("Projects", doc.project)
        
        if admin_users:
            for user in admin_users:
                if user["push_notification"] == "true":
                    # Dynamically generate notification title/body for each lead
                    notification_title = f"New Payment Request for Project {project.project_name}"
                    notification_body = (
                        f"Hi {user['full_name']}, a new payment request for the {doc.document_name} "
                        f"PO has been requested by {get_user_name(frappe.session.user)}, click here to take action."
                        )
                    
                    click_action_url = f"{frappe.utils.get_url()}/frontend/project-payments?tab=Approve%20Payments"
                    # Send notification for each lead
                    PrNotification(user, notification_title, notification_body, click_action_url)
                else:
                    print(f"push notifications were not enabled for user: {user['full_name']}")
        else:
            print("No Leads or admins found with push notifications enabled.")

        message = {
            "title": _(f"New Payment Request"),
            "description": _(f"New Payment: {doc.name} has been requested."),
            "project": doc.project,
            "sender": frappe.session.user,
            "docname": doc.name
        }
        # Emit the event to the allowed users
        for user in admin_users:
            new_notification_doc = frappe.new_doc('Nirmaan Notifications')
            new_notification_doc.recipient = user['name']
            new_notification_doc.recipient_role = user['role_profile']
            if frappe.session.user != 'Administrator':
                new_notification_doc.sender = frappe.session.user
            new_notification_doc.title = message["title"]
            new_notification_doc.description = message["description"]
            new_notification_doc.document = 'Project Payments'
            new_notification_doc.docname = doc.name
            new_notification_doc.project = doc.project
            new_notification_doc.seen = "false"
            new_notification_doc.type = "info"
            eventID = "payment:new"
            new_notification_doc.event_id = eventID
            new_notification_doc.action_url = f"project-payments?tab=Approve%20Payments"
            new_notification_doc.insert()
            frappe.db.commit()

            message["notificationId"] = new_notification_doc.name
            print(f"running publish realtime for: {user}")

            frappe.publish_realtime(
                event=eventID,  # Custom event name
                message=message,
                user=user['name']  # Notify only specific users
            )


def on_update(doc, method):
    old_doc = doc.get_doc_before_save()
    if old_doc and old_doc.status == 'Requested' and doc.status == "Approved":
        accountants = get_allowed_accountants(doc)
        project = frappe.get_doc("Projects", doc.project)
        if accountants:
            for user in accountants:
                if user["push_notification"] == "true":
                    notification_title = f"Payment Approved for Project {project.project_name}!"
                    notification_body = (
                            f"Hi {user['full_name']}, a new payment has been approved for the PO:{doc.document_name}. "
                            "Please review and fulfill the payment."
                        )
                    click_action_url = f"{frappe.utils.get_url()}/frontend/project-payments?tab=New%20Payments"
                    PrNotification(user, notification_title, notification_body, click_action_url)
                else:
                    print(f"push notifications were not enabled for user: {user['full_name']}")
                message = {
                    "title": _("New Payment Approved"),
                    "description": _(f"A new payment has been approved for the PO: {doc.document_name}!"),
                    "project": doc.project,
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
                new_notification_doc.document = 'Project Payments'
                new_notification_doc.docname = doc.name
                new_notification_doc.project = doc.project
                new_notification_doc.seen = "false"
                new_notification_doc.type = "info"
                new_notification_doc.event_id = "payment:approved"
                new_notification_doc.action_url = f"project-payments?tab=New%20Payments"
                new_notification_doc.insert()
                frappe.db.commit()

                message["notificationId"] = new_notification_doc.name
                print(f"running publish realtime for: {user}")

                frappe.publish_realtime(
                    event="payment:approved",  # Custom event name
                    message=message,
                    user=user['name']  # Notify only specific users
                )
        else:
            print("No accountants found with push notifications enabled.")
    
    elif old_doc and old_doc.status == 'Approved' and doc.status == 'Paid':
        allowed_users = get_allowed_lead_users(doc) + get_admin_users() + get_allowed_manager_users(doc) + get_allowed_procurement_users(doc)
        project = frappe.get_doc("Projects", doc.project)
        vendor = frappe.get_doc("Vendors", doc.vendor)
        if allowed_users:
            for user in allowed_users:
                if user["push_notification"] == "true":
                    notification_title = f"Payment Fulfilled for Vendor: {vendor.vendor_name}!"
                    notification_body = (
                            f"Hi {user['full_name']}, the payment: {doc.name} associated with PO: {doc.document_name} has been fulfilled."
                        )
                    click_action_url = f"{frappe.utils.get_url()}/frontend/project-payments?tab=Payments%20Done"
                    PrNotification(user, notification_title, notification_body, click_action_url)
                else:
                    print(f"push notifications were not enabled for user: {user['full_name']}")
                message = {
                    "title": _("Payment Status Changed"),
                    "description": _(f"The payment: {doc.name} has been fulfilled!"),
                    "project": doc.project,
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
                new_notification_doc.document = 'Project Payments'
                new_notification_doc.docname = doc.name
                new_notification_doc.project = doc.project
                new_notification_doc.seen = "false"
                new_notification_doc.type = "info"
                new_notification_doc.event_id = "payment:fulfilled"
                new_notification_doc.action_url = f"project-payments?tab=Payments%20Done"
                new_notification_doc.insert()
                frappe.db.commit()

                message["notificationId"] = new_notification_doc.name
                print(f"running publish realtime for: {user}")

                frappe.publish_realtime(
                    event="payment:fulfilled",  # Custom event name
                    message=message,
                    user=user['name']  # Notify only specific users
                )
        else:
            print("No accountants found with push notifications enabled.")


def on_trash(doc, method):
    frappe.db.delete("Nirmaan Comments", {
        "reference_name" : ("=", doc.name)
    })
    notifications = frappe.db.get_all("Nirmaan Notifications", 
                                      filters={"docname": doc.name},
                                      fields={"name", "recipient"}
                                      )
    # THIS NOTIFICATION IS NOT USED IN THE UI
    if notifications:
        for notification in notifications:
            print(f"running delete notification event for user: {notification['recipient']} with {notification['name']}")
            message = {
            "title": _("Payment Deleted"),
            "description": _(f"Project Payment: {doc.name} has been deleted."),
            "docname": doc.name,
            "sender": frappe.session.user,
            "notificationId" : notification["name"]
            }
            frappe.publish_realtime(
                event="payment:delete",
                message=message,
                user=notification["recipient"]
            )
    frappe.db.delete("Nirmaan Notifications", {
        "docname": ("=", doc.name)
    })