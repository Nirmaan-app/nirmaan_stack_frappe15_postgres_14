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

#: How a refusal names the action: the request endpoint asks for money, an insert anywhere else pays it,
#: and an edit of a saved payment raises it (#1536).
PaymentAction = Literal["request", "pay", "edit"]
_VERBS: dict[str, tuple[str, str]] = {
	"request": ("request", "requested"),
	"pay": ("pay", "made"),
	"edit": ("raise this payment to", "made"),
}


def load_payments(document_type: str, document_name: str):
	"""`(payments, tds_by_payment)` for one PO / Work Order, as the summary counts them.

	`tds_by_payment` holds only the tax WITHHELD FROM THE VENDOR (`borne_by` = Vendor): that tax was cut
	out of the payment's `amount`, so the summary adds it back to count what was requested. A
	deduction the company bore left its payment whole and is not added (#1451). Read off each row, so
	a Work Order with both kinds counts each payment right. A PO's recorded tax is added the same way
	once its payment is netted (ADR-0034 Amendment B); one still stored gross has none to add.
	"""
	payments = frappe.get_all(
		"Project Payments",
		filters={"document_type": document_type, "document_name": document_name},
		fields=["name", "amount", "status", "creation", "owner", "mode_of_payment", "is_gst_payment"],
		order_by="creation desc",
		limit_page_length=0,
	)

	# The order's counted deductions (`payment_tds.order_deductions`, a PO's too, ADR-0034 Amendment B), in
	# one query joined through the payment rather than an `["in", names]` filter.
	tds_by_payment = {
		payment: row["tds_amount"]
		for payment, row in payment_tds.order_deductions(document_type, document_name).items()
		if row["borne_by"] != payment_tds.BORNE_BY_COMPANY
	}
	return payments, tds_by_payment


def work_order_summary(sr, exclude_payment: str | None = None) -> dict:
	"""The payment summary of a Work Order plus its payment limit (`services/work_order_payment_limit`)."""
	payments, tds_by_payment = load_payments(sr.doctype, sr.name)
	return work_order_limit(
		sr.get("total_amount"), sr.get("gst"), sr.get("gst_invoiced"),
		payments, tds_by_payment, exclude_payment, sr.get("amount_invoiced"),
	)


def assert_within_work_order_limit(
	sr, amount, gst_payment: bool, action: PaymentAction = "request", exclude_payment: str | None = None
) -> None:
	"""Refuse `amount` on Work Order `sr` when it breaks the Work Order payment limit (ADR-0030), when
	the Work Order fails the invoice check, or when it is negative (#1488). Nobody skips the invoice
	check, not even the `Administrator` account (owner, 2026-10-30).

	Payments count GROSS of TDS, as the dialogs and the payment summary count them. Three callers:
	`create_payment_request_for_service` (`action="request"`), the `Project Payments` insert
	validation (`action="pay"`), which covers the Accountant's paid entry and any Desk / REST insert,
	and the same validation on an edit that raises a saved payment (`action="edit"`, #1536), which
	passes that payment as `exclude_payment` and its new gross as `amount`: the edit is measured as
	if the payment were requested anew at its new figure.
	"""
	limit = work_order_summary(sr, exclude_payment)["limit"]
	refusal = request_refusal(limit, amount, gst_payment)
	if not refusal:
		return
	act, done = _VERBS[action]
	if refusal["part"] == "negative":
		frappe.throw(_("A Work Order payment cannot be negative. Record money coming back as a Vendor Refund."))
	if refusal["part"] == "invoice":
		frappe.throw(_("{0} raised is more than {1} in approved invoices. Get an invoice approved before raising another payment.").format(
			frappe.format_value(refusal["raised"], "Currency"), frappe.format_value(refusal["invoiced"], "Currency")))
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
