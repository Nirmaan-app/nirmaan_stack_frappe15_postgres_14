"""
API for checking duplicate invoice numbers.

Checks for duplicate invoice numbers scoped to the same vendor:
- Same vendor + same invoice number in same PO/SR = blocking error
- Same vendor + same invoice number in different PO/SR = warning (can override)
"""

import frappe
from typing import Optional


@frappe.whitelist()
def check_duplicate_invoice(
    invoice_no: str,
    document_type: str,
    document_name: str,
    vendor: Optional[str] = None
) -> dict:
    """
    Check for duplicate invoice numbers scoped to the same vendor.

    Args:
        invoice_no: Invoice number to check
        document_type: "Procurement Orders" or "Service Requests"
        document_name: Current PO/SR name
        vendor: Vendor ID (required for duplicate check scope)

    Returns:
        dict with:
        - exists_in_current_doc: bool - blocks submission (same PO/SR)
        - exists_in_other_doc: bool - shows warning (different PO/SR, same vendor)
        - other_doc_name: str - which PO/SR has the duplicate
        - other_doc_type: str - "Procurement Orders" or "Service Requests"
    """
    result = {
        "exists_in_current_doc": False,
        "exists_in_other_doc": False,
        "other_doc_name": None,
        "other_doc_type": None
    }

    if not invoice_no or not invoice_no.strip():
        return result

    invoice_no = invoice_no.strip()

    # If no vendor provided, try to get it from the document
    if not vendor and document_name:
        try:
            vendor = frappe.db.get_value(document_type, document_name, "vendor")
        except Exception:
            pass

    # If still no vendor, return early (can't do vendor-scoped check)
    if not vendor:
        return result

    # Check for duplicates with the same vendor and invoice number
    # Using raw SQL for efficiency and to handle potential edge cases
    duplicates = frappe.db.sql("""
        SELECT name, document_type, document_name
        FROM `tabVendor Invoices`
        WHERE vendor = %(vendor)s
          AND invoice_no = %(invoice_no)s
        ORDER BY creation DESC
    """, {
        "vendor": vendor,
        "invoice_no": invoice_no
    }, as_dict=True)

    for dup in duplicates:
        if dup.document_type == document_type and dup.document_name == document_name:
            # Same document - this is a blocking duplicate
            result["exists_in_current_doc"] = True
        else:
            # Different document, same vendor - this is a warning
            result["exists_in_other_doc"] = True
            result["other_doc_name"] = dup.document_name
            result["other_doc_type"] = dup.document_type

    return result
