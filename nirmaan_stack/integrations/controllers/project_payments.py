# nirmaan_stack/integrations/controllers/project_payments.py

import frappe
from frappe import _
from frappe.utils import nowdate

# Imports for notification system
from ..Notifications.pr_notifications import PrNotification, get_allowed_lead_users, get_admin_users, get_allowed_accountants, get_allowed_manager_users, get_allowed_procurement_users
from .procurement_requests import get_user_name


# --- HELPER FUNCTION FOR HOOKS ---
# This helper function uses the "search" method to find the related PO term.
def _find_and_update_po_term(payment_doc, new_status, clear_link=False):
    """
    Finds the corresponding PO term by searching through the child table
    and updates its status.
    """
    if payment_doc.document_type != "Procurement Orders":
        return

    try:
        # Load the entire parent PO document to access its child table
        po_doc = frappe.get_doc("Procurement Orders", payment_doc.document_name)
        
        for term in po_doc.get("payment_terms"):
            # The search condition: find the term linking to this payment
            if term.project_payment == payment_doc.name:
                term.status = new_status
                if clear_link:
                    term.project_payment = "" # Clear the link on deletion
                
                # Save the entire PO document with the updated child table
                po_doc.save(ignore_permissions=True)
                return # Exit once found and saved

    except Exception as e:
        frappe.log_error(f"Failed during PO term search-and-update for payment {payment_doc.name}. Error: {e}", "Payment Sync Failed")


# --- HOOK IMPLEMENTATIONS ---

def after_insert(doc, method):
    """
    This hook is now ONLY responsible for sending notifications.
    The linking logic has been moved to the 'create_project_payment' API call.
    """
    admin_users = get_admin_users()
    project = frappe.get_doc("Projects", doc.project)
    
    if admin_users:
        for user in admin_users:
            if user.get("push_notification") == "true":
                notification_title = f"New Payment Request for Project {project.project_name}"
                notification_body = (
                    f"Hi {user.get('full_name')}, a new payment request for the {doc.document_name} "
                    f"PO has been requested by {get_user_name(frappe.session.user)}, click here to take action."
                )
                click_action_url = f"{frappe.utils.get_url()}/frontend/project-payments?tab=Approve%20Payments"
                PrNotification(user, notification_title, notification_body, click_action_url)
            else:
                print(f"push notifications were not enabled for user: {user.get('full_name')}")
    else:
        print("No Leads or admins found with push notifications enabled.")

    message = {
        "title": _(f"New Payment Request"),
        "description": _(f"New Payment: {doc.name} has been requested."),
        "project": doc.project,
        "sender": frappe.session.user,
        "docname": doc.name
    }
    
    for user in admin_users:
        new_notification_doc = frappe.new_doc('Nirmaan Notifications')
        new_notification_doc.update({
            "recipient": user.get('name'),
            "recipient_role": user.get('role_profile'),
            "sender": frappe.session.user if frappe.session.user != 'Administrator' else None,
            "title": message["title"],
            "description": message["description"],
            "document": 'Project Payments',
            "docname": doc.name,
            "project": doc.project,
            "seen": "false",
            "type": "info",
            "event_id": "payment:new",
            "action_url": "project-payments?tab=Approve%20Payments"
        })
        new_notification_doc.insert(ignore_permissions=True)
        frappe.db.commit()

        message["notificationId"] = new_notification_doc.name
        frappe.publish_realtime(
            event="payment:new",
            message=message,
            user=user.get('name')
        )


