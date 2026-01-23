"""
API for creating and managing invoice data for Procurement Orders and Service Requests.

This module handles:
- Creating new invoice entries (stored in Vendor Invoices doctype)
- Deleting invoice entries and their associated records
- Managing invoice attachments via Nirmaan Attachments

Updated in v3.0 to use Vendor Invoices doctype instead of Task + JSON.
"""

import frappe
from frappe.model.document import Document
from typing import Optional
import json


@frappe.whitelist()
def update_invoice_data(docname: str, invoice_data: str, invoice_attachment: str = None, isSR: bool = False):
    """
    Creates a new invoice entry for a document (PO or SR).

    This function:
    1. Creates a Nirmaan Attachments record for the invoice file
    2. Creates a Vendor Invoices record with status "Pending"

    Args:
        docname (str): The name of the Procurement Order or Service Request document.
        invoice_data (str): JSON string containing the new invoice details (invoice_no, amount, date).
        invoice_attachment (str, optional): URL of the uploaded invoice attachment. Defaults to None.
        isSR (bool, optional): True if the document is a Service Request, False for Procurement Order.

    Returns:
        dict: Success response with invoice details or error message.
    """
    doctype = "Service Requests" if isSR else "Procurement Orders"

    try:
        # Parse incoming invoice data string
        try:
            new_invoice_entry_data = json.loads(invoice_data)
            if not isinstance(new_invoice_entry_data, dict):
                raise ValueError("invoice_data must be a JSON object string.")
            if not all(k in new_invoice_entry_data for k in ["invoice_no", "amount", "date"]):
                raise ValueError("Missing required fields in invoice_data (invoice_no, amount, date).")
        except json.JSONDecodeError:
            frappe.throw(f"Invalid JSON format provided for invoice_data: {invoice_data}")
        except ValueError as ve:
            frappe.throw(str(ve))

        # --- Start Transaction ---
        frappe.db.begin()

        # Get parent document for project/vendor info
        doc = frappe.get_doc(doctype, docname)
        attachment_id = None

        # 1. Handle invoice attachment (if provided)
        if invoice_attachment:
            try:
                attachment = create_attachment_doc(
                    doc,
                    invoice_attachment,
                    "po invoice" if doctype == "Procurement Orders" else "sr invoice"
                )
                attachment_id = attachment.name
            except Exception as attach_err:
                frappe.log_error(
                    f"Failed to create attachment for {doctype} {docname}",
                    str(attach_err)
                )
                frappe.throw(f"Failed to process invoice attachment: {str(attach_err)}")

        # 2. Create the Vendor Invoice record
        try:
            vendor_invoice = create_vendor_invoice(
                parent_doc=doc,
                invoice_data=new_invoice_entry_data,
                attachment_id=attachment_id
            )
        except Exception as invoice_err:
            frappe.log_error(
                f"Failed to create Vendor Invoice for {doctype} {docname}",
                str(invoice_err)
            )
            frappe.throw(f"Failed to create invoice record: {str(invoice_err)}")

        # 3. Update attachment to reference the new Vendor Invoice (instead of PO/SR)
        if attachment_id:
            frappe.db.set_value(
                "Nirmaan Attachments",
                attachment_id,
                {
                    "associated_doctype": "Vendor Invoices",
                    "associated_docname": vendor_invoice.name
                },
                update_modified=False
            )

        # --- Commit Transaction ---
        frappe.db.commit()

        return {
            "status": 200,
            "message": f"Successfully created invoice {vendor_invoice.name} for {docname}",
            "data": {
                "vendor_invoice_id": vendor_invoice.name,
                "invoice_no": new_invoice_entry_data.get("invoice_no"),
                "invoice_date": new_invoice_entry_data.get("date"),
                "invoice_amount": new_invoice_entry_data.get("amount"),
                "attachment_id": attachment_id
            }
        }

    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(title="Invoice Data Update Error", message=frappe.get_traceback())
        return {
            "status": 400,
            "message": f"Invoice creation failed for {docname}. Please contact support.",
            "error": str(e)
        }


def create_attachment_doc(parent_doc: Document, file_url: str, attachment_type: str) -> Document:
    """Creates and inserts a 'Nirmaan Attachments' document."""
    attachment = frappe.new_doc("Nirmaan Attachments")
    attachment.update({
        "project": parent_doc.get("project"),
        "attachment": file_url,
        "attachment_type": attachment_type,
        "associated_doctype": parent_doc.doctype,
        "associated_docname": parent_doc.name,
        "attachment_link_doctype": "Vendors" if parent_doc.get("vendor") else None,
        "attachment_link_docname": parent_doc.get("vendor") if parent_doc.get("vendor") else None
    })
    attachment.insert(ignore_permissions=True)
    return attachment


