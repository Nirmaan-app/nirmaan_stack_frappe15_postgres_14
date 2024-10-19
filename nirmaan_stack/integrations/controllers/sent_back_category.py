from ..Notifications.pr_notifications import PrNotification, get_allowed_users
import frappe
from frappe import _

def on_update(doc, method):
    if doc.workflow_state == "Vendor Selected":
        admin_lead_users = get_allowed_users(doc)
        pr = frappe.get_doc("Procurement Requests", doc.procurement_request)
        if admin_lead_users:
            for user in admin_lead_users:
                if user["push_notification"] == "true":
                    notification_title = f"Vendors Selected for Project {doc.project}"
                    notification_body = (
                            f"Hi {user['full_name']}, Vendors have been selected for the {doc.type} items of PR: {doc.procurement_request}. "
                            "Please review the selection and proceed with approval or rejection."
                        )
                    PrNotification(user, notification_title, notification_body)
                else:
                    print(f"push notifications were not enabled for user: {user['full_name']}")
                message = {
                    "title": _("Sent Back Status Updated"),
                    "description": _(f"Vendors have been selected for the SB: {doc.name}!"),
                    "project": doc.project,
                    "procurement_request": doc.procurement_request,
                    "sender": frappe.session.user,
                    "work_package": pr.work_package,
                    "docname": doc.name
                }

                new_notification_doc = frappe.new_doc('Nirmaan Notifications')
                new_notification_doc.recipient = user['name']
                new_notification_doc.recipient_role = user['role_profile']
                if frappe.session.user != 'Administrator':
                    new_notification_doc.sender = frappe.session.user
                new_notification_doc.title = message["title"]
                new_notification_doc.description = message["description"]
                new_notification_doc.document = 'Sent Back Category'
                new_notification_doc.docname = doc.name
                new_notification_doc.project = doc.project
                new_notification_doc.work_package = pr.work_package
                new_notification_doc.seen = "false"
                new_notification_doc.type = "info"
                new_notification_doc.event_id = "sb:vendorSelected"
                new_notification_doc.action_url = f"approve-sent-back/{doc.name}"
                new_notification_doc.insert()
                frappe.db.commit()

                message["notificationId"] = new_notification_doc.name
                print(f"running publish realtime for: {user}")

                frappe.publish_realtime(
                    event="sb:vendorSelected",  # Custom event name
                    message=message,
                    user=user['name']  # Notify only specific users
                )
        else:
            print("No project leads or admins found with push notifications enabled.")