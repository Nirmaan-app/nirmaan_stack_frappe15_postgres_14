# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Work Order's own GST, and how much GST an invoice approval opens up. ADR-0030; glossary:
GLOSSARY.md, *GST Invoiced* and *Work Order payment limit (GST-on)*.

PURE -- no database, no request context. Callers read `total_amount`, `gst` and `gst_invoiced`
off the Service Request and hand them here.

The Work Order's own GST caps what GST Invoiced can open up: an invoice with over-stated GST
must never let base value go out as a GST payment and escape TDS. So the figure that matters
is min(GST Invoiced, Work Order GST), and an approval opens up the amount it raises that by.
"""

from frappe.utils import flt

#: `total_amount` on a GST-on Work Order is base x (1 + GST_RATE); see ServiceRequests.calculate_total_amount.
GST_RATE = 0.18


def gst_is_on(gst_flag):
	"""The Service Requests `gst` Data field, read the way `calculate_total_amount` reads it."""
	return str(gst_flag or "").strip().lower() in ("true", "1", "yes")


def work_order_gst(total_amount, gst_flag):
	"""The GST inside a Work Order's total incl. GST: total - total / 1.18. 0 when GST is off."""
	if not gst_is_on(gst_flag):
		return 0.0
	total = flt(total_amount)
	return flt(total - total / (1 + GST_RATE), 2)


def gst_released(gst_invoiced, wo_gst):
	"""The GST that may be paid at all: min(GST Invoiced, Work Order GST)."""
	return flt(min(flt(gst_invoiced), flt(wo_gst)), 2)


def gst_opened_by_approval(gst_invoiced_before, invoice_gst, wo_gst):
	"""How much approving an invoice raises `gst_released`.

	Negative for a credit note (its GST is stored negative), 0 once the Work Order's own GST
	is fully invoiced.
	"""
	before = flt(gst_invoiced_before)
	after = before + flt(invoice_gst)
	return flt(gst_released(after, wo_gst) - gst_released(before, wo_gst), 2)
