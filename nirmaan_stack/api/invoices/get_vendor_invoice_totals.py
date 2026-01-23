"""
API for efficient batch lookup of vendor invoice totals.

Provides aggregated invoice amounts by document, project, or vendor.
Used by frontend components to replace inline JSON parsing of invoice_data.
"""

import frappe
from frappe import _
from frappe.utils import flt
import json


@frappe.whitelist()
def get_invoice_totals_by_documents(document_type: str, document_names: str = None):
    """
    Returns aggregated approved invoice totals for multiple documents.

    Args:
        document_type: "Procurement Orders" or "Service Requests"
        document_names: JSON array of document names, or None for all

    Returns:
        dict: {
            "message": {
                "<document_name>": <total_approved_amount>,
                ...
            },
            "status": 200
        }
    """
    try:
        if document_type not in ["Procurement Orders", "Service Requests"]:
            frappe.throw(_("Invalid document type. Must be 'Procurement Orders' or 'Service Requests'."))

        # Parse document_names if provided
        doc_names_list = None
        if document_names:
            try:
                doc_names_list = json.loads(document_names)
                if not isinstance(doc_names_list, list):
                    frappe.throw(_("document_names must be a JSON array"))
            except json.JSONDecodeError:
                frappe.throw(_("Invalid JSON format for document_names"))

        # Build base filters
        filters = {
            "document_type": document_type,
            "status": "Approved"
        }

        # Add document_name filter if provided
        if doc_names_list and len(doc_names_list) > 0:
            filters["document_name"] = ["in", doc_names_list]

        # Aggregate totals using SQL for efficiency
        totals = frappe.db.sql("""
            SELECT
                document_name,
                SUM(invoice_amount) as total_amount
            FROM `tabVendor Invoices`
            WHERE document_type = %(doc_type)s
              AND status = 'Approved'
              {doc_filter}
            GROUP BY document_name
        """.format(
            doc_filter="AND document_name IN %(doc_names)s" if doc_names_list else ""
        ), {
            "doc_type": document_type,
            "doc_names": tuple(doc_names_list) if doc_names_list else ()
        }, as_dict=True)

        # Convert to dict for easy lookup
        result = {row["document_name"]: flt(row["total_amount"], 2) for row in totals}

        return {"message": result, "status": 200}

    except Exception as e:
        frappe.log_error(
            _("Error getting invoice totals by documents: {0}").format(str(e)),
            "Invoice Totals API Error"
        )
        frappe.throw(
            _("An error occurred while fetching invoice totals. Please check the error logs.")
        )


@frappe.whitelist()
def get_invoice_totals_by_project(project_id: str):
    """
    Returns total PO + SR invoice amounts for a project.

    Args:
        project_id: Project ID

    Returns:
        dict: {
            "message": {
                "po_invoice_total": number,
                "sr_invoice_total": number,
                "total_invoice_amount": number,
                "invoices": [...] // optional detailed list
            },
            "status": 200
        }
    """
    try:
        if not project_id:
            frappe.throw(_("project_id is required"))

        # Validate project exists
        if not frappe.db.exists("Projects", project_id):
            frappe.throw(_("Project {0} not found").format(project_id))

        # Get totals by document type
        totals = frappe.db.sql("""
            SELECT
                document_type,
                SUM(invoice_amount) as total_amount,
                COUNT(*) as invoice_count
            FROM `tabVendor Invoices`
            WHERE project = %(project_id)s
              AND status = 'Approved'
            GROUP BY document_type
        """, {"project_id": project_id}, as_dict=True)

        po_total = 0
        sr_total = 0

        for row in totals:
            if row["document_type"] == "Procurement Orders":
                po_total = flt(row["total_amount"], 2)
            elif row["document_type"] == "Service Requests":
                sr_total = flt(row["total_amount"], 2)

        return {
            "message": {
                "po_invoice_total": po_total,
                "sr_invoice_total": sr_total,
                "total_invoice_amount": flt(po_total + sr_total, 2)
            },
            "status": 200
        }

    except Exception as e:
        frappe.log_error(
            _("Error getting invoice totals for project {0}: {1}").format(project_id, str(e)),
            "Project Invoice Totals Error"
        )
        frappe.throw(
            _("An error occurred while fetching project invoice totals. Please check the error logs.")
        )


