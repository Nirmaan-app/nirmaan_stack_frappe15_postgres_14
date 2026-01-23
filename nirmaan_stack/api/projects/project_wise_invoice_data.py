"""
API for generating project-wise invoice data.

Updated in v3.0 to query from Vendor Invoices doctype directly.
"""

import frappe
from frappe import _
from frappe.utils.caching import redis_cache


@frappe.whitelist()
@redis_cache(shared=True)
def generate_project_wise_invoice_data(project_id: str):
    """
    Generate consolidated invoice data for all approved invoices in a project.

    Args:
        project_id (str): The ID of the project for which invoice data is to be generated.

    Returns:
        dict: {
                "message": {
                    "invoice_entries": List[InvoiceEntry],
                    "total_invoices": number,
                    "total_amount": number
                 },
                 "status": 200
              }
        where InvoiceEntry includes:
            - name (str): Vendor Invoice ID
            - invoice_no (str)
            - invoice_amount (number)
            - invoice_attachment (str, optional)
            - uploaded_by (str)
            - invoice_date (str)
            - document_name (str): PO or SR ID
            - document_type (str): "Procurement Orders" or "Service Requests"
            - vendor (str): Vendor ID
            - vendor_name (str): Vendor Name

    Raises:
        frappe.DoesNotExistError: If the project is not found.
        Exception: For other unexpected errors.
    """
    try:
        # Validate project existence
        if not frappe.db.exists("Projects", project_id):
            frappe.throw(_("Project {0} not found").format(project_id), frappe.DoesNotExistError)

        # Fetch all approved invoices for the given project from Vendor Invoices doctype
        invoices = frappe.get_all(
            "Vendor Invoices",
            filters={
                "project": project_id,
                "status": "Approved"
            },
            fields=[
                "name",
                "document_type",
                "document_name",
                "vendor",
                "invoice_no",
                "invoice_date",
                "invoice_amount",
                "invoice_attachment",
                "uploaded_by"
            ],
            order_by="invoice_date desc"
        )

        # Get vendor names in bulk for efficiency
        vendor_ids = list(set(inv.get("vendor") for inv in invoices if inv.get("vendor")))
        vendor_names = {}
        if vendor_ids:
            vendors = frappe.get_all(
                "Vendors",
                filters={"name": ["in", vendor_ids]},
                fields=["name", "vendor_name"]
            )
            vendor_names = {v["name"]: v["vendor_name"] for v in vendors}

        # Build invoice entries
        invoice_entries = []
        for inv in invoices:
            entry = {
                "name": inv["name"],
                "invoice_date": str(inv["invoice_date"]) if inv.get("invoice_date") else None,
                "invoice_no": inv.get("invoice_no"),
                "invoice_amount": inv.get("invoice_amount") or 0,
                "uploaded_by": inv.get("uploaded_by"),
                "invoice_attachment_id": inv.get("invoice_attachment"),
                "document_name": inv.get("document_name"),
                "document_type": inv.get("document_type"),
                "vendor": inv.get("vendor"),
                "vendor_name": vendor_names.get(inv.get("vendor"), ""),
                # Legacy field mappings for backward compatibility
                "date": str(inv["invoice_date"]) if inv.get("invoice_date") else None,
                "amount": inv.get("invoice_amount") or 0,
                "updated_by": inv.get("uploaded_by"),
                "procurement_order": inv.get("document_name") if inv.get("document_type") == "Procurement Orders" else None
            }
            invoice_entries.append(entry)

        formatted_invoice_entries = {
            "invoice_entries": invoice_entries,
            "total_invoices": len(invoice_entries),
            "total_amount": sum(entry["invoice_amount"] for entry in invoice_entries)
        }

        return {"message": formatted_invoice_entries, "status": 200}

    except frappe.DoesNotExistError as e:
        frappe.throw(
            _("Project not found: {0}").format(project_id),
            frappe.DoesNotExistError
        )
    except Exception as e:
        frappe.log_error(
            _("Error generating invoice data for project {0}: {1}").format(project_id, str(e)),
            "Invoice Generation Error"
        )
        frappe.throw(
            _("An error occurred while generating invoice data. Please check the error logs.")
        )