def on_update(doc, method):
    """
    On update, find the related PO term by searching and sync the status.
    """
    old_doc = doc.get_doc_before_save()
    if not old_doc or old_doc.status == doc.status:
        return # Do nothing if status hasn't changed

    # Call the search-based helper function to sync the status.
    _find_and_update_po_term(doc, doc.status)
    
    # --- Notification logic for specific status transitions ---
    if old_doc.status == 'Requested' and doc.status == "Approved":
        accountants = get_allowed_accountants(doc)
        project = frappe.get_doc("Projects", doc.project)
        if accountants:
            for user in accountants:
                if user.get("push_notification") == "true":
                    notification_title = f"Payment Approved for Project {project.project_name}!"
                    notification_body = (
                        f"Hi {user.get('full_name')}, a new payment has been approved for the PO:{doc.document_name}. "
                        "Please review and fulfill the payment."
                    )
                    click_action_url = f"{frappe.utils.get_url()}/frontend/project-payments?tab=New%20Payments"
                    PrNotification(user, notification_title, notification_body, click_action_url)
                
                message = {
                    "title": _("New Payment Approved"),
                    "description": _(f"A new payment has been approved for the PO: {doc.document_name}!"),
                    "project": doc.project, "sender": frappe.session.user, "docname": doc.name
                }
                new_notification_doc = frappe.new_doc('Nirmaan Notifications')
                new_notification_doc.update({
                    "recipient": user.get('name'), "recipient_role": user.get('role_profile'),
                    "sender": frappe.session.user if frappe.session.user != 'Administrator' else None,
                    "title": message["title"], "description": message["description"],
                    "document": 'Project Payments', "docname": doc.name, "project": doc.project,
                    "seen": "false", "type": "info", "event_id": "payment:approved",
                    "action_url": "project-payments?tab=New%20Payments"
                })
                new_notification_doc.insert(ignore_permissions=True)
                frappe.db.commit()

                message["notificationId"] = new_notification_doc.name
                frappe.publish_realtime(event="payment:approved", message=message, user=user.get('name'))
        else:
            print("No accountants found with push notifications enabled.")
    
    elif old_doc.status == 'Approved' and doc.status == 'Paid':
        allowed_users = get_allowed_lead_users(doc) + get_admin_users() + get_allowed_manager_users(doc) + get_allowed_procurement_users(doc)
        project = frappe.get_doc("Projects", doc.project)
        vendor = frappe.get_doc("Vendors", doc.vendor)
        if allowed_users:
            for user in allowed_users:
                if user.get("push_notification") == "true":
                    notification_title = f"Payment Fulfilled for Vendor: {vendor.vendor_name}!"
                    notification_body = (
                        f"Hi {user.get('full_name')}, the payment: {doc.name} associated with PO: {doc.document_name} has been fulfilled."
                    )
                    click_action_url = f"{frappe.utils.get_url()}/frontend/project-payments?tab=Payments%20Done"
                    PrNotification(user, notification_title, notification_body, click_action_url)

                message = {
                    "title": _("Payment Status Changed"),
                    "description": _(f"The payment: {doc.name} has been fulfilled!"),
                    "project": doc.project, "sender": frappe.session.user, "docname": doc.name
                }
                new_notification_doc = frappe.new_doc('Nirmaan Notifications')
                new_notification_doc.update({
                    "recipient": user.get('name'), "recipient_role": user.get('role_profile'),
                    "sender": frappe.session.user if frappe.session.user != 'Administrator' else None,
                    "title": message["title"], "description": message["description"],
                    "document": 'Project Payments', "docname": doc.name, "project": doc.project,
                    "seen": "false", "type": "info", "event_id": "payment:fulfilled",
                    "action_url": "project-payments?tab=Payments%20Done"
                })
                new_notification_doc.insert(ignore_permissions=True)
                frappe.db.commit()

                message["notificationId"] = new_notification_doc.name
                frappe.publish_realtime(event="payment:fulfilled", message=message, user=user.get('name'))
        else:
            print("No matching users found with push notifications enabled for payment fulfillment.")


