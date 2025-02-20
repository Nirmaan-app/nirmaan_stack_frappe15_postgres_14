import frappe
import json

def execute():
    """
        Patch to add project_gst_number json field to existing projects and project_gst field to existing PO's
    """
    default_gst = {
                "list" : [
                    {
                        "location" : "Bengaluru",
                        "gst": "29ABFCS9095N1Z9"
                    }
                ]
            }
    po_project_gst = "29ABFCS9095N1Z9"
    projects = frappe.get_all("Projects")
    for project in projects:
        doc = frappe.get_doc("Projects", project.name)
        if not doc.project_gst_number:
            doc.project_gst_number = default_gst
            doc.save(ignore_permissions=True)
    
    procurement_orders = frappe.get_all("Procurement Orders")
    for procurement_order in procurement_orders:
        doc = frappe.get_doc("Procurement Orders", procurement_order.name)
        if not doc.project_gst:
            doc.project_gst = po_project_gst
            doc.save(ignore_permissions=True)