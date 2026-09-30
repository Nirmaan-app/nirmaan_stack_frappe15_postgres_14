# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Work Order payment limit: how much may still be requested, as base and as GST. ADR-0030;
glossary: CONTEXT.md, *Work Order payment limit*.

PURE -- no database, no request context. `api/payments/payment_summary.py` loads the Work Order and
its payments and hands them here; the payment-request endpoint and the payment summary both read
the result, and the Request Payment dialog shows it without re-deriving anything.

    Base left  = max(0, base value - base payments)
    GST left   = max(0, min(GST Invoiced, Work Order GST) - GST payments)
    Total left = total incl. GST - all payments          (may go negative on an over-paid order)

A request is allowed iff its amount is within the chosen part's left AND within total left, each
with the ₹10 tolerance the request cap has always had.

Payments count exactly as `services/payment_summary` counts them: GROSS of TDS (except on a
company-borne Work Order), at every status the request cap counts, Rejected included until deleted.

⚠️ THE `min(..., Work Order GST)` IS THE TDS GUARD, NOT A TIDY-UP. The invoice cap checks only an
invoice's total, so an invoice with over-stated GST would otherwise let base value go out as a GST
payment, which is never taxed. A GST-off Work Order has no Work Order GST, so its GST left is always 0.
"""

from frappe.utils import cint, flt

from nirmaan_stack.services.payment_summary import is_counted, summarise
from nirmaan_stack.services.work_order_gst import gst_is_on, work_order_gst

#: The request cap's rounding tolerance, in rupees.
TOLERANCE = 10


def work_order_limit(
	total_amount,
	gst_flag,
	gst_invoiced,
	payments,
	tds_by_payment=None,
	company_borne=False,
	exclude_payment=None,
) -> dict:
	"""The payment summary of a Work Order, measured against its total incl. GST, plus `limit`.

	`payments`: dicts with `name`, `amount`, `status`, `is_gst_payment`. `exclude_payment` is the
	payment being approved, as in `summarise`.
	"""
	total = round(flt(total_amount), 2)
	summary = summarise(total, payments, tds_by_payment, company_borne, exclude_payment)

	base_paid = gst_paid = 0.0
	for p in summary["payments"]:
		if not is_counted(p["status"]):
			continue
		if cint(p.get("is_gst_payment")):
			gst_paid += p["gross_amount"]
		else:
			base_paid += p["gross_amount"]

	wo_gst = work_order_gst(total, gst_flag)
	base_value = round(total - wo_gst, 2)
	gst_released = round(min(flt(gst_invoiced), wo_gst), 2)

	summary["limit"] = {
		"gst_on": gst_is_on(gst_flag),
		"base_value": base_value,
		"work_order_gst": wo_gst,
		"gst_invoiced": round(flt(gst_invoiced), 2),
		"gst_released": gst_released,
		"base_paid": round(base_paid, 2),
		"gst_paid": round(gst_paid, 2),
		"base_left": round(max(0.0, base_value - base_paid), 2),
		"gst_left": round(max(0.0, gst_released - gst_paid), 2),
		"total_left": summary["left"],
	}
	return summary


def request_refusal(limit: dict, amount, gst_payment: bool) -> dict | None:
	"""Why a request of `amount` breaks the limit, or None when it is allowed.

	Returns `{"part": "no_gst" | "base" | "gst" | "total", "left": <the figure it broke>}`.
	"""
	amount = flt(amount)
	if gst_payment and not limit["gst_on"]:
		return {"part": "no_gst", "left": 0}
	part, part_left = ("gst", limit["gst_left"]) if gst_payment else ("base", limit["base_left"])
	if amount > part_left + TOLERANCE:
		return {"part": part, "left": part_left}
	if amount > limit["total_left"] + TOLERANCE:
		return {"part": "total", "left": limit["total_left"]}
	return None