def on_trash(doc, method):
    """
    On deletion, find the related PO term by searching and revert its status.
    Also handles cleanup of notifications and comments.
    """
    # Determine the correct status to revert to.
    reverted_status = "Created" 
    try:
        term_details = frappe.db.get_value("PO Payment Terms", {"project_payment": doc.name}, ["due_date", "payment_type"], as_dict=True)
        if term_details and term_details.get('payment_type') == 'Credit' and term_details.get('due_date') and frappe.utils.getdate(term_details.get('due_date')) > nowdate():
            reverted_status = "Scheduled"
    except Exception:
        pass # Ignore if lookup fails, default to "Created"
        
    # Call the helper to find the term and reset it.
    _find_and_update_po_term(doc, reverted_status, clear_link=True)

    # --- Existing notification and comment cleanup logic ---
    frappe.db.delete("Nirmaan Comments", {"reference_name": doc.name})
    
    notifications = frappe.get_all("Nirmaan Notifications", 
                                   filters={"docname": doc.name},
                                   fields=["name", "recipient"])

    if notifications:
        for notification in notifications:
            message = {
                "title": _("Payment Deleted"),
                "description": _(f"Project Payment: {doc.name} has been deleted."),
                "docname": doc.name,
                "sender": frappe.session.user,
                "notificationId": notification.name
            }
            frappe.publish_realtime(
                event="payment:delete",
                message=message,
                user=notification.recipient
            )

    frappe.db.delete("Nirmaan Notifications", {"docname": doc.name})




    
# ------Before synchronic payment status link ----
# from ..Notifications.pr_notifications import PrNotification, get_allowed_lead_users, get_admin_users, get_allowed_accountants, get_allowed_manager_users, get_allowed_procurement_users
# import frappe
# from frappe import _
# from .procurement_requests import get_user_name




# # In nirmaan_stack/integrations/controllers/project_payments.py

# # ... (keep all your imports at the top)
# import frappe
# from frappe import _
# from .procurement_requests import get_user_name
# # Add this import if not present
# from frappe.utils import flt

# # ... (keep your PrNotification and get_user functions)

# # --- START: NEW HELPER FUNCTION ---
# def _sync_payment_status_to_po(doc):
#     """
#     Finds the related PO and updates the status of the matching payment term.
#     This is designed to be called from the main 'on_update' hook.
#     """
#     # 1. Ensure we have the necessary links to find the PO term.
#     if not doc.document_name or not doc.payment_term_name or doc.document_type != "Procurement Orders":
#         # If the payment is not linked to a PO's payment term, we can't do anything.
#         return

#     try:
#         # 2. Load the parent Procurement Order document
#         po_doc = frappe.get_doc("Procurement Orders", doc.document_name)

#         term_found = False
#         # 3. Iterate through the payment_terms child table
#         for term in po_doc.get("payment_terms"):
#             if term.name == doc.payment_term_name:
#                 # 4. We found the matching row! Update its status.
#                 term.status = doc.status
#                 term_found = True
#                 break # Exit the loop once found

#         if term_found:
#             # 5. Save the modified Procurement Order.
#             # We use 'db_update' for efficiency, as it only saves the changed fields
#             # and is less resource-intensive than a full .save()
#             po_doc.db_update()
#             # The framework handles the commit, so no need for frappe.db.commit()

#     except frappe.DoesNotExistError:
#         frappe.log_error(f"Could not find PO {doc.document_name} to sync status for Payment {doc.name}.", "Payment Sync Failed")
#     except Exception:
#         frappe.log_error(frappe.get_traceback(), "Payment Sync to PO Failed")
# # --- END: NEW HELPER FUNCTION ---

# def after_insert(doc, method):
#         admin_users = get_admin_users()

#         project = frappe.get_doc("Projects", doc.project)
        
#         if admin_users:
#             for user in admin_users:
#                 if user["push_notification"] == "true":
#                     # Dynamically generate notification title/body for each lead
#                     notification_title = f"New Payment Request for Project {project.project_name}"
#                     notification_body = (
#                         f"Hi {user['full_name']}, a new payment request for the {doc.document_name} "
#                         f"PO has been requested by {get_user_name(frappe.session.user)}, click here to take action."
#                         )
                    
