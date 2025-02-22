import frappe
import json

def execute():
    """
        Patch to add project_gst field to existing SR PO's
    """
    so_project_gst = "29ABFCS9095N1Z9"
    
    service_orders = frappe.get_all("Service Requests")
    for sr in service_orders:
        doc = frappe.get_doc("Service Requests", sr.name)
        if not doc.project_gst:
            doc.project_gst = so_project_gst
            doc.save(ignore_permissions=True)