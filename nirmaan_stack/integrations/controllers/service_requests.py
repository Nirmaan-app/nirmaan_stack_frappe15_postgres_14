import frappe
from ..Notifications.pr_notifications import PrNotification, get_allowed_users, get_allowed_procurement_users
from frappe import _

def on_trash(doc, method):
    frappe.db.delete("Nirmaan Comments", {
        "reference_name" : ("=", doc.name)
    })

def on_update(doc, method):
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
                    click_action_url = f"{frappe.utils.get_url()}/frontend/approve-service-request"
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
            # "work_package": doc.work_package,
            "sender": frappe.session.user,
            "docname": doc.name
        }
        # Emit the event to the allowed users
        for user in lead_admin_users:
            new_notification_doc = frappe.new_doc('Nirmaan Notifications')
            new_notification_doc.recipient = user['name']
            new_notification_doc.recipient_role = user['role_profile']
            if doc.owner != 'Administrator':
                new_notification_doc.sender = frappe.session.user
            new_notification_doc.title = message["title"]
            new_notification_doc.description = message["description"]
            new_notification_doc.document = 'Service Requests'
            new_notification_doc.docname = doc.name
            new_notification_doc.project = doc.project
            # new_notification_doc.work_package = doc.work_package
            new_notification_doc.seen = "false"
            new_notification_doc.type = "info"
            new_notification_doc.event_id = "sr:vendorSelected"
            new_notification_doc.action_url = f"approve-service-request/{doc.name}"
            new_notification_doc.insert()
            frappe.db.commit()

            message["notificationId"] = new_notification_doc.name
            print(f"running publish realtime for: {user}")

            frappe.publish_realtime(
                event="sr:vendorSelected",  # Custom event name
                message=message,
                user=user['name']  # Notify only specific users
            )


    if doc.status == "Approved":
        proc_admin_users = get_allowed_procurement_users(doc)
        if proc_admin_users:
            for user in proc_admin_users:
                if user["push_notification"] == "true":
                    # Dynamically generate notification title/body for each lead
                    notification_title = f"Vendors Approved for SR: {doc.name}"
                    notification_body = (
                            f"Hi {user['full_name']}, Vendors have been approved for the {doc.name} Service Request. "
                            "click here to take action."
                        )
                    click_action_url = f"{frappe.utils.get_url()}/frontend/approved-sr"
                    # Send notification for each lead
                    PrNotification(user, notification_title, notification_body, click_action_url)
                else:
                    print(f"push notifications were not enabled for user: {user['full_name']}")
        else:
            print("No Proc Execs or admins found with push notifications enabled.")

        message = {
            "title": _("SR Approved"),
            "description": _(f"Vendors have been approved for the SR: {doc.name}!"),
            "project": doc.project,
            # "work_package": doc.work_package,
            "sender": frappe.session.user,
            "docname": doc.name
        }
        # Emit the event to the allowed users
        for user in proc_admin_users:
            new_notification_doc = frappe.new_doc('Nirmaan Notifications')
            new_notification_doc.recipient = user['name']
            new_notification_doc.recipient_role = user['role_profile']
            if doc.owner != 'Administrator':
                new_notification_doc.sender = frappe.session.user
            new_notification_doc.title = message["title"]
            new_notification_doc.description = message["description"]
            new_notification_doc.document = 'Service Requests'
            new_notification_doc.docname = doc.name
            new_notification_doc.project = doc.project
            # new_notification_doc.work_package = doc.work_package
            new_notification_doc.seen = "false"
            new_notification_doc.type = "info"
            new_notification_doc.event_id = "sr:approved"
            new_notification_doc.action_url = f"approved-sr/{doc.name}"
            new_notification_doc.insert()
            frappe.db.commit()

            message["notificationId"] = new_notification_doc.name
            print(f"running publish realtime for: {user}")

            frappe.publish_realtime(
                event="sr:approved",  # Custom event name
                message=message,
                user=user['name']  # Notify only specific users
            )