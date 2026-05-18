"""
Shared validation helpers for Vendor Invoice operations.

Used by both the extract endpoint (invoice_autofill.py) and the create endpoint
(update_invoice_data.py + _auto_approve.py) so rules don't drift across paths.
"""

import frappe


def normalize_gstin(value):
    return (value or "").strip().upper()


def gstin_match(extracted, expected, role):
    """Case-insensitive GSTIN comparison.

    Returns {extracted, expected, match, message}. match is None when there's
    nothing to compare against (missing expected value).
    """
    extracted_norm = normalize_gstin(extracted)
    expected_norm = normalize_gstin(expected)
    if not expected_norm:
        return {
            "extracted": extracted_norm,
            "expected": expected_norm,
            "match": None,
            "message": None,
        }
    if not extracted_norm:
        return {
            "extracted": "",
            "expected": expected_norm,
            "match": False,
            "message": f"AI couldn't extract the {role}'s GSTIN — please verify the invoice.",
        }
    is_match = extracted_norm == expected_norm
    return {
        "extracted": extracted_norm,
        "expected": expected_norm,
        "match": is_match,
        "message": (
            None
            if is_match
            else f"Extracted {role} GSTIN ({extracted_norm}) does not match the expected GSTIN ({expected_norm})."
        ),
    }


def existing_invoiced_sum(po_name, exclude_invoice_id=None):
    """Sum invoice_amount of Pending+Approved Vendor Invoices for a PO.

    Optional `exclude_invoice_id` lets callers omit a specific invoice (e.g.
    when re-checking against an invoice that was just inserted).
    """
    sql = """
        SELECT COALESCE(SUM(invoice_amount), 0) AS total
        FROM "tabVendor Invoices"
        WHERE document_type = %(doctype)s
          AND document_name = %(po_name)s
          AND status IN ('Pending', 'Approved')
    """
    params = {"doctype": "Procurement Orders", "po_name": po_name}
    if exclude_invoice_id:
        sql += " AND name != %(exclude)s"
        params["exclude"] = exclude_invoice_id

    rows = frappe.db.sql(sql, params, as_dict=True)
    if not rows:
        return 0.0
    return float(rows[0].get("total") or 0)
