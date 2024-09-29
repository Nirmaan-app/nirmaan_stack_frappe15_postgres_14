import frappe

def after_insert(doc, method):
    """
    Create an event after item create
    """
    print("HELLO FROM AFTER CREATE")
    event = frappe.publish_realtime("items:created", {'message': 'item'+doc.name+'created'}, user=frappe.session.user)
    print(event)