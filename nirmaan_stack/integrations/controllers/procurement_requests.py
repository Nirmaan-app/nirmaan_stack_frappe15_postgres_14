import frappe
import json
from firebase_admin import messaging

def after_insert(doc, method):
    project_leads = frappe.db.get_list(
        'Nirmaan User Permissions',
        filters={'for_value': doc.project},
        fields=['user']
    )
    print(f"projectleads : {project_leads}")
    lead_user_ids = [pl['user'] for pl in project_leads]
    print(f"led user ids : {lead_user_ids}")
    lead_users = frappe.db.get_list(
        'Nirmaan Users',
        filters={
            'name': ['in', lead_user_ids],
            'role_profile': 'Nirmaan Project Lead Profile',
            'push_notification': 'true'
        },
        fields=['fcm_token', 'name']
    )

    print(f"lead users: {lead_users}")

    # Create the notification message
    notification_title = f"New PR Created for Project: {doc.project}"
    notification_body = f"A new PR has been created for the project {doc.project}."
    
    # Send push notifications to each project lead
    for lead in lead_users:
        if lead['fcm_token']:
            print(f"running send firebase notification")
            send_firebase_notification(lead['fcm_token'], notification_title, notification_body)
    # if(frappe.db.exists({"doctype": "Procurement Requests", "project": doc.project, "work_package": doc.work_package, "owner": doc.owner, "workflow_state": "Pending"})):
    last_prs = frappe.db.get_list("Procurement Requests", 
                                     filters={
                                         "project": doc.project,
                                         "work_package": doc.work_package,
                                         "owner": doc.owner,
                                         "workflow_state": "Pending"
                                         },
                                         fields=['name', 'project', 'work_package', 'owner', 'workflow_state', 'procurement_list', 'category_list'],
                                         order_by='creation desc'
                                         )
    if(len(last_prs)>1):
        last_pr = last_prs[1]
        new_item_ids = [item['name'] for item in doc.procurement_list['list']]
        new_procurement_list = doc.procurement_list
        for item in last_pr.procurement_list['list']:
            if item['name'] in new_item_ids:
                update_quantity(new_procurement_list, item['name'], item['quantity'])
            else:
                new_procurement_list['list'].append(item)
        
        # doc.procurement_list = new_procurement_list
        
        new_category_list = doc.category_list
        existing_names = {item['name'] for item in new_category_list['list']}
        for item in last_pr.category_list['list']:
            if item['name'] not in existing_names:
                new_category_list['list'].append(item)
            
        # doc.category_list = new_category_list
        # doc.save(ignore_permissions=True)
        frappe.db.set_value("Procurement Requests", doc.name, {
            "procurement_list": json.dumps(new_procurement_list),
            "category_list": json.dumps(new_category_list)
        })
        
        comments = frappe.db.get_all("Nirmaan Comments", {
            "reference_name": last_pr.name
        })

        if len(comments)>0:
            for comment in comments:
                frappe.db.set_value("Nirmaan Comments", comment.name, {
                    "reference_name": doc.name
                })

        frappe.delete_doc("Procurement Requests", last_pr.name)
    else: 
        pass

# def after_insert(doc, method):
    # users = []
    # pls = frappe.db.get_list('User Permission',
    #                          filters={
    #                              'for_value': doc.project
    #                          },
    #                          fields=['user'])
    # users += [pl['user'] for pl in pls]
    # admins = frappe.db.get_list('Nirmaan Users',
    #                             filters={
    #                                 'role_profile': 'Nirmaan Admin Profile'
    #                             },
    #                             fields=['email'])
    # users += [admin['email'] for admin in admins]
    # for user in users:
    #     frappe.publish_realtime(
    #         "pr:created",
    #         message=doc,
    #         doctype=doc.doctype,
    #         user=user
    #         )
    # pass

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
        frappe.logger().info(f"Successfully sent message: {response}")
    except Exception as e:
        frappe.logger().error(f"Failed to send notification: {e}")

def update_quantity(data, target_name, new_quantity):
    for item in data['list']:
        if item['name'] == target_name:
            item['quantity'] += new_quantity

def on_update(doc, method):
    pass

def on_trash(doc, method):
    comments = frappe.db.delete("Nirmaan Comments", {
        "reference_name" : ("=", doc.name)
    })