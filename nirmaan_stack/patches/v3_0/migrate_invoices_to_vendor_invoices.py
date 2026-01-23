"""
Migration patch to convert invoice_data JSON + Task documents to Vendor Invoices doctype.

This patch:
1. Iterates through all Procurement Orders and Service Requests with invoice_data
2. For each invoice entry (date_key → entry):
   - Finds matching Task (by task_doctype, task_docname, reference_value_1=date_key)
   - Extracts invoice_date from date_key (strips timestamp suffix)
   - Determines status from Task.status or entry.status
   - Converts legacy is_2b_activated → reconciliation_status
   - Creates Vendor Invoices document with all fields
   - Updates Nirmaan Attachments to reference the new Vendor Invoice
3. Logs statistics and errors

Note: Original Task documents and invoice_data JSON are preserved for rollback safety.
"""

import frappe
from frappe import _
import json
from datetime import datetime


def execute():
    """Migrate invoice data from JSON + Task to Vendor Invoices doctype."""
    frappe.logger().info("Starting Vendor Invoices migration...")

    stats = {
        "po_processed": 0,
        "sr_processed": 0,
        "invoices_created": 0,
        "tasks_matched": 0,
        "orphan_entries": 0,
        "errors": 0
    }

    # Process Procurement Orders
    po_stats = migrate_doctype_invoices("Procurement Orders")
    stats["po_processed"] = po_stats["docs_processed"]
    stats["invoices_created"] += po_stats["invoices_created"]
    stats["tasks_matched"] += po_stats["tasks_matched"]
    stats["orphan_entries"] += po_stats["orphan_entries"]
    stats["errors"] += po_stats["errors"]

    # Process Service Requests
    sr_stats = migrate_doctype_invoices("Service Requests")
    stats["sr_processed"] = sr_stats["docs_processed"]
    stats["invoices_created"] += sr_stats["invoices_created"]
    stats["tasks_matched"] += sr_stats["tasks_matched"]
    stats["orphan_entries"] += sr_stats["orphan_entries"]
    stats["errors"] += sr_stats["errors"]

    frappe.db.commit()

    # Log summary
    frappe.logger().info(
        f"Vendor Invoices migration completed:\n"
        f"  - POs processed: {stats['po_processed']}\n"
        f"  - SRs processed: {stats['sr_processed']}\n"
        f"  - Invoices created: {stats['invoices_created']}\n"
        f"  - Tasks matched: {stats['tasks_matched']}\n"
        f"  - Orphan entries (JSON without Task): {stats['orphan_entries']}\n"
        f"  - Errors: {stats['errors']}"
    )


def migrate_doctype_invoices(doctype: str) -> dict:
    """
    Migrate invoice_data for all documents of the given doctype.

    Args:
        doctype: "Procurement Orders" or "Service Requests"

    Returns:
        Dictionary with migration statistics
    """
    stats = {
        "docs_processed": 0,
        "invoices_created": 0,
        "tasks_matched": 0,
        "orphan_entries": 0,
        "errors": 0
    }

    # Get all documents with invoice_data using raw SQL for PostgreSQL compatibility
    docs = frappe.db.sql(
        f"""
        SELECT name, invoice_data, project, vendor
        FROM "tab{doctype}"
        WHERE invoice_data IS NOT NULL
        """,
        as_dict=True
    )

    for doc in docs:
        try:
            result = process_document_invoices(doctype, doc)
            stats["docs_processed"] += 1
            stats["invoices_created"] += result["created"]
            stats["tasks_matched"] += result["tasks_matched"]
            stats["orphan_entries"] += result["orphans"]
        except Exception as e:
            stats["errors"] += 1
            frappe.log_error(
                title=f"Vendor Invoice Migration Error - {doctype}",
                message=f"Failed to migrate {doctype} {doc.get('name')}: {str(e)}\n{frappe.get_traceback()}"
            )

    return stats


