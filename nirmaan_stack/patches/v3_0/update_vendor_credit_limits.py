import frappe
from frappe.utils import flt, now_datetime
from nirmaan_stack.api.vendor_credit import _compute_credit_used


def execute():
    """Raise credit_limit to 50000 for all vendors below 50000. Recalculate status."""
    vendors = frappe.get_all("Vendors", fields=["name", "credit_limit"])

    for v in vendors:
        if flt(v.credit_limit) >= 50000:
            continue

        vendor_doc = frappe.get_doc("Vendors", v.name)
        old_limit = flt(vendor_doc.credit_limit)

        vendor_doc.credit_limit = 50000
        credit_used = _compute_credit_used(vendor_doc)
        available_credit = 50000 - credit_used
        vendor_status = "On-Hold" if available_credit <= 0 else "Active"

        vendor_doc.credit_used = credit_used
        vendor_doc.available_credit = available_credit
        vendor_doc.vendor_status = vendor_status

        vendor_doc.append("credit_ledger", {
            "entry_type": "Credit Limit Updated",
            "delta_amount": 0,
            "credit_used_after": credit_used,
            "available_credit_after": available_credit,
            "timestamp": now_datetime(),
            "description": f"Migration: credit limit raised from {old_limit} to 50000. Status: {vendor_status}",
            "triggered_by": "System (Migration)",
        })

        vendor_doc.save(ignore_permissions=True)

    frappe.db.commit()
