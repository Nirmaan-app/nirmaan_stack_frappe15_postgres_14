# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Read-only: who bore a Work Order's paid TDS, for the Work Order page's label (#1451).

URL: /api/method/nirmaan_stack.api.payments.work_order_tds.get_work_order_tds

⚠️ READ IS CHECKED ON THE WORK ORDER, NOT ON `Payment TDS Deduction`. That doctype is readable only by
the accountants, and its permissions stay so; anyone who may read the Work Order may know who bore its
tax. The figures come from `services/payment_tds.work_order_tds_borne`.
"""

import frappe

from nirmaan_stack.services.payment_tds import SERVICE_REQUEST_DOCTYPE, work_order_tds_borne


@frappe.whitelist()
def get_work_order_tds(work_order: str) -> dict:
	frappe.has_permission(SERVICE_REQUEST_DOCTYPE, "read", doc=work_order, throw=True)
	return work_order_tds_borne(work_order)
