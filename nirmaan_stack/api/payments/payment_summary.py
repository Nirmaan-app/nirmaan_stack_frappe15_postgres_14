# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Read-only: where a PO / Work Order's money stands, for the Approve and Request Payment dialogs.

URL: /api/method/nirmaan_stack.api.payments.payment_summary.get_payment_summary

A thin loader: the arithmetic and the status rules live in `services/payment_summary.py`.
Nothing is written.
"""

import frappe
from frappe import _

from nirmaan_stack.services import payment_tds
from nirmaan_stack.services.finance import get_source_document_financials
from nirmaan_stack.services.payment_summary import LINE_ORDER, summarise

ALLOWED = ("Procurement Orders", "Service Requests")


@frappe.whitelist()
def get_payment_summary(document_type: str, document_name: str, exclude_payment: str | None = None) -> dict:
	if document_type not in ALLOWED:
		frappe.throw(_("Not allowed for doctype {0}").format(document_type))
	frappe.has_permission(document_type, "read", doc=document_name, throw=True)

	src = frappe.get_doc(document_type, document_name)
	financials = get_source_document_financials(src)

	# A GST Work Order can only be requested up to its base amount (the Request Payment dialog's
	# `baseOnly`), so that is the value its balance is measured against.
	base_only = document_type == "Service Requests" and src.get("gst") == "true"
	value = financials["total_without_gst"] if base_only else financials["payable_total"]
	value_basis = "ex_gst" if base_only else ("incl_gst" if document_type == "Procurement Orders" else "total")

	payments = frappe.get_all(
		"Project Payments",
		filters={"document_type": document_type, "document_name": document_name},
		fields=["name", "amount", "status", "creation", "owner", "mode_of_payment"],
		order_by="creation desc",
		limit_page_length=0,
	)

	tds_by_payment = {}
	company_borne = False
	if document_type in payment_tds.DEDUCTIBLE_PARENTS:
		company_borne = payment_tds.is_company_borne(document_type, document_name)
		# One query for every deduction on this order, joined through the payment rather than an
		# `["in", names]` filter.
		for row in frappe.db.sql(
			"""
			SELECT t.project_payment, t.tds_amount
			FROM "tabPayment TDS Deduction" t
			JOIN "tabProject Payments" p ON p.name = t.project_payment
			WHERE p.document_type = %s AND p.document_name = %s
			""",
			(document_type, document_name),
			as_dict=True,
		):
			tds_by_payment[row.project_payment] = row.tds_amount

	result = summarise(value, payments, tds_by_payment, company_borne, exclude_payment)

	owners = sorted({p["owner"] for p in result["payments"] if p.get("owner")})
	names = {}
	if owners:
		for u in frappe.get_all(
			"Nirmaan Users", filters={"name": ["in", owners]}, fields=["name", "full_name"]
		):
			names[u.name] = u.full_name
	for p in result["payments"]:
		p["raised_by"] = p.pop("owner", None)
		p["raised_by_name"] = names.get(p["raised_by"]) or p["raised_by"]
		p["creation"] = str(p["creation"]) if p.get("creation") else None

	return {
		"document_type": document_type,
		"document_name": document_name,
		"value_basis": value_basis,
		"line_order": list(LINE_ORDER),
		**result,
	}