def process_document_invoices(doctype: str, doc: dict) -> dict:
    """
    Process all invoice entries for a single document.

    Args:
        doctype: "Procurement Orders" or "Service Requests"
        doc: Document dict with name, invoice_data, project, vendor

    Returns:
        Dictionary with counts: created, tasks_matched, orphans
    """
    result = {"created": 0, "tasks_matched": 0, "orphans": 0}

    invoice_data_raw = doc.get("invoice_data")
    if not invoice_data_raw:
        return result

    # Parse JSON if needed
    if isinstance(invoice_data_raw, str):
        try:
            invoice_data = json.loads(invoice_data_raw)
        except json.JSONDecodeError:
            frappe.log_error(
                title="Invoice Data Parse Error",
                message=f"Failed to parse invoice_data for {doctype} {doc['name']}"
            )
            return result
    elif isinstance(invoice_data_raw, dict):
        invoice_data = invoice_data_raw
    else:
        return result

    # Validate structure
    if "data" not in invoice_data or not isinstance(invoice_data.get("data"), dict):
        return result

    invoice_entries = invoice_data["data"]

    # Pre-fetch all Tasks for this document to minimize queries
    # Include creation, modified for timestamp preservation
    tasks = frappe.get_all(
        "Task",
        filters={
            "task_doctype": doctype,
            "task_docname": doc["name"],
            "task_type": "po_invoice_approval",
            "reference_name_1": "invoice_date_key"
        },
        fields=["name", "status", "reference_value_1", "reference_value_2", "reference_value_3", "reference_value_4",
                "creation", "modified", "assignee"]
    )

    # Index tasks by date_key for quick lookup
    task_map = {t["reference_value_1"]: t for t in tasks}

    # Process each invoice entry
    for date_key, entry in invoice_entries.items():
        if not isinstance(entry, dict):
            continue

        try:
            # Check if Vendor Invoice already exists (idempotency)
            existing = frappe.db.exists("Vendor Invoices", {
                "document_type": doctype,
                "document_name": doc["name"],
                "invoice_no": entry.get("invoice_no"),
                "invoice_date": extract_date_from_key(date_key)
            })

            if existing:
                continue  # Skip already migrated entries

            # Look up matching Task
            task = task_map.get(date_key)

            # Determine status (Task is source of truth, fall back to entry)
            status = "Pending"
            if task:
                result["tasks_matched"] += 1
                status = map_task_status(task.get("status", "Pending"))
            elif "status" in entry:
                status = map_task_status(entry.get("status", "Pending"))
                result["orphans"] += 1  # JSON entry without matching Task

            # Get attachment ID
            attachment_id = entry.get("invoice_attachment_id")
            if not attachment_id and task:
                attachment_id = task.get("reference_value_4")

            # Create Vendor Invoice
            invoice = create_vendor_invoice(
                doctype=doctype,
                docname=doc["name"],
                project=doc.get("project"),
                vendor=doc.get("vendor"),
                date_key=date_key,
                entry=entry,
                task=task,
                status=status,
                attachment_id=attachment_id
            )

            # Update Nirmaan Attachments to reference new Vendor Invoice
            if attachment_id:
                update_attachment_reference(attachment_id, invoice.name)

            result["created"] += 1

        except Exception as e:
            frappe.log_error(
                title="Invoice Entry Migration Error",
                message=f"Failed to migrate invoice entry {date_key} for {doctype} {doc['name']}: {str(e)}"
            )

    return result


def extract_date_from_key(date_key: str) -> str:
    """
    Extract the date portion from a date_key.

    Handles formats:
    - "2024-01-15" → "2024-01-15"
    - "2024-01-15_10:30:05.123456" → "2024-01-15"
    - "2024-01-15 10:30:05.123456" → "2024-01-15"

    Args:
        date_key: The date key from invoice_data

    Returns:
        Date string in YYYY-MM-DD format
    """
    # Take first 10 characters (YYYY-MM-DD)
    return date_key[:10] if date_key else None


def map_task_status(status: str) -> str:
    """
    Map Task status to Vendor Invoice status.

    Args:
        status: Task or entry status

    Returns:
        One of: "Pending", "Approved", "Rejected"
    """
    status_lower = (status or "").lower()

    if status_lower in ["approved", "completed"]:
        return "Approved"
    elif status_lower in ["rejected", "cancelled"]:
        return "Rejected"
    else:
        return "Pending"