#                     click_action_url = f"{frappe.utils.get_url()}/frontend/project-payments?tab=Approve%20Payments"
#                     # Send notification for each lead
#                     PrNotification(user, notification_title, notification_body, click_action_url)
#                 else:
#                     print(f"push notifications were not enabled for user: {user['full_name']}")
#         else:
#             print("No Leads or admins found with push notifications enabled.")

#         message = {
#             "title": _(f"New Payment Request"),
#             "description": _(f"New Payment: {doc.name} has been requested."),
#             "project": doc.project,
#             "sender": frappe.session.user,
#             "docname": doc.name
#         }
#         # Emit the event to the allowed users
#         for user in admin_users:
#             new_notification_doc = frappe.new_doc('Nirmaan Notifications')
#             new_notification_doc.recipient = user['name']
#             new_notification_doc.recipient_role = user['role_profile']
#             if frappe.session.user != 'Administrator':
#                 new_notification_doc.sender = frappe.session.user
#             new_notification_doc.title = message["title"]
#             new_notification_doc.description = message["description"]
#             new_notification_doc.document = 'Project Payments'
#             new_notification_doc.docname = doc.name
#             new_notification_doc.project = doc.project
#             new_notification_doc.seen = "false"
#             new_notification_doc.type = "info"
#             eventID = "payment:new"
#             new_notification_doc.event_id = eventID
#             new_notification_doc.action_url = f"project-payments?tab=Approve%20Payments"
#             new_notification_doc.insert()
#             frappe.db.commit()

#             message["notificationId"] = new_notification_doc.name
#             print(f"running publish realtime for: {user}")

#             frappe.publish_realtime(
#                 event=eventID,  # Custom event name
#                 message=message,
#                 user=user['name']  # Notify only specific users
#             )


# def on_update(doc, method):
#     old_doc = doc.get_doc_before_save()
#     if old_doc and old_doc.status == 'Requested' and doc.status == "Approved":
#         accountants = get_allowed_accountants(doc)
#         project = frappe.get_doc("Projects", doc.project)
#         if accountants:
#             for user in accountants:
#                 if user["push_notification"] == "true":
#                     notification_title = f"Payment Approved for Project {project.project_name}!"
#                     notification_body = (
#                             f"Hi {user['full_name']}, a new payment has been approved for the PO:{doc.document_name}. "
#                             "Please review and fulfill the payment."
#                         )
#                     click_action_url = f"{frappe.utils.get_url()}/frontend/project-payments?tab=New%20Payments"
#                     PrNotification(user, notification_title, notification_body, click_action_url)
#                 else:
#                     print(f"push notifications were not enabled for user: {user['full_name']}")
#                 message = {
#                     "title": _("New Payment Approved"),
#                     "description": _(f"A new payment has been approved for the PO: {doc.document_name}!"),
#                     "project": doc.project,
#                     "sender": frappe.session.user,
#                     "docname": doc.name
#                 }

#                 new_notification_doc = frappe.new_doc('Nirmaan Notifications')
#                 new_notification_doc.recipient = user['name']
#                 new_notification_doc.recipient_role = user['role_profile']
#                 if frappe.session.user != 'Administrator':
#                     new_notification_doc.sender = frappe.session.user
#                 new_notification_doc.title = message["title"]
#                 new_notification_doc.description = message["description"]
#                 new_notification_doc.document = 'Project Payments'
#                 new_notification_doc.docname = doc.name
#                 new_notification_doc.project = doc.project
#                 new_notification_doc.seen = "false"
#                 new_notification_doc.type = "info"
#                 new_notification_doc.event_id = "payment:approved"
#                 new_notification_doc.action_url = f"project-payments?tab=New%20Payments"
#                 new_notification_doc.insert()
#                 frappe.db.commit()

