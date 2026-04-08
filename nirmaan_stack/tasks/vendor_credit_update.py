import frappe
from frappe.utils import flt, now_datetime
from nirmaan_stack.api.vendor_credit import _compute_credit_used


def update_all_vendor_credits():
    """
    Daily cron (10 AM IST): full recalculation of credit_used for ALL vendors
    and automatic vendor_status update based on available_credit.

    Does NOT respect admin overrides — always resets status based on numbers.
    """
    vendors = frappe.get_all("Vendors", fields=["name"])

    for v in vendors:
        vendor_doc = frappe.get_doc("Vendors", v.name)
        old_credit_used = flt(vendor_doc.credit_used)

        credit_used = _compute_credit_used(vendor_doc)
        credit_limit = flt(vendor_doc.credit_limit) if vendor_doc.credit_limit is not None else 50000
        available_credit = credit_limit - credit_used

        # Status decision
        new_status = "On-Hold" if available_credit <= 0 else "Active"

        vendor_doc.credit_used = credit_used
        vendor_doc.available_credit = available_credit
        vendor_doc.vendor_status = new_status

        vendor_doc.append("credit_ledger", {
            "entry_type": "Cron Recalc",
            "delta_amount": credit_used - old_credit_used,
            "credit_used_after": credit_used,
            "available_credit_after": available_credit,
            "timestamp": now_datetime(),
            "description": f"Daily recalc. Status: {new_status}. Limit: {credit_limit}",
            "triggered_by": "System (Cron)",
        })

        vendor_doc.save(ignore_permissions=True)

    frappe.db.commit()
