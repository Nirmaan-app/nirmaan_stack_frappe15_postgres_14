# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The three figures on a Vendor Invoice: Invoice Base Amount, Invoice GST Amount and
Invoice Amount (the total incl. GST). ADR-0030; glossary: GLOSSARY.md, *Invoice amounts*.

PURE -- no database, no request context. `api/delivery_notes/update_invoice_data` reads the
payload and the Work Order's GST flag and hands them here.

The rules, each owned here once:

  * On upload, base and GST are both REQUIRED (`missing_split`). A 0 is a figure (a bill with
    no GST says 0); only an absent / blank / unreadable value is missing. The doctype does NOT
    mark them `reqd`, so an older invoice without the split can still be approved.
  * A credit note stores base and GST NEGATIVE, like its amount (`signed`).
  * Base + GST may differ from the total -- round-off, other charges and TCS sit in the gap --
    so a gap above SPLIT_TOLERANCE is a WARNING, never a block (`split_warnings`).
  * GST shown on a GST-off Work Order is a warning too: a vendor with no GST number charging GST.

⚠️ The columns are Currency, which Frappe creates NOT NULL DEFAULT 0, so a split that was never
entered reads back as 0 / 0. `split_warnings` treats 0 / 0 as "not entered" and does not warn.

Frontend twin: `frontend/src/utils/invoiceAmounts.ts` (same tolerance, same rules).
"""

import math

#: ₹ gap allowed between base + GST and the Invoice Amount before a warning shows.
SPLIT_TOLERANCE = 5.0

BASE_LABEL = "Invoice Base Amount"
GST_LABEL = "Invoice GST Amount"


def parse_figure(value):
	"""A figure as a float, or None when it is absent, blank or not a number."""
	if value is None or isinstance(value, bool):
		return None
	if isinstance(value, str):
		value = value.replace(",", "").strip()
		if not value:
			return None
	try:
		number = float(value)
	except (TypeError, ValueError):
		return None
	return number if math.isfinite(number) else None


def missing_split(base, gst):
	"""Labels of the split figures an upload is missing, in form order ([] when complete)."""
	return [
		label
		for label, value in ((BASE_LABEL, base), (GST_LABEL, gst))
		if parse_figure(value) is None
	]


def signed(value, is_credit_note):
	"""A split figure as stored: negative on a credit note, as given otherwise. None stays None."""
	number = parse_figure(value)
	if number is None or not is_credit_note:
		return number
	return -abs(number)


def split_warnings(amount, base, gst, gst_off_work_order=False):
	"""Soft warnings for an invoice's figures. Never blocks a save."""
	amount, base, gst = parse_figure(amount), parse_figure(base), parse_figure(gst)
	warnings = []

	entered = base is not None and gst is not None and not (base == 0 and gst == 0)
	if entered and amount is not None:
		split_total = base + gst
		gap = abs(split_total - amount)
		if gap > SPLIT_TOLERANCE:
			warnings.append(
				f"{BASE_LABEL} ₹{_fmt(base)} + {GST_LABEL} ₹{_fmt(gst)} = ₹{_fmt(split_total)}, "
				f"₹{_fmt(gap)} away from the Invoice Amount ₹{_fmt(amount)}. "
				"Check the figures; round-off, other charges or TCS can explain a gap."
			)

	if gst_off_work_order and gst is not None and gst > 0:
		warnings.append(
			f"This bill shows GST of ₹{_fmt(gst)}, but the Work Order has GST off. "
			"Check whether the vendor should be charging GST."
		)
	return warnings


def _fmt(number):
	return f"{number:,.2f}"
