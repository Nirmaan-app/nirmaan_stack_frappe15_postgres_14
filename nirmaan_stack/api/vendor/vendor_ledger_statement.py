import json

import frappe
from frappe.utils import flt

from nirmaan_stack.api.vendor.get_vendor_po_invoices import get_po_ledger_data
from nirmaan_stack.services.vendor_ledger import build_ledger_statement, invoice_ledger_rows


@frappe.whitelist()
def get_vendor_ledger_statement(vendor_id, from_date=None, to_date=None, projects=None):
	"""Invoices-ledger statement for the "Vendor Ledger" print format.

	Same rows (get_po_ledger_data) and rule (services.vendor_ledger) as the Vendor
	page's Ledger tab. ``projects`` is a JSON array of project names, as on screen.
	"""
	frappe.has_permission("Vendors", "read", vendor_id, throw=True)
	vendor = frappe.db.get_value("Vendors", vendor_id, ["invoice_balance", "payment_balance"], as_dict=True)
	if not vendor:
		frappe.throw(f"Vendor {vendor_id} not found")

	if isinstance(projects, str):
		projects = json.loads(projects) if projects.strip() else []

	rows = invoice_ledger_rows(get_po_ledger_data(vendor_id))
	return build_ledger_statement(
		rows,
		opening_invoice=flt(vendor.invoice_balance),
		opening_payment=flt(vendor.payment_balance),
		from_date=from_date,
		to_date=to_date,
		projects=projects,
	)