@frappe.whitelist()
def get_invoice_totals_by_vendor(vendor_id: str, start_date: str = None, end_date: str = None):
    """
    Returns invoice totals grouped by document for a vendor.

    Args:
        vendor_id: Vendor ID
        start_date: Optional start date filter (YYYY-MM-DD)
        end_date: Optional end date filter (YYYY-MM-DD)

    Returns:
        dict: {
            "message": {
                "total_invoice_amount": number,
                "po_invoice_total": number,
                "sr_invoice_total": number,
                "by_document": {
                    "<document_name>": {
                        "total": number,
                        "document_type": string,
                        "invoices": [...]
                    }
                }
            },
            "status": 200
        }
    """
    try:
        if not vendor_id:
            frappe.throw(_("vendor_id is required"))

        # Build filters
        filters = {
            "vendor": vendor_id,
            "status": "Approved"
        }

        # Add date filters if provided
        date_filter = ""
        params = {"vendor_id": vendor_id}

        if start_date and end_date:
            date_filter = "AND invoice_date BETWEEN %(start_date)s AND %(end_date)s"
            params["start_date"] = start_date
            params["end_date"] = end_date
        elif start_date:
            date_filter = "AND invoice_date >= %(start_date)s"
            params["start_date"] = start_date
        elif end_date:
            date_filter = "AND invoice_date <= %(end_date)s"
            params["end_date"] = end_date

        # Get detailed invoice data
        invoices = frappe.db.sql("""
            SELECT
                name,
                document_type,
                document_name,
                project,
                invoice_no,
                invoice_date,
                invoice_amount
            FROM `tabVendor Invoices`
            WHERE vendor = %(vendor_id)s
              AND status = 'Approved'
              {date_filter}
            ORDER BY invoice_date DESC
        """.format(date_filter=date_filter), params, as_dict=True)

        # Aggregate by document
        by_document = {}
        po_total = 0
        sr_total = 0

        for inv in invoices:
            doc_name = inv["document_name"]
            doc_type = inv["document_type"]
            amount = flt(inv["invoice_amount"], 2)

            if doc_name not in by_document:
                by_document[doc_name] = {
                    "total": 0,
                    "document_type": doc_type,
                    "project": inv.get("project"),
                    "invoices": []
                }

            by_document[doc_name]["total"] += amount
            by_document[doc_name]["invoices"].append({
                "name": inv["name"],
                "invoice_no": inv["invoice_no"],
                "invoice_date": str(inv["invoice_date"]) if inv["invoice_date"] else None,
                "amount": amount
            })

            if doc_type == "Procurement Orders":
                po_total += amount
            else:
                sr_total += amount

        return {
            "message": {
                "total_invoice_amount": flt(po_total + sr_total, 2),
                "po_invoice_total": flt(po_total, 2),
                "sr_invoice_total": flt(sr_total, 2),
                "by_document": by_document
            },
            "status": 200
        }

    except Exception as e:
        frappe.log_error(
            _("Error getting invoice totals for vendor {0}: {1}").format(vendor_id, str(e)),
            "Vendor Invoice Totals Error"
        )
        frappe.throw(
            _("An error occurred while fetching vendor invoice totals. Please check the error logs.")
        )


@frappe.whitelist()
def get_invoice_totals_for_projects(project_ids: str = None):
    """
    Returns aggregated invoice totals for multiple projects.
    Efficient batch lookup for reports.

    Args:
        project_ids: JSON array of project IDs, or None for all

    Returns:
        dict: {
            "message": {
                "<project_id>": {
                    "po_total": number,
                    "sr_total": number,
                    "total": number
                },
                ...
            },
            "status": 200
        }
    """
    try:
        # Parse project_ids if provided
        project_list = None
        if project_ids:
            try:
                project_list = json.loads(project_ids)
                if not isinstance(project_list, list):
                    frappe.throw(_("project_ids must be a JSON array"))
            except json.JSONDecodeError:
                frappe.throw(_("Invalid JSON format for project_ids"))

        # Build project filter
        project_filter = ""
        params = {}
        if project_list and len(project_list) > 0:
            project_filter = "AND project IN %(projects)s"
            params["projects"] = tuple(project_list)

        # Get aggregated totals
        totals = frappe.db.sql("""
            SELECT
                project,
                document_type,
                SUM(invoice_amount) as total_amount
            FROM `tabVendor Invoices`
            WHERE status = 'Approved'
              AND project IS NOT NULL
              AND project != ''
              {project_filter}
            GROUP BY project, document_type
        """.format(project_filter=project_filter), params, as_dict=True)

        # Organize by project
        result = {}
        for row in totals:
            project = row["project"]
            if project not in result:
                result[project] = {"po_total": 0, "sr_total": 0, "total": 0}

            amount = flt(row["total_amount"], 2)
            if row["document_type"] == "Procurement Orders":
                result[project]["po_total"] = amount
            else:
                result[project]["sr_total"] = amount

            result[project]["total"] = flt(
                result[project]["po_total"] + result[project]["sr_total"], 2
            )

        return {"message": result, "status": 200}

    except Exception as e:
        frappe.log_error(
            _("Error getting invoice totals for projects: {0}").format(str(e)),
            "Projects Invoice Totals Error"
        )
        frappe.throw(
            _("An error occurred while fetching project invoice totals. Please check the error logs.")
        )
