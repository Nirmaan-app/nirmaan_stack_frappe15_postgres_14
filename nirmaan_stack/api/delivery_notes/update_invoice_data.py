import frappe
from datetime import datetime

@frappe.whitelist()
def update_invoice_data(po_id: str, invoice_data: dict, invoice_attachment: str = None):
    """
    Updates the invoice data for a Procurement Order and optionally adds an invoice attachment.

    Args:
        po_id (str): Procurement Order ID.
        invoice_data (dict): Invoice data to append.
        invoice_attachment (str, optional): URL of uploaded invoice attachment. Defaults to None.
    """
    try:
        frappe.db.begin()

        po = frappe.get_doc("Procurement Orders", po_id)

        # Add invoice data
        add_invoice_history(po, invoice_data)

        # Save procurement order updates
        po.save()

        # Handle invoice attachment
        if invoice_attachment:
            create_attachment_doc(
                po,
                invoice_attachment,
                "po invoice"
            )

        frappe.db.commit()

        return {
            "status": 200,
            "message": f"Updated invoice data for {po_id}",
        }

    except Exception as e:
        frappe.db.rollback()
        frappe.log_error("Invoice Data Update Error", str(e))
        return {
            "status": 400,
            "message": f"Update failed: {str(e)}",
            "error": frappe.get_traceback()
        }

def add_invoice_history(po, new_data: dict):
    """Append new invoice data to existing history"""
    existing_data = po.get("invoice_data") or {"data": {}}

    if "data" not in existing_data:
        existing_data["data"] = {}

    invoice_date = new_data.get("date")  # Get date from new_data

    # Remove date field from new_data before merging
    invoice_data_without_date = {k: v for k, v in new_data.items() if k != "date"}

    existing_data["data"].update({invoice_date: invoice_data_without_date})
    po.invoice_data = existing_data

def create_attachment_doc(po, file_url: str, attachment_type: str):
    """Create standardized attachment document"""
    attachment = frappe.new_doc("Nirmaan Attachments")
    attachment.update({
        "project": po.project,
        "attachment": file_url,
        "attachment_type": attachment_type,
        "associated_doctype": "Procurement Orders",
        "associated_docname": po.name,
        "attachment_link_doctype": "Vendors",
        "attachment_link_docname": po.vendor
    })
    attachment.insert(ignore_permissions=True)