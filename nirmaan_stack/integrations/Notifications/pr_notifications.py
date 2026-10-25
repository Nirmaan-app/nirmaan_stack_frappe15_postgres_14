import logging

from firebase_admin import messaging
import frappe
import time

from nirmaan_stack.services.role_profiles import MATERIAL_PROCUREMENT_PROFILES

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


def get_admin_users():
    """Retrieves all Nirmaan Admin users."""
    return frappe.db.get_list(
        'Nirmaan Users',
        filters={'role_profile': 'Nirmaan Admin Profile'},
        fields=['fcm_token', 'name', 'full_name', 'role_profile', 'push_notification']
    )


def get_allowed_lead_users(doc):
        """Retrieves all Allowed Lead users for a given project."""
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

        return lead_users

def get_allowed_procurement_users(doc):
        """Retrieves all Allowed Procurement users for a given project."""
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
                'role_profile': ['in', list(MATERIAL_PROCUREMENT_PROFILES)],
            },
            fields=['fcm_token', 'name', 'full_name', 'role_profile', 'push_notification']
        )

        return proc_users

NOTIFIED_USER_FIELDS = ['fcm_token', 'name', 'full_name', 'role_profile', 'push_notification']


def get_users_who_see_project(project, profiles):
    """The Nirmaan Users of `profiles` who can see `project`: put on it, or on no project at all.

    Frappe's User Permission rule: a user with no Projects permission sees every project. That is how
    company-wide desks are set up (Service Procurement Executives are never put on a project, and most
    Accountants are not), so a project-permission filter alone would never reach them."""
    users = frappe.get_all('Nirmaan Users', fields=NOTIFIED_USER_FIELDS,
                           filters={'role_profile': ('in', list(profiles))})
    scoped = {}
    for perm in frappe.get_all('User Permission', fields=['user', 'for_value'], filters={
            'allow': 'Projects', 'user': ('in', [u.name for u in users] or [''])}):
        scoped.setdefault(perm.user, set()).add(perm.for_value)
    return [u for u in users if u.name not in scoped or project in scoped[u.name]]


def get_allowed_manager_users(doc):
        """Retrieves all Allowed Manager users for a given project."""
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

        return manager_users

def get_allowed_accountants(doc):
    """Retrieves all Allowed Accountant users for a given project."""
    allowed_users = frappe.db.get_list(
            'Nirmaan User Permissions',
            filters={'for_value': doc.project},
            fields=['user']
        )
    accountant_user_ids = [pm['user'] for pm in allowed_users]

    accountant_users = frappe.db.get_list(
        'Nirmaan Users',
        filters={
            'name': ['in', accountant_user_ids],
            'role_profile': ['in', ['Nirmaan Accountant Profile', 'Nirmaan Accountant Lead Profile']],
        },
        fields=['fcm_token', 'name', 'full_name', 'role_profile', 'push_notification']
    )
    
    # admin_users = frappe.db.get_list(
    #     'Nirmaan Users',
    #     filters={
    #         'role_profile': 'Nirmaan Admin Profile',
    #     },
    #     fields=['fcm_token', 'name', 'full_name', 'role_profile', 'push_notification']
    # )
    # accountant_admin_users = accountant_users + admin_users
    
    return accountant_users


def send_firebase_notification(fcm_token, title, body, click_action_url):
    """Sends a push notification using Firebase Admin SDK.

    THE one place the app sends a push (every PrNotification caller ends here). With the site config
    `disable_push` set -- dev only, never on production (CU-A AC5) -- it logs what it would have sent
    (recipient count and title; never the token or the body) and sends nothing."""
    if frappe.conf.get("disable_push"):
        logger = frappe.logger("nirmaan_push", allow_site=True)
        # Frappe file loggers default to ERROR off the dev server (utils/logger.py): INFO needs this
        logger.setLevel(logging.INFO)
        logger.info(
            f"push disabled (disable_push): not sent to 1 recipient, title {title!r}"
        )
        return
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