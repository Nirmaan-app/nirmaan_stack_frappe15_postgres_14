import frappe
import json

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

def on_update(doc, method):
    pass

def on_trash(doc, method):
    pass