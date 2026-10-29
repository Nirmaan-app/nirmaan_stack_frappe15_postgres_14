# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Work Order payment limit: how much may still be requested, as base and as GST. ADR-0030;
glossary: GLOSSARY.md, *Work Order payment limit*.

PURE -- no database, no request context. `api/payments/payment_summary.py` loads the Work Order and
its payments and hands them here; the payment-request endpoint and the payment summary both read
the result, and the Request Payment dialog shows it without re-deriving anything.

    Base left  = max(0, base value - base payments)
    GST left   = max(0, min(GST Invoiced, Work Order GST) - GST payments)
    Total left = total incl. GST - all payments          (may go negative on an over-paid order)

A request is allowed iff its amount is within the chosen part's left AND within total left, each
with the ₹10 tolerance the request cap has always had, and the Work Order passes the INVOICE CHECK
(below). So the most one part may take is its CAP,
min(part left, total left), and `caps` says which of the two binds: the dialogs show that figure
and that reason as given, and never combine the two themselves.

Payments count exactly as `services/payment_summary` counts them: GROSS of the TDS withheld from them
(a deduction the company bore on top added nothing back), at every status the request cap counts,
Rejected included until deleted.

THE INVOICE CHECK (owner, 2026-10-17, #1488; GLOSSARY.md, *Invoice check*):

    raised - Total Amount Invoiced < ₹100

Raised is every payment that is not Rejected, base and GST alike, gross of TDS. The check looks at
the Work Order BEFORE the new payment, so a first payment always passes and the payment itself may
be any size the limit allows. Only the `Administrator` system account skips it (owner, 2026-10-29;
Admin-profile users and the CEO no longer do): the caller says so, since who is raising is not a figure.
A negative amount is refused for everyone (refunds are Vendor Refunds).

⚠️ THE `min(..., Work Order GST)` IS THE TDS GUARD, NOT A TIDY-UP. The invoice cap checks only an
invoice's total, so an invoice with over-stated GST would otherwise let base value go out as a GST
payment, which is never taxed. A GST-off Work Order has no Work Order GST, so its GST left is always 0.
"""

from frappe.utils import cint, flt

from nirmaan_stack.services.payment_summary import is_counted, summarise
from nirmaan_stack.services.settlement import STATUS_REJECTED
from nirmaan_stack.services.work_order_gst import gst_is_on, gst_released, work_order_gst

#: The request cap's rounding tolerance, in rupees.
TOLERANCE = 10

#: How far raised money may run above Total Amount Invoiced before a new payment waits for invoices.
INVOICE_CHECK_MARGIN = 100


def work_order_limit(
	total_amount,
	gst_flag,
	gst_invoiced,
	payments,
	tds_by_payment=None,
	exclude_payment=None,
	amount_invoiced=0,
) -> dict:
	"""The payment summary of a Work Order, measured against its total incl. GST, plus `limit`.

	`payments`: dicts with `name`, `amount`, `status`, `is_gst_payment`. `tds_by_payment`: the tax
	withheld from each, as in `summarise`. `exclude_payment` is the payment being approved, as there.
	`amount_invoiced` is the Work Order's Total Amount Invoiced, for the invoice check.
	"""
	total = round(flt(total_amount), 2)
	summary = summarise(total, payments, tds_by_payment, exclude_payment)

	base_paid = gst_paid = raised = 0.0
	for p in summary["payments"]:
		if not is_counted(p["status"]):
			continue
		if p["status"] != STATUS_REJECTED:
			raised += p["gross_amount"]
		if cint(p.get("is_gst_payment")):
			gst_paid += p["gross_amount"]
		else:
			base_paid += p["gross_amount"]

	wo_gst = work_order_gst(total, gst_flag)
	base_value = round(total - wo_gst, 2)
	released = gst_released(gst_invoiced, wo_gst)
	base_left = round(max(0.0, base_value - base_paid), 2)
	gst_left = round(max(0.0, released - gst_paid), 2)
	total_left = summary["left"]

	summary["limit"] = {
		"gst_on": gst_is_on(gst_flag),
		"base_value": base_value,
		"work_order_gst": wo_gst,
		"gst_invoiced": round(flt(gst_invoiced), 2),
		"gst_released": released,
		"base_paid": round(base_paid, 2),
		"gst_paid": round(gst_paid, 2),
		"base_left": base_left,
		"gst_left": gst_left,
		"total_left": total_left,
		"caps": {"base": part_cap(base_left, total_left), "gst": part_cap(gst_left, total_left)},
		"invoice_check": invoice_check(raised, amount_invoiced),
	}
	return summary


def invoice_check(raised, amount_invoiced) -> dict:
	"""`{raised, invoiced, passes}`: may a new payment be raised on a Work Order with these figures?"""
	raised, invoiced = round(flt(raised), 2), round(flt(amount_invoiced), 2)
	return {"raised": raised, "invoiced": invoiced, "passes": raised - invoiced < INVOICE_CHECK_MARGIN}


def part_cap(part_left, total_left) -> dict:
	"""The most one part may take: `{"cap": min(part left, total left) floored at 0, "binds": ...}`.

	`binds` is "total" when total left is the smaller figure (an old Work Order paid past its base
	value), else "part".
	"""
	if flt(total_left) < flt(part_left):
		return {"cap": round(max(0.0, flt(total_left)), 2), "binds": "total"}
	return {"cap": round(max(0.0, flt(part_left)), 2), "binds": "part"}


def request_refusal(limit: dict, amount, gst_payment: bool, check_invoices: bool = True) -> dict | None:
	"""Why a request of `amount` breaks the limit, or None when it is allowed.

	Returns `{"part": "negative" | "no_gst" | "base" | "gst" | "total", "left": <the figure it broke>}`,
	or `{"part": "invoice", "raised", "invoiced"}` when the Work Order fails the invoice check.
	`check_invoices` is False for a raiser who skips that check (only `Administrator`). A negative
	amount is refused for everyone: money coming back is a Vendor Refund (#1488).
	"""
	amount = flt(amount)
	if amount < 0:
		return {"part": "negative", "left": 0}
	if gst_payment and not limit["gst_on"]:
		return {"part": "no_gst", "left": 0}
	check = limit["invoice_check"]
	if check_invoices and not check["passes"]:
		return {"part": "invoice", "raised": check["raised"], "invoiced": check["invoiced"]}
	part, part_left = ("gst", limit["gst_left"]) if gst_payment else ("base", limit["base_left"])
	if amount > part_left + TOLERANCE:
		return {"part": part, "left": part_left}
	if amount > limit["total_left"] + TOLERANCE:
		return {"part": "total", "left": limit["total_left"]}
	return None
