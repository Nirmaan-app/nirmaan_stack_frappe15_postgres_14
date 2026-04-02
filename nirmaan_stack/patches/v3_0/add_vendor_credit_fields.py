import frappe
from frappe.utils import flt


def execute():
    """
    Initialize credit fields for all existing vendors.

    credit_limit: max(round(20% of FY 25-26 PO total_amount), 10000)
                  Defaults to 10000 if vendor has no POs in FY 25-26.
    credit_used:  pre-April invoice exposure + post-April delivery exposure.
                  Post-April: sum(max(po_amount_delivered - amount_paid, 0)) for POs created >= 2025-04-01.
                  Pre-April: sum(max(approved_invoices - amount_paid, 0)) for POs created < 2025-04-01,
                             using Vendor Invoices doctype for the "owed" side.
    available_credit: credit_limit - credit_used.
    vendor_status: "On-Hold" if available_credit <= 0, else "Active".
    """
    vendors = frappe.get_all("Vendors", fields=["name"])

    for v in vendors:
        # Step 1: credit_limit from FY 25-26 PO volume (1 Apr 2025 – 31 Mar 2026)
        fy_result = frappe.db.sql("""
            SELECT COALESCE(SUM(total_amount), 0) as total
            FROM "tabProcurement Orders"
            WHERE vendor = %s
            AND status NOT IN ('Cancelled', 'Merged', 'Inactive')
            AND creation >= '2025-04-01'
            AND creation < '2026-04-01'
        """, (v.name,), as_dict=True)

        total_po_value = flt(fy_result[0].total) if fy_result else 0
        twenty_percent = round(total_po_value * 0.20)
        credit_limit = max(twenty_percent, 10000) if total_po_value > 0 else 10000

        # Step 2: credit_used = pre-April invoice exposure + post-April delivery exposure

        # Post-April: delivery-based
        post_april_pos = frappe.db.sql("""
            SELECT COALESCE(po_amount_delivered, 0) as delivered,
                   COALESCE(amount_paid, 0) as paid
            FROM "tabProcurement Orders"
            WHERE vendor = %s
            AND status NOT IN ('Cancelled', 'Merged', 'Inactive')
            AND creation >= '2025-04-01'
        """, (v.name,), as_dict=True)

        post_april_exposure = sum(max(flt(r.delivered) - flt(r.paid), 0) for r in post_april_pos)

        # Pre-April: invoice-based (from Vendor Invoices doctype)
        pre_april_pos = frappe.db.sql("""
            SELECT po.name, COALESCE(po.amount_paid, 0) as paid,
                   COALESCE(inv.total_invoiced, 0) as invoiced
            FROM "tabProcurement Orders" po
            LEFT JOIN (
                SELECT document_name, SUM(invoice_amount) as total_invoiced
                FROM "tabVendor Invoices"
                WHERE document_type = 'Procurement Orders'
                AND status = 'Approved'
                GROUP BY document_name
            ) inv ON inv.document_name = po.name
            WHERE po.vendor = %s
            AND po.status NOT IN ('Cancelled', 'Merged', 'Inactive')
            AND po.creation < '2025-04-01'
        """, (v.name,), as_dict=True)

        pre_april_exposure = sum(max(flt(r.invoiced) - flt(r.paid), 0) for r in pre_april_pos)

        credit_used = pre_april_exposure + post_april_exposure
        available_credit = credit_limit - credit_used
        vendor_status = "On-Hold" if available_credit <= 0 else "Active"

        # Step 3: Update vendor fields directly (no hooks)
        frappe.db.set_value("Vendors", v.name, {
            "credit_limit": credit_limit,
            "credit_used": credit_used,
            "available_credit": available_credit,
            "vendor_status": vendor_status,
        }, update_modified=False)

    frappe.db.commit()
