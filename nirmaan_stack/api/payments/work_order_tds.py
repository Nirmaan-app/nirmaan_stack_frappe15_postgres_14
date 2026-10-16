# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Read-only: a Work Order's TDS for its page: who bore the paid tax (the details card's label) and each
payment's own deduction (the transactions table's TDS column) (#1451).

URL: /api/method/nirmaan_stack.api.payments.work_order_tds.get_work_order_tds

⚠️ READ IS CHECKED ON THE WORK ORDER, NOT ON `Payment TDS Deduction`. That doctype is readable only by
the accountants, and its permissions stay so; anyone who may read the Work Order (User Permissions
included) may know its tax. The page reads the doctype nowhere. The figures come from
`services/payment_tds.work_order_tds_borne` and `work_order_deductions`.
"""

import frappe

from nirmaan_stack.services.payment_tds import (
	SERVICE_REQUEST_DOCTYPE,
	work_order_deductions,
	work_order_tds_borne,
)


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

	Example (SR-00107-001055, both payments Paid):
		{"withheld": 120.0, "company": 282.4, "kind": "part",
		 "payments": {"PAY-1": {"tds_amount": 120.0, "borne_by": "Vendor"},
		              "PAY-2": {"tds_amount": 282.4, "borne_by": "Company"}}}
	"""
	frappe.has_permission(SERVICE_REQUEST_DOCTYPE, "read", doc=work_order, throw=True)
	return {**work_order_tds_borne(work_order), "payments": work_order_deductions(work_order)}
