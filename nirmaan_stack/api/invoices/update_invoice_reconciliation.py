"""
API for updating invoice reconciliation status.

Updated in v3.0 to work directly with Vendor Invoices doctype.
The old API using (doctype, docname, date_key) is deprecated but supported for compatibility.
"""

import frappe
from frappe import _
from typing import Optional


# Valid reconciliation status values
# "na" = Not Applicable (for invoices that don't require 2B reconciliation)
RECONCILIATION_STATUS_VALUES = ("", "partial", "full", "na")


@frappe.whitelist()
def update_invoice_reconciliation(
    invoice_id: str = None,
    reconciliation_status: str = "",
    reconciled_date: Optional[str] = None,
    reconciliation_proof_url: Optional[str] = None,
    reconciled_amount: Optional[float] = None,
    # Deprecated parameters for backward compatibility
    doctype: str = None,
    docname: str = None,
    date_key: str = None
):
    """
    Updates the reconciliation status and proof attachment for an approved invoice.
    Only Accountants and Admins can perform this action.

    New API (preferred):
        invoice_id (str): The Vendor Invoices document name (e.g., "VI-2026-00001")

    Deprecated API (backward compatible):
        doctype (str): "Procurement Orders" or "Service Requests"
        docname (str): The PO/SR document ID
        date_key (str): The invoice date key (e.g., "2025-02-28")

    Common parameters:
        reconciliation_status (str): "" (not reconciled), "partial", "full", or "na"
        reconciled_date (str, optional): The reconciliation date (YYYY-MM-DD).
                                         Defaults to today if status is "partial" or "full".
        reconciliation_proof_url (str, optional): URL of the uploaded proof attachment.
                                                  Required when initially setting status to "partial" or "full".
        reconciled_amount (float, optional): The reconciled amount.
                                             Required when status is "partial".
                                             Auto-set to invoice amount when status is "full".

    Returns:
        dict: Success or error message with status code.
    """
    # --- Resolve invoice_id from deprecated parameters ---
    if not invoice_id and doctype and docname and date_key:
        # Backward compatibility: find Vendor Invoice by old parameters
        invoice_date = date_key[:10] if date_key else None

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
            invoice_id = invoices[0].name
        else:
            frappe.throw(_("Invoice not found for {0} {1} with date {2}").format(doctype, docname, date_key))

    if not invoice_id:
        frappe.throw(_("Invoice ID is required."))

    # --- Input Validation ---
    if reconciliation_status not in RECONCILIATION_STATUS_VALUES:
        frappe.throw(_("Invalid reconciliation status. Must be one of: '', 'partial', 'full', 'na'."))

    # "na" is NOT considered reconciled - it's a separate category for invoices that don't need reconciliation
    is_reconciled = reconciliation_status in ("partial", "full")

    # Validate reconciled_amount for partial status
    if reconciliation_status == "partial" and reconciled_amount is None:
        frappe.throw(_("Reconciled amount is required for partial reconciliation."))

    # --- Permission Check ---
    current_user = frappe.session.user
    if current_user == "Guest":
        frappe.throw(_("You must be logged in to perform this action."))

    # Check if user has Accountant or Admin role
    allowed_roles = ["Nirmaan Admin Profile", "Nirmaan Accountant Profile", "Nirmaan PMO Executive Profile"]

    if current_user != "Administrator":
        try:
            user_doc = frappe.get_doc("Nirmaan Users", current_user)
            user_role = user_doc.role_profile
            if user_role not in allowed_roles:
                frappe.throw(_("You don't have permission to update invoice reconciliation status."))
        except frappe.DoesNotExistError:
            frappe.throw(_("User profile not found. Please contact support."))

    # Get user info for audit trail
    reconciled_by = current_user

    try:
        # 1. Get the Vendor Invoice
        invoice = frappe.get_doc("Vendor Invoices", invoice_id)

        # Only allow updating approved invoices
        if invoice.status != "Approved":
            frappe.throw(_("Can only update reconciliation status for approved invoices. Current status: {0}").format(
                invoice.status
            ))

        # 2. Check proof attachment requirement
        current_status = invoice.reconciliation_status or ""
        existing_proof_attachment_id = invoice.reconciliation_proof

        # Proof is required ONLY when:
        # 1. Setting a NEW reconciliation status (changing from "" to "partial"/"full")
        # 2. AND there's no existing proof
        status_changing_to_reconciled = is_reconciled and current_status not in ("partial", "full")

        if status_changing_to_reconciled and not reconciliation_proof_url and not existing_proof_attachment_id:
            frappe.throw(_("Reconciliation proof attachment is required when initially setting reconciliation status."))

        # 3. Handle existing proof attachment deletion if clearing status or setting to N/A
        new_proof_attachment_id = None
        is_clearing_status = reconciliation_status in ("", "na")

        if is_clearing_status and existing_proof_attachment_id:
            # Delete existing proof attachment when clearing status
            try:
                frappe.delete_doc("Nirmaan Attachments", existing_proof_attachment_id, ignore_permissions=True, force=True)
            except frappe.DoesNotExistError:
                frappe.log_error(
                    title="Reconciliation Proof Deletion Warning",
                    message=f"Attachment {existing_proof_attachment_id} not found when clearing reconciliation for {invoice_id}"
                )

        # 4. Create new proof attachment if provided
        if is_reconciled and reconciliation_proof_url:
            attachment = create_reconciliation_proof_attachment(
                invoice=invoice,
                file_url=reconciliation_proof_url
            )
            new_proof_attachment_id = attachment.name

            # Delete old attachment if we're replacing it
            if existing_proof_attachment_id and existing_proof_attachment_id != new_proof_attachment_id:
                try:
                    frappe.delete_doc("Nirmaan Attachments", existing_proof_attachment_id, ignore_permissions=True, force=True)
                except frappe.DoesNotExistError:
                    pass  # Old attachment already gone

        # 5. Calculate reconciled_amount based on status
        invoice_amount = invoice.invoice_amount or 0
        if reconciliation_status == "full":
            final_reconciled_amount = invoice_amount
        elif reconciliation_status == "partial":
            final_reconciled_amount = float(reconciled_amount)
        else:
            final_reconciled_amount = 0

        # 6. Update the Vendor Invoice
        invoice.reconciliation_status = reconciliation_status

        if is_reconciled:
            if not reconciled_date:
                reconciled_date = frappe.utils.today()
            invoice.reconciled_date = reconciled_date
            invoice.reconciled_by = reconciled_by
            invoice.reconciled_amount = final_reconciled_amount
            # Keep existing proof if no new one provided
            invoice.reconciliation_proof = new_proof_attachment_id if new_proof_attachment_id else existing_proof_attachment_id
        else:
            # Clear all reconciliation fields
            invoice.reconciled_date = None
            invoice.reconciled_by = None
            invoice.reconciled_amount = 0
            invoice.reconciliation_proof = None

        # 7. Save the invoice
        invoice.save(ignore_permissions=True)

        # Commit the transaction
        frappe.db.commit()

        return {
            "status": 200,
            "message": _("Invoice reconciliation status updated successfully."),
            "data": {
                "invoice_id": invoice_id,
                "reconciliation_status": reconciliation_status,
                "reconciled_date": reconciled_date if is_reconciled else None,
                "reconciled_by": reconciled_by if is_reconciled else None,
                "reconciliation_proof": invoice.reconciliation_proof if is_reconciled else None,
                "reconciled_amount": final_reconciled_amount
            }
        }

    except frappe.DoesNotExistError:
        frappe.throw(_("Vendor Invoice {0} not found.").format(invoice_id))
    except frappe.ValidationError:
        raise
    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(
            title="Invoice Reconciliation Update Error",
            message=frappe.get_traceback()
        )
        return {
            "status": 400,
            "message": _("Failed to update invoice reconciliation status: {0}").format(str(e)),
            "error": str(e)
        }


def create_reconciliation_proof_attachment(
    invoice: "Document",
    file_url: str
) -> "Document":
    """
    Creates a Nirmaan Attachments document for the reconciliation proof.

    Args:
        invoice: The Vendor Invoices document
        file_url: URL of the uploaded file

    Returns:
        The created attachment document
    """
    attachment_type = "invoice reconciliation proof"

    attachment = frappe.new_doc("Nirmaan Attachments")
    attachment.update({
        "project": invoice.project,
        "attachment": file_url,
        "attachment_type": attachment_type,
        "associated_doctype": "Vendor Invoices",
        "associated_docname": invoice.name,
        "attachment_link_doctype": "Vendors" if invoice.vendor else None,
        "attachment_link_docname": invoice.vendor if invoice.vendor else None
    })
    attachment.insert(ignore_permissions=True)
    return attachment
