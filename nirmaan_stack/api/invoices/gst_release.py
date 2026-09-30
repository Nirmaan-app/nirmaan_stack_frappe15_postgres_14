# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What the invoice approval screen says about GST on a Work Order (ADR-0030).

Read-only. The rule lives in `services/work_order_gst`; this endpoint only loads its inputs.
"""

import frappe
from frappe.utils import flt

from nirmaan_stack.services.work_order_gst import (
	gst_is_on,
	gst_opened_by_approval,
	work_order_gst,
)


@frappe.whitelist()
def get_invoice_gst_release(invoice_id: str) -> dict:
	"""For a Pending invoice on a GST-on Work Order: how much GST approving it opens up.

	`applies` is False for a Purchase Order invoice, a GST-off Work Order, or an invoice that
	is no longer Pending; the screen then shows no GST line.
	"""
	invoice = frappe.get_doc("Vendor Invoices", invoice_id)
	invoice.check_permission("read")

	result = {
		"applies": False,
		"invoice_gst": flt(invoice.invoice_gst_amount),
		"gst_invoiced": 0.0,
		"work_order_gst": 0.0,
		"opens_up": 0.0,
	}
	if invoice.document_type != "Service Requests" or invoice.status != "Pending":
		return result

	wo = frappe.db.get_value(
		"Service Requests", invoice.document_name,
		["total_amount", "gst", "gst_invoiced"], as_dict=True,
	)
	if not wo or not gst_is_on(wo.gst):
		return result

	wo_gst = work_order_gst(wo.total_amount, wo.gst)
	result.update(
		applies=True,
		gst_invoiced=flt(wo.gst_invoiced),
		work_order_gst=wo_gst,
		opens_up=gst_opened_by_approval(wo.gst_invoiced, invoice.invoice_gst_amount, wo_gst),
	)
	return result
