import frappe
import json

def execute():
    """
    Set prs whose whose status is in ["RFQ Generated", "Quote Updated"] to "In Progress"
    """

    items = frappe.get_all("Items")

    for item in items:
        # pr_doc = frappe.get_doc("Procurement Requests", pr.name)
        # pr_doc.workflow_state = "In Progress"
        # pr_doc.save(ignore_permissions=True)
        frappe.db.set_value("Items", item.name, "order_category", "Local")
        frappe.db.set_value("Items", item.name, "billing_category", "Billable")
        frappe.db.commit()