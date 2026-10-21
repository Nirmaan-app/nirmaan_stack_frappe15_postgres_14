# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The TDS a Work Order payment WILL have withheld when it is approved: the preview the requester and
the Work Order page show before approval (#1541, spec #1528 stories 55-61).

⚠️ "TDS" HERE IS **TAX DEDUCTED AT SOURCE**, not the Technical Data Sheet (`TDS Items`, ...).

⚠️ A FORECAST, NEVER A RECORD. Nothing here writes: the deduction is created only at approval, by
`payment_tds.record_deduction`, from the vendor's rate as it stands that day. The preview uses the same
pieces that function uses, so the two cannot disagree on the day they run:
  * the rate: `payment_tds.vendor_rate` (the vendor's rate TODAY; a rate edited between request and
    approval moves the preview with it -- owner ruling X3-A);
  * who bears it: `payment_tds.is_company_borne` (the category rule) -- Company keeps the payment whole;
  * the tax and whether one is written at all: `payment_tds.tds_on` and `is_withholdable`;
  * which payments are taxed: `DEDUCTIBLE_PARENTS`, never a GST payment.

The browser computes none of this (`frontend/src/pages/ProjectPayments/hooks/useTdsForecast.ts` asks).
"""

import frappe
from frappe.utils import flt

from nirmaan_stack.services import payment_tds, settlement

#: The payments the Work Order page previews: waiting for an approval, so no tax is taken yet. An
#: Approved / Paid payment carries its real deduction (`payment_tds.order_deductions`); a Rejected one
#: is not waiting for anything.
WAITING_STATUSES = (settlement.STATUS_REQUESTED, settlement.STATUS_CEO_PENDING)


def request_amount_as_stored(amount) -> float:
	"""The amount a new payment request stores (`create_payment_request_for_service`): the typed figure
	rounded to the rupee. Approval taxes the stored figure, so the preview of a typed amount is taken on
	this too."""
	return round(flt(amount))


def figures(gross, rate, company_borne: bool) -> dict | None:
	"""`{rate, tds, vendor_gets, borne_by}` for a deduction of `rate` % on `gross`, or None when no row
	would be written (`payment_tds.is_withholdable`). Pure. `vendor_gets` is what the payment will be
	after approval: the gross less the tax, or the whole gross when the company pays the tax on top."""
	gross = flt(gross)
	tds = payment_tds.tds_on(gross, rate)
	if not payment_tds.is_withholdable(gross, tds):
		return None
	return {
		"rate": flt(rate),
		"tds": tds,
		"vendor_gets": gross if company_borne else flt(gross - tds, 2),
		"borne_by": payment_tds.BORNE_BY_COMPANY if company_borne else payment_tds.BORNE_BY_VENDOR,
	}


def forecast(document_type: str, document_name: str, vendor: str | None, gross, *, gst_payment: bool = False) -> dict | None:
	"""The forecast (`figures`) for one payment of `gross` from `vendor` on an order, or None when its
	approval would withhold nothing: a GST payment, an order that takes no deductions, a vendor with no
	rate, or nothing to withhold from."""
	if gst_payment or (document_type or "").strip() not in payment_tds.DEDUCTIBLE_PARENTS:
		return None
	rate = payment_tds.vendor_rate(vendor)
	if rate is None:
		return None
	return figures(gross, rate, payment_tds.is_company_borne(document_type, document_name))


def waiting_payment_forecasts(work_order: str) -> dict:
	"""`{payment name: forecast}` for each of a Work Order's payments waiting for approval
	(`WAITING_STATUSES`), on its stored amount and its own vendor, as its approval will tax it. A GST
	payment, a payment already carrying a deduction, or one whose approval would withhold nothing, is
	absent. Two queries plus one rate per vendor. No permission check: the endpoint checks read on the
	Work Order."""
	rows = frappe.db.sql(
		f"""
		SELECT p.name, p.vendor, p.amount
		FROM "tab{payment_tds.PAYMENT_DOCTYPE}" p
		WHERE p.document_type = %(doctype)s AND p.document_name = %(name)s
		  AND p.status IN %(statuses)s
		  AND COALESCE(p.is_gst_payment, 0) = 0
		  AND NOT EXISTS (SELECT 1 FROM "tab{payment_tds.TDS_DOCTYPE}" d WHERE d.project_payment = p.name)
		""",
		{"doctype": payment_tds.SERVICE_REQUEST_DOCTYPE, "name": work_order, "statuses": WAITING_STATUSES},
		as_dict=True,
	)
	if not rows:
		return {}

	company_borne = payment_tds.is_company_borne(payment_tds.SERVICE_REQUEST_DOCTYPE, work_order)
	rates = {vendor: payment_tds.vendor_rate(vendor) for vendor in {row.vendor for row in rows}}
	forecasts = {}
	for row in rows:
		rate = rates[row.vendor]
		answer = figures(row.amount, rate, company_borne) if rate is not None else None
		if answer:
			forecasts[row.name] = answer
	return forecasts


def withheld_by_payment(payment_names) -> dict[str, float]:
	"""`{payment name: tax withheld from the vendor}` for the given payments that carry a counted,
	vendor-borne deduction (`payment_tds.counted_deductions_sql`), whatever their status; others are
	absent. A withheld payment's stored amount is already cut, so its full bill (a list's "Req. Amount",
	owner ruling X4-A) is its amount plus this. One query."""
	names = sorted({n for n in payment_names or () if n})
	if not names:
		return {}
	rows = frappe.db.sql(
		f"""
		SELECT c.project_payment, c.vendor_borne_tds
		FROM ({payment_tds.counted_deductions_sql()}) c
		WHERE c.project_payment IN %(names)s AND c.vendor_borne_tds > 0
		""",
		{"names": tuple(names)},
		as_dict=True,
	)
	return {row.project_payment: flt(row.vendor_borne_tds, 2) for row in rows}
