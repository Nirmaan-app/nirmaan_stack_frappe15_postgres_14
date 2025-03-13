import frappe
import json

def execute():
    """
    Set prs whose whose status is in ["RFQ Generated", "Quote Updated"] to "In Progress"
    """

    prs = frappe.get_all("Procurement Requests",
                         filters={"workflow_state": ["in", ["RFQ Generated", "Quote Updated"]]}
                         )

    for pr in prs:
        # pr_doc = frappe.get_doc("Procurement Requests", pr.name)
        # pr_doc.workflow_state = "In Progress"
        # pr_doc.save(ignore_permissions=True)
        frappe.db.set_value("Procurement Requests", pr.name, "workflow_state", "In Progress")
        frappe.db.commit()