#                 message["notificationId"] = new_notification_doc.name
#                 print(f"running publish realtime for: {user}")

#                 frappe.publish_realtime(
#                     event="payment:approved",  # Custom event name
#                     message=message,
#                     user=user['name']  # Notify only specific users
#                 )
#         else:
#             print("No accountants found with push notifications enabled.")
    
#     elif old_doc and old_doc.status == 'Approved' and doc.status == 'Paid':
#         allowed_users = get_allowed_lead_users(doc) + get_admin_users() + get_allowed_manager_users(doc) + get_allowed_procurement_users(doc)
#         project = frappe.get_doc("Projects", doc.project)
#         vendor = frappe.get_doc("Vendors", doc.vendor)
#         if allowed_users:
#             for user in allowed_users:
#                 if user["push_notification"] == "true":
#                     notification_title = f"Payment Fulfilled for Vendor: {vendor.vendor_name}!"
#                     notification_body = (
#                             f"Hi {user['full_name']}, the payment: {doc.name} associated with PO: {doc.document_name} has been fulfilled."
#                         )
#                     click_action_url = f"{frappe.utils.get_url()}/frontend/project-payments?tab=Payments%20Done"
#                     PrNotification(user, notification_title, notification_body, click_action_url)
#                 else:
#                     print(f"push notifications were not enabled for user: {user['full_name']}")
#                 message = {
#                     "title": _("Payment Status Changed"),
#                     "description": _(f"The payment: {doc.name} has been fulfilled!"),
#                     "project": doc.project,
#                     "sender": frappe.session.user,
#                     "docname": doc.name
#                 }

#                 new_notification_doc = frappe.new_doc('Nirmaan Notifications')
#                 new_notification_doc.recipient = user['name']
#                 new_notification_doc.recipient_role = user['role_profile']
#                 if frappe.session.user != 'Administrator':
#                     new_notification_doc.sender = frappe.session.user
#                 new_notification_doc.title = message["title"]
#                 new_notification_doc.description = message["description"]
#                 new_notification_doc.document = 'Project Payments'
#                 new_notification_doc.docname = doc.name
#                 new_notification_doc.project = doc.project
#                 new_notification_doc.seen = "false"
#                 new_notification_doc.type = "info"
#                 new_notification_doc.event_id = "payment:fulfilled"
#                 new_notification_doc.action_url = f"project-payments?tab=Payments%20Done"
#                 new_notification_doc.insert()
#                 frappe.db.commit()

#                 message["notificationId"] = new_notification_doc.name
#                 print(f"running publish realtime for: {user}")

#                 frappe.publish_realtime(
#                     event="payment:fulfilled",  # Custom event name
#                     message=message,
#                     user=user['name']  # Notify only specific users
#                 )
#         else:
#             print("No accountants found with push notifications enabled.")


# def on_trash(doc, method):
#     frappe.db.delete("Nirmaan Comments", {
#         "reference_name" : ("=", doc.name)
#     })
#     notifications = frappe.db.get_all("Nirmaan Notifications", 
#                                       filters={"docname": doc.name},
#                                       fields={"name", "recipient"}
#                                       )
#     # THIS NOTIFICATION IS NOT USED IN THE UI
#     if notifications:
#         for notification in notifications:
#             print(f"running delete notification event for user: {notification['recipient']} with {notification['name']}")
#             message = {
#             "title": _("Payment Deleted"),
#             "description": _(f"Project Payment: {doc.name} has been deleted."),
#             "docname": doc.name,
#             "sender": frappe.session.user,
#             "notificationId" : notification["name"]
#             }
#             frappe.publish_realtime(
#                 event="payment:delete",
#                 message=message,
#                 user=notification["recipient"]
#             )
#     frappe.db.delete("Nirmaan Notifications", {
#         "docname": ("=", doc.name)
#     })