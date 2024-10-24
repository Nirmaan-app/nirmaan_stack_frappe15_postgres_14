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

def PrNotification(lead, notification_title, notification_body, click_action_url):
    """Send push notifications to a project lead with retry logic."""
    if lead['fcm_token']:
        print(f"Running Firebase notification for {lead['name']}")
        retry_count = 0
        success = False
        while not success and retry_count < MAX_RETRY_ATTEMPTS:
            try:
                send_firebase_notification(lead['fcm_token'], notification_title, notification_body, click_action_url)
                success = True
                print(f"Notification sent successfully to {lead['name']}")
            except Exception as e:
                retry_count += 1
                frappe.logger().error(f"Failed to send notification to {lead['name']}: {e}. Attempt {retry_count}")
                time.sleep(2)  # Wait before retrying
                if retry_count >= MAX_RETRY_ATTEMPTS:
                    print(f"Notification failed after {MAX_RETRY_ATTEMPTS} attempts for {lead['name']}.")


def get_allowed_users(doc):
        allowed_users = frappe.db.get_list(
            'Nirmaan User Permissions',
            filters={'for_value': doc.project},
            fields=['user']
        )
        lead_user_ids = [pl['user'] for pl in allowed_users]

        lead_users = frappe.db.get_list(
            'Nirmaan Users',
            filters={
                'name': ['in', lead_user_ids],
                'role_profile': 'Nirmaan Project Lead Profile',
            },
            fields=['fcm_token', 'name', 'full_name', 'role_profile', 'push_notification']
        )
        admin_users = frappe.db.get_list(
            'Nirmaan Users',
            filters={
                'role_profile': 'Nirmaan Admin Profile',
            },
            fields=['fcm_token', 'name', 'full_name', 'role_profile', 'push_notification']
        )

        lead_admin_users = lead_users + admin_users
        return lead_admin_users

def get_allowed_procurement_users(doc):
        allowed_users = frappe.db.get_list(
            'Nirmaan User Permissions',
            filters={'for_value': doc.project},
            fields=['user']
        )
        proc_user_ids = [pe['user'] for pe in allowed_users]

        proc_users = frappe.db.get_list(
            'Nirmaan Users',
            filters={
                'name': ['in', proc_user_ids],
                'role_profile': 'Nirmaan Procurement Executive Profile',
            },
            fields=['fcm_token', 'name', 'full_name', 'role_profile', 'push_notification']
        )
        admin_users = frappe.db.get_list(
            'Nirmaan Users',
            filters={
                'role_profile': 'Nirmaan Admin Profile',
            },
            fields=['fcm_token', 'name', 'full_name', 'role_profile', 'push_notification']
        )

        proc_admin_users = proc_users + admin_users
        return proc_admin_users

def get_allowed_manager_users(doc):
        allowed_users = frappe.db.get_list(
            'Nirmaan User Permissions',
            filters={'for_value': doc.project},
            fields=['user']
        )
        manager_user_ids = [pm['user'] for pm in allowed_users]

        manager_users = frappe.db.get_list(
            'Nirmaan Users',
            filters={
                'name': ['in', manager_user_ids],
                'role_profile': 'Nirmaan Project Manager Profile',
            },
            fields=['fcm_token', 'name', 'full_name', 'role_profile', 'push_notification']
        )
        admin_users = frappe.db.get_list(
            'Nirmaan Users',
            filters={
                'role_profile': 'Nirmaan Admin Profile',
            },
            fields=['fcm_token', 'name', 'full_name', 'role_profile', 'push_notification']
        )

        manager_admin_users = manager_users + admin_users
        return manager_admin_users


def send_firebase_notification(fcm_token, title, body, click_action_url):
    """Sends a push notification using Firebase Admin SDK."""
    message = messaging.Message(
        notification=messaging.Notification(
            title=title,
            body=body
        ),
        webpush=messaging.WebpushConfig(
            notification=messaging.WebpushNotification(
                title=title,
                body=body,
                icon="https://nirmaan-stack-public-bucket.s3.ap-south-1.amazonaws.com/android-chrome-192x192.png",
                # actions=[
                #     messaging.WebpushNotificationAction(
                #         action="open_url",
                #         title="View Details",
                #         icon="https://tal7aouy.gallerycdn.vsassets.io/extensions/tal7aouy/icons/3.8.0/1703110281439/Microsoft.VisualStudio.Services.Icons.Default"
                #     )
                # ],
            ),
            data={"click_action_url" : click_action_url}
        ),
        token=fcm_token
    )
    try:
        print(f"Sending FCM Notification to {fcm_token} with payload: {message}")
        response = messaging.send(message)
        print(f"Successfully sent message: {response}")
        frappe.logger().info(f"Successfully sent message: {response}")
    except Exception as e:
        print(f"failed to send notification from pr_notifications.py")
        frappe.logger().error(f"Failed to send notification: {e}")