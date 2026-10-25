# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""*TDS paid by company*: an Admin marks a Work Order payment's tax as paid by the company on top (#1537).

URL: /api/method/nirmaan_stack.api.payments.tds_paid_by_company.mark_tds_paid_by_company

For a payment whose tax was recorded as withheld from the vendor while the vendor was in fact paid the
full bill (the Work Orders with a negative Amount Due). No figure changes; the rules are in
`services/payment_tds.mark_tds_paid_by_company`.
"""

import frappe
from frappe import _
from frappe.utils import flt

from nirmaan_stack.services.payment_tds import PAYMENT_DOCTYPE, TDS_PAID_BY_COMPANY, mark_tds_paid_by_company as mark
from nirmaan_stack.services.role_profiles import is_nirmaan_admin


@frappe.whitelist(methods=["POST"])
def mark_tds_paid_by_company(payment: str) -> dict:
    """Mark `payment`'s TDS as paid by the company. Admin only (`frappe.PermissionError` otherwise).
    Refused for a payment with no TDS, one already company-borne, one not on a Work Order, and one
    whose tax is in a challan.

    Returns:
        deduction: the `Payment TDS Deduction` changed.
        amount_paid, amount_due: the Work Order's stored figures after the recount.

    Example (a Rs 10,000 Work Order paid Rs 10,000 with Rs 204 recorded as withheld, Due -204):
        {"deduction": "PTD-26-00412", "amount_paid": 10000.0, "amount_due": 0.0}
    """
    if not is_nirmaan_admin(frappe.session.user):
        raise frappe.PermissionError(_("Only an Admin may use {0}.").format(TDS_PAID_BY_COMPANY))
    deduction = mark(payment)
    frappe.db.commit()
    order = frappe.db.get_value(PAYMENT_DOCTYPE, payment, ["document_type", "document_name"], as_dict=True)
    figures = frappe.db.get_value(order.document_type, order.document_name, ["amount_paid", "amount_due"], as_dict=True)
    return {"deduction": deduction, "amount_paid": flt(figures.amount_paid, 2), "amount_due": flt(figures.amount_due, 2)}
