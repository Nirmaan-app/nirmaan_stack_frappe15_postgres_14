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

#: The two values the Service Requests `gst` Data field is written with.
GST_ON = "true"
GST_OFF = "false"


def gst_is_on(gst_flag):
	"""The Service Requests `gst` Data field, read the way `calculate_total_amount` reads it."""
	return str(gst_flag or "").strip().lower() in ("true", "1", "yes")


def gst_flag_for_vendor(vendor_gst):
	"""The GST flag a Work Order should carry for its vendor: on exactly when the vendor has a GST
	number; blank or whitespace counts as none (ADR-0028 Amendment A; GLOSSARY *GST flag*)."""
	return GST_ON if str(vendor_gst or "").strip() else GST_OFF


def work_order_total(sub_total, gst_flag):
	"""A Work Order's total from its items' value: + GST_RATE when GST is on."""
	sub_total = flt(sub_total)
	return sub_total + sub_total * GST_RATE if gst_is_on(gst_flag) else sub_total


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
