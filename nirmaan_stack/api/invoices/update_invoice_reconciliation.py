import frappe
from frappe import _
import json
from typing import Optional


# Valid reconciliation status values
# "na" = Not Applicable (for invoices that don't require 2B reconciliation)
RECONCILIATION_STATUS_VALUES = ("", "partial", "full", "na")


@frappe.whitelist()
def update_invoice_reconciliation(
    doctype: str,
    docname: str,
    date_key: str,
    reconciliation_status: str = "",
    reconciled_date: Optional[str] = None,
    reconciliation_proof_url: Optional[str] = None,
    reconciled_amount: Optional[float] = None
):
    """
    Updates the reconciliation status and proof attachment for an approved invoice.
    Only Accountants and Admins can perform this action.

    Args:
        doctype (str): "Procurement Orders" or "Service Requests"
        docname (str): The PO/SR document ID
        date_key (str): The invoice date key (e.g., "2025-02-28")
        reconciliation_status (str): Reconciliation status - "" (not reconciled),
                                     "partial" (partially reconciled), or "full" (fully reconciled)
        reconciled_date (str, optional): The reconciliation date (YYYY-MM-DD).
                                         Defaults to today if status is "partial" or "full".
        reconciliation_proof_url (str, optional): URL of the uploaded proof attachment.
                                                  Required when initially setting status to "partial" or "full".
                                                  Optional when updating an already reconciled invoice (keeps existing proof).
        reconciled_amount (float, optional): The reconciled amount.
                                             Required when status is "partial".
                                             Auto-set to invoice amount when status is "full".
                                             Auto-set to 0 when status is "".

    Returns:
        dict: Success or error message with status code.
    """
    # --- Input Validation ---
    if doctype not in ["Procurement Orders", "Service Requests"]:
        frappe.throw(_("Invalid doctype. Must be 'Procurement Orders' or 'Service Requests'."))

    if not docname:
        frappe.throw(_("Document name is required."))

    if not date_key:
        frappe.throw(_("Invoice date key is required."))

    # Validate reconciliation_status
    if reconciliation_status not in RECONCILIATION_STATUS_VALUES:
        frappe.throw(_("Invalid reconciliation status. Must be one of: '', 'partial', 'full', 'na'."))

    # "na" is NOT considered reconciled - it's a separate category for invoices that don't need reconciliation
    is_reconciled = reconciliation_status in ("partial", "full")

    # Note: Proof validation is deferred until we can check if there's existing proof
    # (see validation after fetching invoice data below)

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
        # 1. Get the current invoice_data directly from database
        doc_fields = frappe.db.get_value(doctype, docname, ["invoice_data", "project", "vendor"], as_dict=True)

        if not doc_fields:
            frappe.throw(_("Document {0} not found.").format(docname))

        invoice_data_raw = doc_fields.get("invoice_data")
        project = doc_fields.get("project")
        vendor = doc_fields.get("vendor")

        if not invoice_data_raw:
            frappe.throw(_("Invoice data is missing in {0}.").format(docname))

        # Parse the JSON data
        if isinstance(invoice_data_raw, str):
            invoice_data = json.loads(invoice_data_raw)
        elif isinstance(invoice_data_raw, dict):
            invoice_data = invoice_data_raw
        else:
            frappe.throw(_("Invalid invoice data format in {0}.").format(docname))

        # Get the data dictionary
        if "data" not in invoice_data or not isinstance(invoice_data["data"], dict):
            frappe.throw(_("Invoice data structure is invalid in {0}.").format(docname))

        invoice_data_dict = invoice_data["data"]

        # 2. Find and Validate the Invoice Entry
        if date_key not in invoice_data_dict:
            frappe.throw(_("Invoice entry with key '{0}' not found in {1}'s invoice data.").format(date_key, docname))

        invoice_entry = invoice_data_dict[date_key]

        # Only allow updating approved invoices
        if invoice_entry.get("status") != "Approved":
            frappe.throw(_("Can only update reconciliation status for approved invoices. Current status: {0}").format(
                invoice_entry.get("status", "Unknown")
            ))

        # 2a. Validate proof attachment requirement (deferred validation)
        # Check current reconciliation status and existing proof
        current_status = invoice_entry.get("reconciliation_status", "")
        existing_proof_attachment_id = invoice_entry.get("reconciliation_proof_attachment_id")

        # Proof is required ONLY when:
        # 1. Setting a NEW reconciliation status (changing from "" to "partial"/"full")
        # 2. AND there's no existing proof
        # If status is already partial/full and unchanged, proof is optional (keeps existing)
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
                    message=f"Attachment {existing_proof_attachment_id} not found when clearing reconciliation for {docname}"
                )

        # 4. Create new proof attachment if provided
        if is_reconciled and reconciliation_proof_url:
            attachment = create_reconciliation_proof_attachment(
                doctype=doctype,
                docname=docname,
                project=project,
                vendor=vendor,
                file_url=reconciliation_proof_url
            )
            new_proof_attachment_id = attachment.name

            # Delete old attachment if we're replacing it
            if existing_proof_attachment_id and existing_proof_attachment_id != new_proof_attachment_id:
                try:
                    frappe.delete_doc("Nirmaan Attachments", existing_proof_attachment_id, ignore_permissions=True, force=True)
                except frappe.DoesNotExistError:
                    pass  # Old attachment already gone

        # 5. Update the Invoice Entry with Reconciliation Fields
        invoice_data_dict[date_key]["reconciliation_status"] = reconciliation_status

        # Remove deprecated is_2b_activated field if present
        if "is_2b_activated" in invoice_data_dict[date_key]:
            del invoice_data_dict[date_key]["is_2b_activated"]

        # 5a. Set reconciled_amount based on status
        invoice_amount = invoice_entry.get("amount", 0)
        if reconciliation_status == "full":
            # Auto-set to invoice amount when fully reconciled
            final_reconciled_amount = invoice_amount
        elif reconciliation_status == "partial":
            # Use the user-provided value (already validated as required)
            final_reconciled_amount = float(reconciled_amount)
        else:
            # Not reconciled = 0
            final_reconciled_amount = 0

        invoice_data_dict[date_key]["reconciled_amount"] = final_reconciled_amount

        # Handle reconciled_date and reconciled_by
        if is_reconciled:
            # If reconciled and no date provided, use today
            if not reconciled_date:
                reconciled_date = frappe.utils.today()
            invoice_data_dict[date_key]["reconciled_date"] = reconciled_date
            invoice_data_dict[date_key]["reconciled_by"] = reconciled_by
            # Keep existing proof if no new one provided (allows updating amount without re-uploading)
            final_proof_attachment_id = new_proof_attachment_id if new_proof_attachment_id else existing_proof_attachment_id
            invoice_data_dict[date_key]["reconciliation_proof_attachment_id"] = final_proof_attachment_id
        else:
            # If clearing status, clear all reconciliation fields
            invoice_data_dict[date_key]["reconciled_date"] = None
            invoice_data_dict[date_key]["reconciled_by"] = None
            invoice_data_dict[date_key]["reconciliation_proof_attachment_id"] = None

        # 6. Save using db.set_value for reliable JSON update
        updated_invoice_data = {"data": invoice_data_dict}
        frappe.db.set_value(
            doctype,
            docname,
            "invoice_data",
            json.dumps(updated_invoice_data),
            update_modified=True
        )

        # Commit the transaction
        frappe.db.commit()

        return {
            "status": 200,
            "message": _("Invoice reconciliation status updated successfully."),
            "data": {
                "doctype": doctype,
                "docname": docname,
                "date_key": date_key,
                "reconciliation_status": reconciliation_status,
                "reconciled_date": reconciled_date if is_reconciled else None,
                "reconciled_by": reconciled_by if is_reconciled else None,
                "reconciliation_proof_attachment_id": final_proof_attachment_id if is_reconciled else None,
                "reconciled_amount": final_reconciled_amount
            }
        }

    except frappe.ValidationError:
        # Re-raise validation errors as-is
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
    doctype: str,
    docname: str,
    project: Optional[str],
    vendor: Optional[str],
    file_url: str
):
    """
    Creates a Nirmaan Attachments document for the reconciliation proof.

    Args:
        doctype: "Procurement Orders" or "Service Requests"
        docname: The document name
        project: Project ID (optional)
        vendor: Vendor ID (optional)
        file_url: URL of the uploaded file

    Returns:
        The created attachment document
    """
    attachment_type = "po reconciliation proof" if doctype == "Procurement Orders" else "sr reconciliation proof"

    attachment = frappe.new_doc("Nirmaan Attachments")
    attachment.update({
        "project": project,
        "attachment": file_url,
        "attachment_type": attachment_type,
        "associated_doctype": doctype,
        "associated_docname": docname,
        "attachment_link_doctype": "Vendors" if vendor else None,
        "attachment_link_docname": vendor if vendor else None
    })
    attachment.insert(ignore_permissions=True)
    return attachment