def create_vendor_invoice(
    parent_doc: Document,
    invoice_data: dict,
    attachment_id: Optional[str]
) -> Document:
    """
    Creates a new Vendor Invoices document.

    Args:
        parent_doc: The parent PO or SR document
        invoice_data: Dict with invoice_no, amount, date
        attachment_id: Nirmaan Attachments document name (optional)

    Returns:
        The created Vendor Invoices document
    """
    # Get uploader info
    current_user = frappe.session.user
    uploaded_by = None

    if current_user != "Administrator" and current_user != "Guest":
        if frappe.db.exists("Nirmaan Users", current_user):
            uploaded_by = current_user

    invoice = frappe.new_doc("Vendor Invoices")
    invoice.update({
        "document_type": parent_doc.doctype,
        "document_name": parent_doc.name,
        "project": parent_doc.get("project"),
        "vendor": parent_doc.get("vendor"),
        "invoice_no": invoice_data.get("invoice_no"),
        "invoice_date": invoice_data.get("date"),
        "invoice_amount": invoice_data.get("amount"),
        "invoice_attachment": attachment_id,
        "status": "Pending",
        "uploaded_by": uploaded_by,
    })
    invoice.insert(ignore_permissions=True)

    frappe.msgprint(
        f"Created Invoice {invoice.name} for {parent_doc.doctype} {parent_doc.name}",
        indicator="green",
        alert=True
    )

    return invoice


@frappe.whitelist()
def delete_invoice_entry(docname: str, date_key: str = None, isSR: bool = False, invoice_id: str = None):
    """
    Deletes a Vendor Invoice and its associated attachment.

    This function now uses invoice_id directly (from Vendor Invoices doctype).
    The date_key and docname parameters are kept for backward compatibility.

    Args:
        docname (str): The name of the Procurement Order or Service Request document (deprecated).
        date_key (str, optional): The invoice date key (deprecated, use invoice_id instead).
        isSR (bool, optional): True if the document is a Service Request (deprecated).
        invoice_id (str, optional): The Vendor Invoices document name. Preferred method.

    Returns:
        dict: Success or error message.
    """
    doctype = "Service Requests" if isSR else "Procurement Orders"

    # Determine which invoice to delete
    vendor_invoice_name = invoice_id

    # If no invoice_id provided, try to find by date_key (backward compatibility)
    if not vendor_invoice_name and date_key and docname:
        # Extract date from date_key (first 10 chars)
        invoice_date = date_key[:10] if date_key else None

        # Find the Vendor Invoice by matching criteria
        invoices = frappe.get_all(
            "Vendor Invoices",
            filters={
                "document_type": doctype,
                "document_name": docname,
                "invoice_date": invoice_date
            },
            fields=["name"],
            limit=1
        )

        if invoices:
            vendor_invoice_name = invoices[0].name
        else:
            frappe.throw(f"No invoice found for {docname} with date {invoice_date}")

    if not vendor_invoice_name:
        frappe.throw("Invoice ID or date key is required.")

    try:
        # --- Start Transaction ---
        frappe.db.begin()

        # 1. Get the Vendor Invoice
        invoice = frappe.get_doc("Vendor Invoices", vendor_invoice_name)
        invoice_no = invoice.invoice_no
        attachment_id = invoice.invoice_attachment

        # 2. Delete associated attachment (if exists)
        if attachment_id:
            try:
                frappe.delete_doc("Nirmaan Attachments", attachment_id, ignore_permissions=True, force=True)
            except frappe.DoesNotExistError:
                frappe.log_error(
                    title="Attachment Deletion Warning",
                    message=f"Attachment {attachment_id} linked to invoice {vendor_invoice_name} not found."
                )
            except Exception as e:
                frappe.log_error(
                    f"Failed to delete attachment {attachment_id}",
                    frappe.get_traceback()
                )
                frappe.throw(f"Failed to delete associated attachment: {str(e)}")

        # 3. Delete reconciliation proof attachment (if exists)
        if invoice.reconciliation_proof:
            try:
                frappe.delete_doc("Nirmaan Attachments", invoice.reconciliation_proof, ignore_permissions=True, force=True)
            except frappe.DoesNotExistError:
                pass
            except Exception as e:
                frappe.log_error(
                    f"Failed to delete reconciliation proof {invoice.reconciliation_proof}",
                    frappe.get_traceback()
                )

        # 4. Delete the Vendor Invoice document
        frappe.delete_doc("Vendor Invoices", vendor_invoice_name, ignore_permissions=True, force=True)

        # --- Commit Transaction ---
        frappe.db.commit()

        return {
            "status": 200,
            "message": f"Successfully deleted invoice {invoice_no} ({vendor_invoice_name})",
        }

    except frappe.DoesNotExistError:
        frappe.db.rollback()
        frappe.throw(f"Vendor Invoice {vendor_invoice_name} not found.")
    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(title="Invoice Entry Deletion Error", message=frappe.get_traceback())
        return {
            "status": 400,
            "message": f"Invoice deletion failed. Please contact support.",
            "error": str(e)
        }
