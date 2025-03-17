import frappe
from frappe import _
from ..Notifications.pr_notifications import PrNotification, get_allowed_lead_users, get_admin_users, get_allowed_procurement_users, get_allowed_accountants
from .procurement_requests import get_user_name

def after_insert(doc, method):
        proc_admin_users = get_allowed_procurement_users(doc) + get_admin_users(doc)
        accountant_users = get_allowed_accountants(doc)
        proc_admin_account_users = proc_admin_users + accountant_users
        pr = frappe.get_doc("Procurement Requests", doc.procurement_request)
        custom = doc.custom == "true"
        if proc_admin_account_users:
            for user in proc_admin_account_users:
                if user["push_notification"] == "true":
                    # Dynamically generate notification title/body for each lead
                    notification_title = f"New {'Custom PO' if custom else 'PO'} for Project {doc.project_name}"
                    notification_body = None
                    if custom:
                        notification_body = (
                            f"Hi {user['full_name']}, a new Custom PO for the {doc.project_name} "
                            f"project has been approved and created by {get_user_name(frappe.session.user)}, click here to take action."
                            )
                    else:
                        notification_body = (
                            f"Hi {user['full_name']}, a new purchase order for the {pr.work_package} "
                            f"work package has been approved and created by {get_user_name(frappe.session.user)}, click here to take action."
                            )
                    if user['role_profile'] != "Nirmaan Accountant Profile":
                        click_action_url = f"{frappe.utils.get_url()}/frontend/purchase-orders?tab=Approved%20PO"
                    else:
                        click_action_url = f"{frappe.utils.get_url()}/frontend/project-payments?tab=PO%20Wise"
                    # Send notification for each lead
                    PrNotification(user, notification_title, notification_body, click_action_url)
                else:
                    print(f"push notifications were not enabled for user: {user['full_name']}")
        else:
            print("No Proc Execs, Accountants or Admins found with push notifications enabled.")
        

        message = {
            "title": _(f"New {'Custom Purchase' if custom else 'Purchase'} Order"),
            "description": _(f"New {'Custom PO' if custom else 'PO'}: {doc.name} has been approved and created."),
            "project": doc.project,
            "work_package": pr.work_package if not custom else "Custom",
            "sender": frappe.session.user,
            "docname": doc.name
        }
        # Emit the event to the allowed users
        for user in proc_admin_account_users:
            new_notification_doc = frappe.new_doc('Nirmaan Notifications')
            new_notification_doc.recipient = user['name']
            new_notification_doc.recipient_role = user['role_profile']
            if frappe.session.user != 'Administrator':
                new_notification_doc.sender = frappe.session.user
            new_notification_doc.title = message["title"]
            new_notification_doc.description = message["description"]
            new_notification_doc.document = 'Procurement Orders'
            new_notification_doc.docname = doc.name
            new_notification_doc.project = doc.project
            new_notification_doc.work_package = pr.work_package if not custom else "Custom"
            new_notification_doc.seen = "false"
            new_notification_doc.type = "info"
            new_notification_doc.event_id = "po:new"
            action_url = doc.name.replace("/", "&=")
            if user['role_profile'] != "Nirmaan Accountant Profile":
                new_notification_doc.action_url = f"purchase-orders/{action_url}?tab=Approved%20PO"
            else:
                new_notification_doc.action_url = f"project-payments/{action_url}?tab=PO%20Wise"
            new_notification_doc.insert()
            frappe.db.commit()

            message["notificationId"] = new_notification_doc.name
            print(f"running publish realtime for: {user}")

            frappe.publish_realtime(
                event="po:new",  # Custom event name
                message=message,
                user=user['name']  # Notify only specific users
            )


