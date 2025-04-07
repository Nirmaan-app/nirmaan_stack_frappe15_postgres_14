import frappe
from frappe.model.document import Document
from datetime import datetime

@frappe.whitelist()
def update_invoice_data(po_id: str, invoice_data: dict, invoice_attachment: str = None, isSR: bool = False):
    """
    Updates the invoice data for a Procurement Order and optionally adds an invoice attachment.

    Args:
        po_id (str): Procurement Order ID.
        invoice_data (dict): Invoice data to append.
        invoice_attachment (str, optional): URL of uploaded invoice attachment. Defaults to None.
        isSR (bool, optional): Indicates if the document is a Service Request. Defaults to False.
    """
    doctype = "Service Requests" if isSR else "Procurement Orders"
    try:
        frappe.db.begin()

        po = frappe.get_doc(doctype , po_id)

         # Handle invoice attachment
        if invoice_attachment:
            attachment = create_attachment_doc(
                po,
                invoice_attachment,
                "po invoice"
            )
            if attachment and invoice_data:
                invoice_data["invoice_attachment_id"] = attachment.name
        # Add invoice data
        add_invoice_history(po, invoice_data)

        # Save procurement order updates
        po.save()

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

def add_invoice_history(po, new_data: dict) -> None:
    """Append new invoice data to existing history"""
    existing_data = po.get("invoice_data") or {"data": {}}

    if "data" not in existing_data:
        existing_data["data"] = {}

    invoice_date = new_data.get("date")  # Get date from new_data

    # Remove date field from new_data before merging
    invoice_data_without_date = {k: v for k, v in new_data.items() if k != "date"}

    if invoice_date not in existing_data["data"]:
        existing_data["data"][invoice_date] = invoice_data_without_date
    else:
        time_stamp = datetime.now().strftime("%H:%M:%S.%f") # use microseconds to prevent collision.
        unique_date = f"{invoice_date} {time_stamp}" #combine date and timestamp
        existing_data["data"][unique_date] = invoice_data_without_date # assign update info with unique date.

    po.invoice_data = existing_data

def create_attachment_doc(po, file_url: str, attachment_type: str) -> Document:
    """Create standardized attachment document"""
    attachment = frappe.new_doc("Nirmaan Attachments")
    attachment.update({
        "project": po.project,
        "attachment": file_url,
        "attachment_type": attachment_type,
        "associated_doctype": po.doctype,
        "associated_docname": po.name,
        "attachment_link_doctype": "Vendors",
        "attachment_link_docname": po.vendor
    })
    attachment.insert(ignore_permissions=True)
    return attachment