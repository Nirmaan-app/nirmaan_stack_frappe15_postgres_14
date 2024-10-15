from ..Notifications.pr_notifications import PrNotification, leads

def on_update(doc, method):
    if doc.workflow_state == "Vendor Selected":
        lead_users = leads(doc)
        if lead_users:
            for lead in lead_users:
                notification_title = f"Vendors Selected for Project {doc.project}"
                notification_body = (
                        f"Hi {lead['full_name']}, Vendors have been selected for the {doc.type} items of PR: {doc.procurement_request}. "
                        "Please review the selection and proceed with approval or rejection."
                    )
                PrNotification(lead, notification_title, notification_body)
        else:
            print("No project leads found with push notifications enabled.")