import frappe
from frappe import _

@frappe.whitelist()
def generate_all_po_invoice_data(start_date=None, end_date=None):
    """
    Generate consolidated invoice data for all APPROVED invoices in Procurement Orders.

    Returns:
        dict: {
                "message": {
                    "invoice_entries": List[InvoiceEntry],
                    "total_invoices": number,
                    "total_amount": number,
                    "total_fully_reconciled": number,
                    "total_partially_reconciled": number,
                    "pending_reconciliation": number,
                    "total_reconciled_amount": number,
                    "total_fully_reconciled_amount": number,
                    "total_partially_reconciled_amount": number,
                    "total_not_reconciled_amount": number
                 },
                 "status": 200
              }
        where InvoiceEntry includes:
            - invoice_no (str)
            - amount (number)
            - reconciled_amount (number)
            - invoice_attachment_id (str, optional)
            - updated_by (str)
            - date (str)  (The key from each invoice_data object)
            - procurement_order (str) (PO ID)
            - project (str, optional) (Project ID, if available on PO)
            - vendor (str) (Vendor ID)
            - vendor_name (str) (Vendor Name)
            - reconciliation_status (str): "" | "partial" | "full"
            - reconciled_date (str, optional)
            - reconciled_by (str, optional)
            - reconciliation_proof_attachment_id (str, optional)

    Raises:
        Exception: For unexpected errors.
    """
    try:
        # Fetch all procurement orders from the system.
        # Include 'project' field as it might be relevant for some POs.
        procurement_orders = frappe.get_all(
            "Procurement Orders",
           filters={
                "status": ("not in", [ "Merged", "Inactive", "PO Amendment"])
                },
            fields=["name", "invoice_data", "vendor", "vendor_name", "project"]
        )

        invoice_entries = []
        total_fully_reconciled = 0
        total_partially_reconciled = 0
        # Amount tracking
        total_reconciled_amount = 0  # SUM of reconciled_amount field
        total_fully_reconciled_amount = 0  # invoice_amount where status = "full"
        total_partially_reconciled_amount = 0  # invoice_amount where status = "partial"
        total_not_reconciled_amount = 0  # invoice_amount where status = ""

        # Loop through each procurement order and extract invoice data.
        for po in procurement_orders:
            # Skip if there is no invoice data or if the structure is not a dict.
            if not po.get("invoice_data") or not isinstance(po.invoice_data, dict):
                continue

            # Expecting invoice_data to have a "data" key with a dictionary of invoice entries.
            invoice_data_dict = po.invoice_data.get("data", {})

            for date_str, invoice_item in invoice_data_dict.items():
                # Validate that required keys are present before adding the entry.
                if not all(key in invoice_item for key in ["invoice_no", "amount", "updated_by"]):
                    frappe.log_error(
                        _("Invalid invoice data structure in PO {0}").format(po.name),
                        "Invoice Data Validation"
                    )
                    continue

                # Only include APPROVED invoices
                status = invoice_item.get("status", "Pending")
                if status != "Approved":
                    continue

                # Date filtering (if provided)
                if start_date or end_date:
                    try:
                        invoice_date = frappe.utils.getdate(date_str)
                        if start_date and invoice_date < frappe.utils.getdate(start_date):
                            continue
                        if end_date and invoice_date > frappe.utils.getdate(end_date):
                            continue
                    except Exception:
                        continue  # Skip entries with invalid dates

                # Get reconciliation_status (new field) or derive from is_2b_activated (legacy)
                reconciliation_status = invoice_item.get("reconciliation_status")
                if reconciliation_status is None:
                    # Legacy migration: convert is_2b_activated to reconciliation_status
                    is_2b_activated = invoice_item.get("is_2b_activated", False)
                    reconciliation_status = "full" if is_2b_activated else ""

                # Get invoice amount and reconciled_amount
                invoice_amount = invoice_item.get("amount", 0)
                # Get reconciled_amount, defaulting based on status for legacy data
                reconciled_amount = invoice_item.get("reconciled_amount")
                if reconciled_amount is None:
                    # Legacy data: derive from status
                    if reconciliation_status == "full":
                        reconciled_amount = invoice_amount
                    else:
                        reconciled_amount = 0

                # Track amounts and counts by reconciliation status
                total_reconciled_amount += reconciled_amount
                if reconciliation_status == "full":
                    total_fully_reconciled += 1
                    total_fully_reconciled_amount += invoice_amount
                elif reconciliation_status == "partial":
                    total_partially_reconciled += 1
                    total_partially_reconciled_amount += invoice_amount
                else:
                    total_not_reconciled_amount += invoice_amount

                entry = {
                    "date": date_str,
                    "invoice_no": invoice_item["invoice_no"],
                    "amount": invoice_amount,
                    "reconciled_amount": reconciled_amount,
                    "updated_by": invoice_item["updated_by"],
                    "invoice_attachment_id": invoice_item.get("invoice_attachment_id"),
                    "procurement_order": po.name,
                    "project": po.project,
                    "vendor": po.vendor,
                    "vendor_name": po.vendor_name,
                    "reconciliation_status": reconciliation_status,
                    "reconciled_date": invoice_item.get("reconciled_date"),
                    "reconciled_by": invoice_item.get("reconciled_by"),
                    "reconciliation_proof_attachment_id": invoice_item.get("reconciliation_proof_attachment_id")
                }
                invoice_entries.append(entry)

        total_invoices = len(invoice_entries)
        pending_reconciliation = total_invoices - total_fully_reconciled - total_partially_reconciled
        pending_reconciliation_amount = total_partially_reconciled_amount + total_not_reconciled_amount

        formatted_invoice_entries = {
            "invoice_entries": invoice_entries,
            "total_invoices": total_invoices,
            "total_amount": sum(entry["amount"] for entry in invoice_entries),
            "total_fully_reconciled": total_fully_reconciled,
            "total_partially_reconciled": total_partially_reconciled,
            "pending_reconciliation": pending_reconciliation,
            # New amount metrics
            "total_reconciled_amount": total_reconciled_amount,
            "total_fully_reconciled_amount": total_fully_reconciled_amount,
            "total_partially_reconciled_amount": total_partially_reconciled_amount,
            "total_not_reconciled_amount": total_not_reconciled_amount,
            "pending_reconciliation_amount": pending_reconciliation_amount
        }

        return {"message": formatted_invoice_entries, "status": 200}

    except Exception as e:
        # Log any errors and throw a generic error message.
        frappe.log_error(
            _("Error generating all PO invoice data: {0}").format(str(e)),
            "All PO Invoice Generation Error"
        )
        frappe.throw(
            _("An error occurred while generating all PO invoice data. Please check the error logs.")
        )