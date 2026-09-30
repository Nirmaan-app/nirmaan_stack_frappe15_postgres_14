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
        # "Can't verify" is NOT the same as "confirmed mismatch" — return null
        # so the frontend hard-block (which checks match === false) doesn't
        # fire on a missing extraction. Soft-warning is rendered instead.
        # Auto-approve gates 6/7 still keep the invoice Pending because they
        # check `not normalize_gstin(extracted)` independently of this match value.
        return {
            "extracted": "",
            "expected": expected_norm,
            "match": None,
            "message": f"AI couldn't extract the {role}'s GSTIN — please verify the invoice manually.",
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


# What the refusal calls each order whose Pending + Approved invoices are capped at its total.
ORDER_TOTAL_LABEL = {"Procurement Orders": "PO", "Service Requests": "Work Order"}


def existing_invoiced_sum(docname, exclude_invoice_id=None, doctype="Procurement Orders"):
    """Sum invoice_amount of Pending+Approved Vendor Invoices on one order
    (a Procurement Order, or a Work Order when `doctype` is "Service Requests").

    Optional `exclude_invoice_id` lets callers omit a specific invoice (e.g.
    the invoice being edited, or one that was just inserted).
    """
    sql = """
        SELECT COALESCE(SUM(invoice_amount), 0) AS total
        FROM "tabVendor Invoices"
        WHERE document_type = %(doctype)s
          AND document_name = %(docname)s
          AND status IN ('Pending', 'Approved')
    """
    params = {"doctype": doctype, "docname": docname}
    if exclude_invoice_id:
        sql += " AND name != %(exclude)s"
        params["exclude"] = exclude_invoice_id

    rows = frappe.db.sql(sql, params, as_dict=True)
    if not rows:
        return 0.0
    return float(rows[0].get("total") or 0)
