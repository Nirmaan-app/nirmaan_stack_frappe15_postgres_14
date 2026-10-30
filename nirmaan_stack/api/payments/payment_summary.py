# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Read-only: where a PO / Work Order's money stands, for the Approve and Request Payment dialogs.

URL: /api/method/nirmaan_stack.api.payments.payment_summary.get_payment_summary

A thin endpoint: the payments are loaded by `services/order_payments.py`, and the arithmetic and
the status rules live in `services/payment_summary.py`. Nothing is written.
"""

import frappe
from frappe import _

from nirmaan_stack.services.finance import get_source_document_financials
from nirmaan_stack.services.order_payments import load_payments, work_order_summary
from nirmaan_stack.services.payment_summary import LINE_ORDER, summarise

ALLOWED = ("Procurement Orders", "Service Requests")


@frappe.whitelist()
def get_payment_summary(document_type: str, document_name: str, exclude_payment: str | None = None) -> dict:
	if document_type not in ALLOWED:
		frappe.throw(_("Not allowed for doctype {0}").format(document_type))
	frappe.has_permission(document_type, "read", doc=document_name, throw=True)

	src = frappe.get_doc(document_type, document_name)

	if document_type == "Service Requests":
		# A GST-on Work Order is measured against its total incl. GST; `limit` splits what is left
		# into Base left and GST left (ADR-0030).
		result = work_order_summary(src, exclude_payment)
		value_basis = "incl_gst" if result["limit"]["gst_on"] else "total"
	else:
		value = get_source_document_financials(src)["payable_total"]
		result = summarise(value, *load_payments(document_type, document_name), exclude_payment)
		value_basis = "incl_gst"

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
