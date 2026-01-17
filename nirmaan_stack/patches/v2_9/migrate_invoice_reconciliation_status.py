"""
Migration patch to convert is_2b_activated boolean to reconciliation_status enum.

This patch:
1. Iterates through all Procurement Orders and Service Requests with invoice_data
2. For each approved invoice entry:
   - Converts is_2b_activated: true -> reconciliation_status: "full"
   - Converts is_2b_activated: false/missing -> reconciliation_status: ""
   - Adds reconciliation_proof_attachment_id: null (existing "full" entries won't have proof)
"""

import frappe
from frappe import _
import json


def execute():
    """Migrate invoice reconciliation from boolean to enum status."""
    frappe.logger().info("Starting invoice reconciliation status migration...")

    # Process Procurement Orders
    po_count = migrate_doctype_invoices("Procurement Orders")
    frappe.logger().info(f"Migrated {po_count} Procurement Orders")

    # Process Service Requests
    sr_count = migrate_doctype_invoices("Service Requests")
    frappe.logger().info(f"Migrated {sr_count} Service Requests")

    frappe.db.commit()
    frappe.logger().info("Invoice reconciliation status migration completed successfully.")


def migrate_doctype_invoices(doctype: str) -> int:
    """
    Migrate invoice_data for all documents of the given doctype.

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

            # Only migrate if reconciliation_status doesn't exist yet
            if "reconciliation_status" not in entry:
                # Convert is_2b_activated to reconciliation_status
                is_2b_activated = entry.get("is_2b_activated", False)

                if is_2b_activated:
                    entry["reconciliation_status"] = "full"
                else:
                    entry["reconciliation_status"] = ""

                # Add reconciliation_proof_attachment_id field (null for migrated data)
                if "reconciliation_proof_attachment_id" not in entry:
                    entry["reconciliation_proof_attachment_id"] = None

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