def create_vendor_invoice(
    doctype: str,
    docname: str,
    project: str,
    vendor: str,
    date_key: str,
    entry: dict,
    task: dict,
    status: str,
    attachment_id: str
) -> "Document":
    """
    Create a new Vendor Invoice document.

    Args:
        doctype: Parent document type
        docname: Parent document name
        project: Project link
        vendor: Vendor link
        date_key: Original date key from JSON
        entry: Invoice entry data from JSON
        task: Matching Task document (or None)
        status: Determined status
        attachment_id: Nirmaan Attachments link

    Returns:
        Created Vendor Invoice document
    """
    # Get uploaded_by from entry - copy as-is without validation
    uploaded_by = entry.get("updated_by")

    # Determine reconciliation status
    reconciliation_status = ""
    if "reconciliation_status" in entry:
        reconciliation_status = entry.get("reconciliation_status", "")
    elif entry.get("is_2b_activated"):
        # Legacy conversion
        reconciliation_status = "full"

    # Get invoice amount
    invoice_amount = entry.get("amount", 0)
    if task and task.get("reference_value_3"):
        try:
            invoice_amount = float(task.get("reference_value_3"))
        except (ValueError, TypeError):
            pass

    # Determine reconciled_amount
    reconciled_amount = 0
    if "reconciled_amount" in entry:
        reconciled_amount = entry.get("reconciled_amount", 0)
    elif reconciliation_status == "full":
        reconciled_amount = invoice_amount

    # Create the invoice
    invoice = frappe.new_doc("Vendor Invoices")
    invoice.update({
        "document_type": doctype,
        "document_name": docname,
        "project": project,
        "vendor": vendor,
        "invoice_no": entry.get("invoice_no", ""),
        "invoice_date": extract_date_from_key(date_key),
        "invoice_amount": invoice_amount,
        "invoice_attachment": attachment_id,
        "status": status,
        "uploaded_by": uploaded_by,
        "reconciliation_status": reconciliation_status,
        "reconciled_amount": reconciled_amount,
        "reconciliation_proof": entry.get("reconciliation_proof_attachment_id"),
        # Extract reconciled_by and reconciled_date if reconciliation was done
        "reconciled_by": entry.get("reconciled_by") if reconciliation_status in ("partial", "full") else None,
        "reconciled_date": entry.get("reconciled_date") if reconciliation_status in ("partial", "full") else None
    })

    # Set approved_by and approved_on for Approved invoices
    if status == "Approved" and task:
        # Use Task.assignee for approved_by (who approved the invoice)
        if task.get("assignee"):
            invoice.approved_by = task.get("assignee")
        # Use Task.modified for approved_on (when it was approved)
        if task.get("modified"):
            invoice.approved_on = task.get("modified")

    invoice.flags.ignore_permissions = True
    invoice.flags.ignore_mandatory = True  # In case some fields are missing in old data
    invoice.insert()

    # PRESERVE ORIGINAL TIMESTAMPS from Task document
    # This is critical for maintaining historical accuracy in reporting
    if task:
        original_creation = task.get("creation")
        original_modified = task.get("modified") or original_creation

        update_fields = {}
        if original_creation:
            update_fields["creation"] = original_creation
            update_fields["modified"] = original_modified or original_creation

        if update_fields:
            frappe.db.set_value(
                "Vendor Invoices",
                invoice.name,
                update_fields,
                update_modified=False
            )

    return invoice


def update_attachment_reference(attachment_id: str, vendor_invoice_name: str):
    """
    Update Nirmaan Attachments to reference the new Vendor Invoice.

    Args:
        attachment_id: Nirmaan Attachments document name
        vendor_invoice_name: Newly created Vendor Invoice name
    """
    if not attachment_id or not frappe.db.exists("Nirmaan Attachments", attachment_id):
        return

    try:
        frappe.db.set_value(
            "Nirmaan Attachments",
            attachment_id,
            {
                "associated_doctype": "Vendor Invoices",
                "associated_docname": vendor_invoice_name
            },
            update_modified=False
        )
    except Exception as e:
        frappe.log_error(
            title="Attachment Reference Update Error",
            message=f"Failed to update attachment {attachment_id} to reference {vendor_invoice_name}: {str(e)}"
        )
