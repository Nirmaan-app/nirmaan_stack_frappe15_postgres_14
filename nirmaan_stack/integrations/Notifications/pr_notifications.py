from firebase_admin import messaging
import frappe
import time

# def PrNotification(lead_users, notification_title, notification_body):
#         # Send push notifications to each project lead
#         for lead in lead_users:
#             if lead['fcm_token']:
#                 print(f"running send firebase notification")
#                 send_firebase_notification(lead['fcm_token'], notification_title, notification_body)

MAX_RETRY_ATTEMPTS = 3  # Number of retries for failed notifications

def PrNotification(lead, notification_title, notification_body):
    """Send push notifications to a project lead with retry logic."""
    if lead['fcm_token']:
        print(f"Running Firebase notification for {lead['name']}")
        retry_count = 0
        success = False
        while not success and retry_count < MAX_RETRY_ATTEMPTS:
            try:
                send_firebase_notification(lead['fcm_token'], notification_title, notification_body)
                success = True
                print(f"Notification sent successfully to {lead['name']}")
            except Exception as e:
                retry_count += 1
                frappe.logger().error(f"Failed to send notification to {lead['name']}: {e}. Attempt {retry_count}")
                time.sleep(2)  # Wait before retrying
                if retry_count >= MAX_RETRY_ATTEMPTS:
                    print(f"Notification failed after {MAX_RETRY_ATTEMPTS} attempts for {lead['name']}.")


def leads(doc):
        project_leads = frappe.db.get_list(
            'Nirmaan User Permissions',
            filters={'for_value': doc.project},
            fields=['user']
        )
        print(f"projectleads : {project_leads}")
        lead_user_ids = [pl['user'] for pl in project_leads]
        print(f"lead user ids : {lead_user_ids}")
        lead_users = frappe.db.get_list(
            'Nirmaan Users',
            filters={
                'name': ['in', lead_user_ids],
                'role_profile': 'Nirmaan Project Lead Profile',
                'push_notification': 'true'
            },
            fields=['fcm_token', 'name', 'full_name']
        )
        return lead_users

def send_firebase_notification(fcm_token, title, body):
    """Sends a push notification using Firebase Admin SDK."""
    message = messaging.Message(
        notification=messaging.Notification(
            title=title,
            body=body
        ),
        token=fcm_token
    )
    try:
        print(f"Sending FCM Notification to {fcm_token} with payload: {message}")
        response = messaging.send(message)
        print(f"Successfully sent message: {response}")
        frappe.logger().info(f"Successfully sent message: {response}")
    except Exception as e:
        frappe.logger().error(f"Failed to send notification: {e}")