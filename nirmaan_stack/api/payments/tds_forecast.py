# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Read-only: the TDS a Work Order payment request WILL have withheld, for the Request Payment dialog
(#1541). The figures come from `services/tds_forecast`, the same rule approval uses.

URL: /api/method/nirmaan_stack.api.payments.tds_forecast.forecast_work_order_tds

⚠️ READ IS CHECKED ON THE WORK ORDER, as `work_order_tds.get_work_order_tds` does: the requester may not
read `Payment TDS Deduction` or, necessarily, the vendor's rate, but may know a Work Order's tax.
"""

import frappe
from frappe.utils import cint, flt

from nirmaan_stack.api.payments.project_payments import _tier_new_payment
from nirmaan_stack.services import settlement
from nirmaan_stack.services.payment_tds import SERVICE_REQUEST_DOCTYPE
from nirmaan_stack.services.tds_forecast import forecast, request_amount_as_stored


@frappe.whitelist()
def forecast_work_order_tds(work_order: str, amount, is_gst_payment=0, cheque_amount=None) -> dict:
	"""The forecast for a payment of `amount` about to be requested on `work_order`.

	Args:
		work_order: the `Service Requests` name. Raises `frappe.PermissionError` unless the caller may read it.
		amount: the full bill as typed; taxed as the request will store it (rounded to the rupee).
		is_gst_payment: 1 for a GST payment, which is never taxed.
		cheque_amount: the cheque's amount when the request is paid by cheque, which tiers it (spec #1477).

	Returns:
		forecast: `{rate, tds, vendor_gets, borne_by}`, or None when its approval would withhold nothing.
		cut_now: the request is approved the moment it is made (below the auto-approve line, or raised by
			someone holding the approval), so its tax is withheld then too.
		asked: `{amount, is_gst_payment, cheque_amount}` as received, numbers.

	Example (10,000 on an ordinary Work Order, vendor at 2%):
		{"forecast": {"rate": 2.0, "tds": 200.0, "vendor_gets": 9800.0, "borne_by": "Vendor"}, "cut_now": True}
	"""
	frappe.has_permission(SERVICE_REQUEST_DOCTYPE, "read", doc=work_order, throw=True)
	vendor = frappe.db.get_value(SERVICE_REQUEST_DOCTYPE, work_order, "vendor")
	cheque = frappe._dict(amount=flt(cheque_amount)) if flt(cheque_amount) else None
	# The status the request would be created at, by the endpoint's own routing.
	status = _tier_new_payment(flt(amount), cheque)[1]
	return {
		"forecast": forecast(
			SERVICE_REQUEST_DOCTYPE, work_order, vendor, request_amount_as_stored(amount),
			gst_payment=bool(cint(is_gst_payment)),
		),
		"cut_now": status == settlement.STATUS_APPROVED,
		# What was asked, so a dialog still typing can tell an answer for an older figure from this one.
		"asked": {
			"amount": flt(amount),
			"is_gst_payment": cint(is_gst_payment),
			"cheque_amount": flt(cheque_amount),
		},
	}
