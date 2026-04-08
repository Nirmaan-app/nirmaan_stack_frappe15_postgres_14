import frappe
from frappe.utils import flt, now_datetime


def _compute_credit_used(vendor_doc, exclude_po=None):
    """
    credit_used = pre_april_exposure + post_april_exposure.

    Post-April (creation >= 2025-04-01):
        Σ max(po_amount_delivered - amount_paid, 0) per PO

    Pre-April (creation < 2025-04-01):
        Σ max(total_invoiced - amount_paid, 0) per PO
        where total_invoiced = SUM(invoice_amount) from approved Vendor Invoices
    """
    exclude_clause = f" AND po.name != %s" if exclude_po else ""
    params_base = [vendor_doc.name]
    if exclude_po:
        params_base.append(exclude_po)

    # Post-April: use po_amount_delivered
    post_april = frappe.db.sql(f"""
        SELECT COALESCE(po.po_amount_delivered, 0) as delivered,
               COALESCE(po.amount_paid, 0) as paid
        FROM "tabProcurement Orders" po
        WHERE po.vendor = %s
        AND po.status NOT IN ('Cancelled', 'Merged', 'Inactive')
        AND po.creation >= '2025-04-01'
        {exclude_clause}
    """, tuple(params_base), as_dict=True)

    post_april_exposure = sum(max(flt(r.delivered) - flt(r.paid), 0) for r in post_april)

    # Pre-April: use total_invoiced from Vendor Invoices
    pre_april = frappe.db.sql(f"""
        SELECT COALESCE(SUM(vi.invoice_amount), 0) as total_invoiced,
               COALESCE(po.amount_paid, 0) as paid
        FROM "tabProcurement Orders" po
        LEFT JOIN "tabVendor Invoices" vi
            ON vi.document_type = 'Procurement Orders'
            AND vi.document_name = po.name
            AND vi.status = 'Approved'
        WHERE po.vendor = %s
        AND po.status NOT IN ('Cancelled', 'Merged', 'Inactive')
        AND po.creation < '2025-04-01'
        {exclude_clause}
        GROUP BY po.name, po.amount_paid
    """, tuple(params_base), as_dict=True)

    pre_april_exposure = sum(max(flt(r.total_invoiced) - flt(r.paid), 0) for r in pre_april)

    return pre_april_exposure + post_april_exposure


def recalculate_vendor_credit(vendor_id, entry_type, po_id=None, project=None, description=None, exclude_po=None):
    """
    Recalculates credit_used for a vendor from ALL eligible POs, updates
    available_credit, and appends a ledger entry.

    Auto-transitions On-Hold → Active when available_credit > 0.
    Active → On-Hold is only set by the daily cron.
    """
    if not vendor_id:
        return

    vendor = frappe.get_doc("Vendors", vendor_id)
    old_credit_used = flt(vendor.credit_used)

    credit_used = _compute_credit_used(vendor, exclude_po=exclude_po)
    credit_limit = flt(vendor.credit_limit) if vendor.credit_limit is not None else 50000
    available_credit = credit_limit - credit_used
    delta = credit_used - old_credit_used

    vendor.credit_used = credit_used
    vendor.available_credit = available_credit

    # Auto-reactivate: On-Hold → Active when credit is freed
    if vendor.vendor_status == "On-Hold" and available_credit > 0:
        vendor.vendor_status = "Active"

    # Append ledger entry
    vendor.append("credit_ledger", {
        "entry_type": entry_type,
        "po_id": po_id or "",
        "project": project or "",
        "delta_amount": delta,
        "credit_used_after": credit_used,
        "available_credit_after": available_credit,
        "timestamp": now_datetime(),
        "description": description or f"{entry_type} for {po_id or 'N/A'}",
        "triggered_by": frappe.session.user if frappe.session.user != "Administrator" else "System",
    })

    vendor.save(ignore_permissions=True)


@frappe.whitelist()
def update_credit_limit(vendor_id, new_limit):
    """Update credit limit and recalculate available_credit immediately."""
    if not vendor_id:
        frappe.throw("Vendor ID is required")

    new_limit = flt(new_limit)
    if new_limit < 0:
        frappe.throw("Credit limit cannot be negative")

    vendor = frappe.get_doc("Vendors", vendor_id)
    old_limit = flt(vendor.credit_limit)

    vendor.credit_limit = new_limit
    credit_used = _compute_credit_used(vendor)
    vendor.credit_used = credit_used
    vendor.available_credit = new_limit - credit_used

    old_status = vendor.vendor_status or "Active"
    new_status = "On-Hold" if vendor.available_credit <= 0 else "Active"
    vendor.vendor_status = new_status

    status_note = f" Status: {old_status} → {new_status}." if old_status != new_status else ""
    vendor.append("credit_ledger", {
        "entry_type": "Credit Limit Updated",
        "delta_amount": 0,
        "credit_used_after": vendor.credit_used,
        "available_credit_after": vendor.available_credit,
        "timestamp": now_datetime(),
        "description": f"Credit limit changed from {old_limit} to {new_limit}.{status_note}",
        "triggered_by": frappe.session.user,
    })

    vendor.save(ignore_permissions=True)
    frappe.db.commit()

    return {
        "credit_limit": vendor.credit_limit,
        "available_credit": vendor.available_credit,
        "credit_used": vendor.credit_used,
        "vendor_status": vendor.vendor_status,
    }
