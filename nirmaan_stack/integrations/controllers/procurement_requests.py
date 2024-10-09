import frappe
import json

def before_insert(doc, method):
    if(frappe.db.exists({"doctype": "Procurement Requests", "project": doc.project, "work_package": doc.work_package, "owner": doc.owner, "workflow_state": "Pending"})):
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
        last_pr = last_prs[0]
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
            "procurement_list": new_procurement_list,
            "category_list": new_category_list
        })

        frappe.delete_doc("Procurement Requests", last_pr.name)
    else: 
        pass

def after_insert(doc, method):
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
            # )
    pass

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