import frappe
from frappe import _
import json


@frappe.whitelist()
def update_invoice_reconciliation(
    doctype: str,
    docname: str,
    date_key: str,
    is_2b_activated: bool,
    reconciled_date: str = None
):
    """
    Updates the 2B activation status and reconciliation date for an approved invoice.
    Only Accountants and Admins can perform this action.

    Args:
        doctype (str): "Procurement Orders" or "Service Requests"
        docname (str): The PO/SR document ID
        date_key (str): The invoice date key (e.g., "2025-02-28")
        is_2b_activated (bool): Whether the invoice is 2B activated
        reconciled_date (str, optional): The reconciliation date (YYYY-MM-DD).
                                         Defaults to today if is_2b_activated is True and not provided.

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

    # Convert string boolean to actual boolean if needed
    if isinstance(is_2b_activated, str):
        is_2b_activated = is_2b_activated.lower() in ("true", "1", "yes")

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
        invoice_data_raw = frappe.db.get_value(doctype, docname, "invoice_data")

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

        # 3. Update the Invoice Entry with Reconciliation Fields
        invoice_data_dict[date_key]["is_2b_activated"] = is_2b_activated

        # Handle reconciled_date
        if is_2b_activated:
            # If activated and no date provided, use today
            if not reconciled_date:
                reconciled_date = frappe.utils.today()
            invoice_data_dict[date_key]["reconciled_date"] = reconciled_date
            invoice_data_dict[date_key]["reconciled_by"] = reconciled_by
        else:
            # If deactivating, clear the reconciliation fields
            invoice_data_dict[date_key]["reconciled_date"] = None
            invoice_data_dict[date_key]["reconciled_by"] = None

        # 4. Save using db.set_value for reliable JSON update
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
                "is_2b_activated": is_2b_activated,
                "reconciled_date": reconciled_date if is_2b_activated else None,
                "reconciled_by": reconciled_by if is_2b_activated else None
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
