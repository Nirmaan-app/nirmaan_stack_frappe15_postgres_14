"""
Migration patch to add reconciled_amount field to invoice_data entries.

This patch:
1. Iterates through all Procurement Orders and Service Requests with invoice_data
2. For each approved invoice entry with reconciliation_status:
   - status == "full": reconciled_amount = invoice amount
   - status == "partial": reconciled_amount = 0 (unknown, needs manual update)
   - status == "": reconciled_amount = 0

Note: Partial reconciliations will need manual review to set the correct reconciled_amount.
"""

import frappe
from frappe import _
import json


def execute():
    """Add reconciled_amount field to invoice data entries."""
    frappe.logger().info("Starting reconciled_amount field migration...")

    # Process Procurement Orders
    po_count = add_reconciled_amount_to_doctype("Procurement Orders")
    frappe.logger().info(f"Updated {po_count} Procurement Orders with reconciled_amount")

    # Process Service Requests
    sr_count = add_reconciled_amount_to_doctype("Service Requests")
    frappe.logger().info(f"Updated {sr_count} Service Requests with reconciled_amount")

    frappe.db.commit()
    frappe.logger().info("Reconciled amount field migration completed successfully.")


def add_reconciled_amount_to_doctype(doctype: str) -> int:
    """
    Add reconciled_amount to invoice_data for all documents of the given doctype.

    Args:
        doctype: "Procurement Orders" or "Service Requests"

    Returns:
        Number of documents updated
    """
    # Get all documents with invoice_data
    docs = frappe.get_all(
        doctype,
        filters=[["invoice_data", "is", "set"]],
        fields=["name", "invoice_data"]
    )

    updated_count = 0

    for doc in docs:
        invoice_data_raw = doc.get("invoice_data")

        if not invoice_data_raw:
            continue

        # Parse JSON if needed
        if isinstance(invoice_data_raw, str):
            try:
                invoice_data = json.loads(invoice_data_raw)
            except json.JSONDecodeError:
                frappe.log_error(
                    title=f"Invoice Data Parse Error",
                    message=f"Failed to parse invoice_data for {doctype} {doc.name}"
                )
                continue
        elif isinstance(invoice_data_raw, dict):
            invoice_data = invoice_data_raw
        else:
            continue

        # Check if data structure is valid
        if "data" not in invoice_data or not isinstance(invoice_data.get("data"), dict):
            continue

        invoice_data_dict = invoice_data["data"]
        modified = False

        # Process each invoice entry
        for date_key, entry in invoice_data_dict.items():
            if not isinstance(entry, dict):
                continue

            # Only add if reconciled_amount doesn't exist yet
            if "reconciled_amount" not in entry:
                reconciliation_status = entry.get("reconciliation_status", "")
                invoice_amount = entry.get("amount", 0)

                if reconciliation_status == "full":
                    # Fully reconciled = full invoice amount
                    entry["reconciled_amount"] = invoice_amount
                elif reconciliation_status == "partial":
                    # Partial = unknown, set to 0 (needs manual review)
                    entry["reconciled_amount"] = 0
                else:
                    # Not reconciled = 0
                    entry["reconciled_amount"] = 0

                modified = True

        # Save if modified
        if modified:
            frappe.db.set_value(
                doctype,
                doc.name,
                "invoice_data",
                json.dumps({"data": invoice_data_dict}),
                update_modified=False  # Don't update modified timestamp for data migration
            )
            updated_count += 1

    return updated_count
