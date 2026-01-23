"""
API for approving or rejecting Vendor Invoices.

This replaces the old update_task_status API that operated on Task documents.
"""

import frappe
from frappe import _


@frappe.whitelist()
def approve_vendor_invoice(invoice_id: str, action: str, rejection_reason: str = None):
    """
    Approve or reject a Vendor Invoice.

    Args:
        invoice_id (str): The Vendor Invoices document name (e.g., "VI-2026-00001")
        action (str): "Approved" or "Rejected"
        rejection_reason (str, optional): Required if action is "Rejected"

    Returns:
        dict: Success or error message with status code
    """
    # --- Input Validation ---
    if not invoice_id:
        frappe.throw(_("Invoice ID is required."))

    if action not in ["Approved", "Rejected"]:
        frappe.throw(_("Invalid action. Must be 'Approved' or 'Rejected'."))

    if action == "Rejected" and not rejection_reason:
        frappe.throw(_("Rejection reason is required when rejecting an invoice."))

    # --- Get Current User Info ---
    current_user = frappe.session.user
    if current_user == "Guest":
        frappe.throw(_("You must be logged in to perform this action."))

    # Get user details for audit trail
    if current_user == "Administrator":
        approver_name = None
    else:
        try:
            user_doc = frappe.get_doc("Nirmaan Users", current_user)
            approver_name = user_doc.name
        except frappe.DoesNotExistError:
            frappe.log_error(
                title="Invoice Approval Warning",
                message=f"Nirmaan Users document not found for user: {current_user}"
            )
            approver_name = current_user

    try:
        # --- Start Transaction ---
        frappe.db.begin()

        # 1. Get the Vendor Invoice document
        invoice = frappe.get_doc("Vendor Invoices", invoice_id)

        # 2. Validate current status
        if invoice.status != "Pending":
            frappe.throw(_("Invoice {0} is not in 'Pending' status. Current status: {1}").format(
                invoice_id, invoice.status
            ))

        # 3. Update the invoice
        invoice.status = action

        if action == "Approved":
            invoice.approved_by = approver_name
            invoice.approved_on = frappe.utils.now()
        else:  # Rejected
            invoice.rejection_reason = rejection_reason

        # 4. Save the invoice
        invoice.save(ignore_permissions=True)

        # --- Commit Transaction ---
        frappe.db.commit()

        return {
            "status": 200,
            "message": _("Invoice {0} has been {1}.").format(invoice_id, action.lower()),
            "data": {
                "invoice_id": invoice_id,
                "status": action,
                "approved_by": approver_name if action == "Approved" else None,
                "approved_on": str(invoice.approved_on) if action == "Approved" else None
            }
        }

    except frappe.DoesNotExistError:
        frappe.db.rollback()
        frappe.throw(_("Vendor Invoice {0} not found.").format(invoice_id))
    except frappe.ValidationError:
        frappe.db.rollback()
        raise
    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(
            title="Vendor Invoice Approval Error",
            message=frappe.get_traceback()
        )
        return {
            "status": 400,
            "message": _("Failed to update invoice {0}. Please contact support.").format(invoice_id),
            "error": str(e)
        }


@frappe.whitelist()
def bulk_approve_vendor_invoices(invoice_ids: list, action: str, rejection_reason: str = None):
    """
    Bulk approve or reject multiple Vendor Invoices.

    Args:
        invoice_ids (list): List of Vendor Invoice document names
        action (str): "Approved" or "Rejected"
        rejection_reason (str, optional): Required if action is "Rejected"

    Returns:
        dict: Results for each invoice
    """
    import json

    # Parse invoice_ids if it's a string (from frontend)
    if isinstance(invoice_ids, str):
        invoice_ids = json.loads(invoice_ids)

    if not invoice_ids:
        frappe.throw(_("At least one invoice ID is required."))

    results = {
        "success": [],
        "failed": []
    }

    for invoice_id in invoice_ids:
        try:
            result = approve_vendor_invoice(invoice_id, action, rejection_reason)
            if result.get("status") == 200:
                results["success"].append(invoice_id)
            else:
                results["failed"].append({
                    "invoice_id": invoice_id,
                    "error": result.get("message", "Unknown error")
                })
        except Exception as e:
            results["failed"].append({
                "invoice_id": invoice_id,
                "error": str(e)
            })

    return {
        "status": 200,
        "message": _("Processed {0} invoices. {1} succeeded, {2} failed.").format(
            len(invoice_ids),
            len(results["success"]),
            len(results["failed"])
        ),
        "data": results
    }
