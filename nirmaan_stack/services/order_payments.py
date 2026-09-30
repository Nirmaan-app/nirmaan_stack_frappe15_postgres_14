# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Loads a PO / Work Order's payments, and ENFORCES the Work Order payment limit (ADR-0030).

Reads the database; no request context. The arithmetic lives in the pure
`services/payment_summary.py` and `services/work_order_payment_limit.py`; this module only feeds
them. Callers: `api/payments/payment_summary.get_payment_summary` (the dialogs' figures),
`api/payments/project_payments.create_payment_request_for_service` and the `Project Payments`
insert validation (`integrations/controllers/project_payments.py`), so the figure the dialogs show
and the figure the server refuses on come from one load and one calculation.
"""

from typing import Literal

import frappe
from frappe import _

from nirmaan_stack.services import payment_tds
from nirmaan_stack.services.work_order_payment_limit import request_refusal, work_order_limit

#: How a refusal names the action: the request endpoint asks for money, every other path pays it.
PaymentAction = Literal["request", "pay"]
_VERBS: dict[str, tuple[str, str]] = {"request": ("request", "requested"), "pay": ("pay", "made")}


def load_payments(document_type: str, document_name: str):
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
	"""The payment summary of a Work Order plus its payment limit (`services/work_order_payment_limit`)."""
	payments, tds_by_payment, company_borne = load_payments(sr.doctype, sr.name)
	return work_order_limit(
		sr.get("total_amount"), sr.get("gst"), sr.get("gst_invoiced"),
		payments, tds_by_payment, company_borne, exclude_payment,
	)


def assert_within_work_order_limit(sr, amount, gst_payment: bool, action: PaymentAction = "request") -> None:
	"""Refuse `amount` on Work Order `sr` when it breaks the Work Order payment limit (ADR-0030).

	Payments count GROSS of TDS, as the dialogs and the payment summary count them. Two callers:
	`create_payment_request_for_service` (`action="request"`) and the `Project Payments` insert
	validation (`action="pay"`), which covers the Accountant's paid entry and any Desk / REST insert.
	"""
	limit = work_order_summary(sr)["limit"]
	refusal = request_refusal(limit, amount, gst_payment)
	if not refusal:
		return
	act, done = _VERBS[action]
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