def on_update(doc, method):
    """
    Manage Approved Quotations and Deletion of PO
    """
    doc = frappe.get_doc("Procurement Orders", doc.name)
    old_doc = doc.get_doc_before_save()
    custom = doc.custom == "true"

    if(doc.status=="PO Approved"):
        try:
            delete_existing_aq_docs(doc)
        except frappe.DoesNotExistError:
            print("PO NOT AVAILABLE IN DB")

    if old_doc and old_doc.status == 'PO Approved' and doc.status=="Dispatched":
        try:
            vendor = frappe.get_doc("Vendors", doc.vendor)
            orders = doc.order_list

            delete_existing_aq_docs(doc)

            for order in orders['list']:
                aq = frappe.new_doc('Approved Quotations')
                try:
                    if not doc.custom:
                        aq.item_id=order['name']
                    aq.vendor=doc.vendor
                    aq.procurement_order=doc.name
                    aq.item_name=order['item']
                    aq.unit=order['unit']
                    aq.quantity=order['quantity']
                    aq.quote=order['quote']
                    aq.tax=order['tax']
                    
                    if "makes" in order and 'list' in order['makes']:
                        enabled_make = next(
                            (make['make'] for make in order['makes']['list'] if make['enabled'] == "true"), 
                            None
                        )
                        aq.make = enabled_make
                    aq.city=vendor.vendor_city
                    aq.state=vendor.vendor_state
                    aq.insert()
                except frappe.DoesNotExistError:
                    continue
        except frappe.DoesNotExistError:
            print("VENDOR NOT AVAILABLE IN DB")
    if(doc.status=="Cancelled"):
        frappe.delete_doc("Procurement Orders", doc.name)

    if old_doc and old_doc.status == 'PO Approved' and doc.status == "PO Amendment":
        lead_admin_users = get_allowed_lead_users(doc) + get_admin_users(doc)
        pr = frappe.get_doc("Procurement Requests", doc.procurement_request)
        if lead_admin_users:
            for user in lead_admin_users:
                if user["push_notification"] == "true":
                    # Dynamically generate notification title/body for each lead
                    notification_title = f"PO: {doc.name} has been Amended"
                    notification_body = (
                        f"Hi {user['full_name']}, {'Custom PO' if custom else 'PO'}: {doc.name} for the {doc.project} "
                        f"project has been amended by {get_user_name(frappe.session.user)} and is awaiting your review."
                        )
                    click_action_url = f"{frappe.utils.get_url()}/frontend/purchase-orders?tab=Approve%20Amended%20PO"
                    # Send notification for each lead
                    PrNotification(user, notification_title, notification_body, click_action_url)
                else:
                    print(f"push notifications were not enabled for user: {user['full_name']}")
        else:
            print("No project leads or admins found with push notifications enabled.")

        message = {
            "title": _(f"{'Custom PO' if custom else 'PO'} Status Updated!"),
            "description": _(f" {'Custom PO' if custom else 'PO'}: {doc.name} has been amended!"),
            "project": doc.project,
            "work_package": pr.work_package if not custom else "Custom",
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
            new_notification_doc.document = 'Procurement Orders'
            new_notification_doc.docname = doc.name
            new_notification_doc.project = doc.project
            new_notification_doc.work_package = pr.work_package if not custom else "Custom"
            new_notification_doc.seen = "false"
            new_notification_doc.type = "info"
            new_notification_doc.event_id = "po:amended"
            action_url = doc.name.replace("/", "&=")
            new_notification_doc.action_url = f"purchase-orders/{action_url}?tab=Approve%20Amended%20PO"
            new_notification_doc.insert()
            frappe.db.commit()

            message["notificationId"] = new_notification_doc.name
            print(f"running publish realtime for: {user}")

            frappe.publish_realtime(
                event="po:amended",  # Custom event name
                message=message,
                user=user['name']  # Notify only specific users
            )

def on_trash(doc, method):
    frappe.db.delete("Nirmaan Comments", {
        "reference_name" : ("=", doc.name)
    })
    delete_existing_aq_docs(doc)
    print(f"flagged for delete po document: {doc} {doc.modified_by} {doc.owner}")
    notifications = frappe.db.get_all("Nirmaan Notifications", 
                                      filters={"docname": doc.name},
                                      fields={"name", "recipient"}
                                      )

    if notifications:
        for notification in notifications:
            print(f"running delete notification event for user: {notification['recipient']} with {notification['name']}")
            message = {
            "title": _("PO Deleted"),
            "description": _(f"PO: {doc.name} has been deleted."),
            "docname": doc.name,
            "sender": frappe.session.user,
            "notificationId" : notification["name"]
            }
            frappe.publish_realtime(
                event="po:delete",
                message=message,
                user=notification["recipient"]
            )
    frappe.db.delete("Nirmaan Notifications", {
        "docname": ("=", doc.name)
    })


def delete_existing_aq_docs(doc):
    # Check and delete existing approved quotations for this procurement order
    frappe.db.delete("Approved Quotations", {
        "procurement_order" : ("=", doc.name)
    })