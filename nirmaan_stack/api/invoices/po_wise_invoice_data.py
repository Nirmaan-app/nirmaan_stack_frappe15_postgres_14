"""
API for generating consolidated PO invoice data.

Updated in v3.0 to query from Vendor Invoices doctype directly.
"""

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
            - name (str): Vendor Invoice ID
            - invoice_no (str)
            - amount (number)
            - reconciled_amount (number)
            - invoice_attachment (str, optional)
            - uploaded_by (str)
            - invoice_date (str)
            - procurement_order (str): PO ID
            - project (str, optional)
            - vendor (str)
            - vendor_name (str)
            - reconciliation_status (str): "" | "partial" | "full" | "na"
            - reconciled_date (str, optional)
            - reconciled_by (str, optional)
            - reconciliation_proof (str, optional)
    """
    try:
        # Build filters
        filters = {
            "document_type": "Procurement Orders",
            "status": "Approved"
        }

        if start_date:
            filters["invoice_date"] = [">=", start_date]
        if end_date:
            if "invoice_date" in filters:
                # Need to handle combined date range
                filters["invoice_date"] = ["between", [start_date, end_date]]
            else:
                filters["invoice_date"] = ["<=", end_date]

        # Fetch all approved invoices for POs
        invoices = frappe.get_all(
            "Vendor Invoices",
            filters=filters,
            fields=[
                "name",
                "document_name",
                "project",
                "vendor",
                "invoice_no",
                "invoice_date",
                "invoice_amount",
                "invoice_attachment",
                "uploaded_by",
                "reconciliation_status",
                "reconciled_date",
                "reconciled_by",
                "reconciled_amount",
                "reconciliation_proof"
            ],
            order_by="invoice_date desc"
        )

        # Get vendor names in bulk
        vendor_ids = list(set(inv.get("vendor") for inv in invoices if inv.get("vendor")))
        vendor_names = {}
        if vendor_ids:
            vendors = frappe.get_all(
                "Vendors",
                filters={"name": ["in", vendor_ids]},
                fields=["name", "vendor_name"]
            )
            vendor_names = {v["name"]: v["vendor_name"] for v in vendors}

        # Process invoices and calculate metrics
        invoice_entries = []
        total_fully_reconciled = 0
        total_partially_reconciled = 0
        total_reconciled_amount = 0
        total_fully_reconciled_amount = 0
        total_partially_reconciled_amount = 0
        total_not_reconciled_amount = 0

        for inv in invoices:
            invoice_amount = inv.get("invoice_amount") or 0
            reconciliation_status = inv.get("reconciliation_status") or ""
            reconciled_amount = inv.get("reconciled_amount") or 0

            # Track amounts and counts by reconciliation status
            total_reconciled_amount += reconciled_amount

            if reconciliation_status == "full":
                total_fully_reconciled += 1
                total_fully_reconciled_amount += invoice_amount
            elif reconciliation_status == "partial":
                total_partially_reconciled += 1
                total_partially_reconciled_amount += invoice_amount
            elif reconciliation_status not in ("na",):
                # Not reconciled (empty string)
                total_not_reconciled_amount += invoice_amount

            entry = {
                "name": inv["name"],
                "invoice_no": inv.get("invoice_no"),
                "amount": invoice_amount,
                "reconciled_amount": reconciled_amount,
                "invoice_attachment_id": inv.get("invoice_attachment"),
                "uploaded_by": inv.get("uploaded_by"),
                "date": str(inv.get("invoice_date")) if inv.get("invoice_date") else None,
                "procurement_order": inv.get("document_name"),
                "project": inv.get("project"),
                "vendor": inv.get("vendor"),
                "vendor_name": vendor_names.get(inv.get("vendor"), ""),
                "reconciliation_status": reconciliation_status,
                "reconciled_date": str(inv.get("reconciled_date")) if inv.get("reconciled_date") else None,
                "reconciled_by": inv.get("reconciled_by"),
                "reconciliation_proof_attachment_id": inv.get("reconciliation_proof")
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
            "total_reconciled_amount": total_reconciled_amount,
            "total_fully_reconciled_amount": total_fully_reconciled_amount,
            "total_partially_reconciled_amount": total_partially_reconciled_amount,
            "total_not_reconciled_amount": total_not_reconciled_amount,
            "pending_reconciliation_amount": pending_reconciliation_amount
        }

        return {"message": formatted_invoice_entries, "status": 200}

    except Exception as e:
        frappe.log_error(
            _("Error generating all PO invoice data: {0}").format(str(e)),
            "All PO Invoice Generation Error"
        )
        frappe.throw(
            _("An error occurred while generating all PO invoice data. Please check the error logs.")
        )
