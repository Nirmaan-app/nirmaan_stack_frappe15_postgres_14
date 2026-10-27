# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Read-only: a Work Order's TDS for its page: who bore the paid tax (the details card's label) and each
payment's own deduction (the transactions table's TDS column) (#1451); and, for any PO or Work Order,
each payment's counted deduction for the payments pop-up (#1534); and every Paid Work Order payment's
deduction for the Payment Voucher Uploads report (#1543).

URL: /api/method/nirmaan_stack.api.payments.work_order_tds.get_work_order_tds
URL: /api/method/nirmaan_stack.api.payments.work_order_tds.get_order_payment_tds
URL: /api/method/nirmaan_stack.api.payments.work_order_tds.get_paid_work_order_payment_tds

⚠️ READ IS CHECKED ON THE ORDER, NOT ON `Payment TDS Deduction`. That doctype is readable only by
the accountants, and its permissions stay so; anyone who may read the Work Order (User Permissions
included) may know its tax. The page reads the doctype nowhere. The figures come from
`services/payment_tds.work_order_tds_borne` and `order_deductions`.
"""

import frappe
from frappe import _

from nirmaan_stack.services.payment_tds import (
	SERVICE_REQUEST_DOCTYPE,
	TAX_COUNTED_PARENTS,
	order_deductions,
	paid_payment_deductions,
	work_order_tds_borne,
)
from nirmaan_stack.services.tds_forecast import waiting_payment_forecasts


@frappe.whitelist()
def get_work_order_tds(work_order: str) -> dict:
	"""A Work Order's TDS, for its page. Three queries, whatever the number of payments.

	Args:
		work_order: the `Service Requests` name. Raises `frappe.PermissionError` unless the caller may
			read it.

	Returns:
		withheld: tax on its Paid payments withheld from the vendor (`borne_by` Vendor).
		company: tax on its Paid payments the company paid on top (`borne_by` Company).
		kind: "withheld" / "company" / "part" -- who bore the paid tax; with nothing paid yet, who
			would bear the next deduction by the category rule.
		payments: `{payment name: {tds_amount, borne_by}}` for every payment of the Work Order that
			carries a deduction, whatever its status; a payment without one is absent.
		forecasts: `{payment name: {rate, tds, vendor_gets, borne_by}}` for each payment still waiting
			for approval, as its approval will tax it (`services/tds_forecast`, #1541); no row is written.

	Example (SR-00107-001055, both payments Paid):
		{"withheld": 120.0, "company": 282.4, "kind": "part",
		 "payments": {"PAY-1": {"tds_amount": 120.0, "borne_by": "Vendor"},
		              "PAY-2": {"tds_amount": 282.4, "borne_by": "Company"}}}
	"""
	frappe.has_permission(SERVICE_REQUEST_DOCTYPE, "read", doc=work_order, throw=True)
	return {
		**work_order_tds_borne(work_order),
		"payments": order_deductions(SERVICE_REQUEST_DOCTYPE, work_order),
		"forecasts": waiting_payment_forecasts(work_order),
	}


@frappe.whitelist()
def get_paid_work_order_payment_tds() -> dict:
	"""Each Paid Work Order payment's deduction, for the TDS column of Reports > WO > Payment Voucher
	Uploads (#1543, owner ruling Q31-A). The report read `Payment TDS Deduction` itself, so the column was
	blank for anyone but the accountants; now anyone who may read a Work Order sees its payments' tax.

	Read is checked on each Work Order through `frappe.get_list`, so User Permissions hold: a payment of a
	Work Order the caller may not read is absent. Raises `frappe.PermissionError` without read on Work
	Orders at all. Two queries, whatever the number of payments.

	Returns:
		`{payment name: {tds_amount, borne_by}}`; a Paid payment without a deduction is absent.
	"""
	deductions = paid_payment_deductions(SERVICE_REQUEST_DOCTYPE)
	orders = sorted({d["document_name"] for d in deductions.values()})
	if not orders:
		frappe.has_permission(SERVICE_REQUEST_DOCTYPE, "read", throw=True)
		return {}
	readable = set(
		frappe.get_list(SERVICE_REQUEST_DOCTYPE, filters={"name": ["in", orders]}, pluck="name", limit_page_length=0)
	)
	return {
		payment: {"tds_amount": d["tds_amount"], "borne_by": d["borne_by"]}
		for payment, d in deductions.items()
		if d["document_name"] in readable
	}


@frappe.whitelist()
def get_order_payment_tds(document_type: str, document_name: str) -> dict:
	"""Each payment's counted deduction on one PO or Work Order, for the payments pop-up opened from its
	Amount Paid (ADR-0034 Amendment B: a PO's recorded tax counts there too). One query.

	Args:
		document_type: "Procurement Orders" or "Service Requests"; any other is refused.
		document_name: the order. Raises `frappe.PermissionError` unless the caller may read it.

	Returns:
		payments: `{payment name: {tds_amount, borne_by}}`, as `get_work_order_tds` answers it; a payment
			without a counted deduction is absent.
	"""
	if document_type not in TAX_COUNTED_PARENTS:
		frappe.throw(_("Not allowed for doctype {0}").format(document_type))
	frappe.has_permission(document_type, "read", doc=document_name, throw=True)
	return {"payments": order_deductions(document_type, document_name)}
