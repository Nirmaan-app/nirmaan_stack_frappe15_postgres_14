# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Read-only: where a PO / Work Order's money stands, for the Approve and Request Payment dialogs.

URL: /api/method/nirmaan_stack.api.payments.payment_summary.get_payment_summary

A thin loader: the arithmetic and the status rules live in `services/payment_summary.py`.
Nothing is written. `assert_within_work_order_limit` is the one place the Work Order payment
limit is ENFORCED, for every path that adds a Work Order payment.
"""

import frappe
from frappe import _

from nirmaan_stack.services import payment_tds
from nirmaan_stack.services.finance import get_source_document_financials
from nirmaan_stack.services.payment_summary import LINE_ORDER, summarise
from nirmaan_stack.services.work_order_payment_limit import request_refusal, work_order_limit

ALLOWED = ("Procurement Orders", "Service Requests")


def _load_payments(document_type: str, document_name: str):
	"""`(payments, tds_by_payment, company_borne)` for one PO / Work Order, as the summary counts them."""
	payments = frappe.get_all(
		"Project Payments",
		filters={"document_type": document_type, "document_name": document_name},
		fields=["name", "amount", "status", "creation", "owner", "mode_of_payment", "is_gst_payment"],
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
	return payments, tds_by_payment, company_borne


def work_order_summary(sr, exclude_payment: str | None = None) -> dict:
	"""The payment summary of a Work Order plus its payment limit (`services/work_order_payment_limit`).

	Shared by `get_payment_summary` and `assert_within_work_order_limit`, so the figure the dialogs
	show and the figure the server refuses on come from one load and one calculation.
	"""
	payments, tds_by_payment, company_borne = _load_payments(sr.doctype, sr.name)
	return work_order_limit(
		sr.get("total_amount"), sr.get("gst"), sr.get("gst_invoiced"),
		payments, tds_by_payment, company_borne, exclude_payment,
	)


#: How a refusal names the action: the request endpoint asks for money, every other path pays it.
_VERBS = {"request": ("request", "requested"), "pay": ("pay", "made")}


def assert_within_work_order_limit(sr, amount, gst_payment: bool, verb: str = "request") -> None:
	"""Refuse `amount` on Work Order `sr` when it breaks the Work Order payment limit (ADR-0030).

	Payments count GROSS of TDS, as the dialogs and the payment summary count them. Two callers:
	`create_payment_request_for_service` (`verb="request"`) and the `Project Payments` insert
	validation (`verb="pay"`), which covers the Accountant's paid entry and any Desk / REST insert.
	"""
	limit = work_order_summary(sr)["limit"]
	refusal = request_refusal(limit, amount, gst_payment)
	if not refusal:
		return
	act, done = _VERBS[verb]
	if refusal["part"] == "no_gst":
		frappe.throw(_("This Work Order has no GST, so a GST payment cannot be {0} on it.").format(done))

	left = frappe.format_value(max(refusal["left"], 0), "Currency")
	if refusal["part"] == "base":
		frappe.throw(_("Maximum amount you can {0} is {1} (Base left)").format(act, left))
	if refusal["part"] == "gst":
		reason = ""
		if limit["gst_released"] <= 0:
			reason = " " + _("No GST is released yet: approve an invoice carrying GST first.")
		frappe.throw(_("Maximum amount you can {0} is {1} (GST left).").format(act, left) + reason)
	frappe.throw(_("Maximum amount you can {0} is {1} (total left, incl. GST)").format(act, left))


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
		result = summarise(value, *_load_payments(document_type, document_name), exclude_payment)
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
