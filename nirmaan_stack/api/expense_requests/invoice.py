# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Add an expense's invoice after it was raised (spec #1494, #1502).

URL: /api/method/nirmaan_stack.api.expense_requests.invoice.add_request_invoice

A raiser who answered "Do you have the invoice?" with No adds it later, from the request's
page, until its Expense is Paid. The invoice is written to BOTH records: the request's
`source_data` under the native keys (`flatten.native_invoice`), and the Expense's own invoice
columns once one exists, so Accounts sees it where they pay. Before approval only the request
holds it, and approval carries it over (`convert.create_ledger_row`).

WHO: the raiser, or an Admin. A missing invoice date or number warns and is never refused.
"""

import frappe

from nirmaan_stack.api.expense_requests.access import PAID, REJECTED, is_admin
from nirmaan_stack.api.expense_requests.flatten import (
	invoice_warnings,
	native_invoice,
	with_native_invoice,
)
from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES
from nirmaan_stack.services.outflow_import.ledgers import PAID as PAID_LEDGER_STATUS

INVOICE_FIELDS = ("invoice_attachment", "invoice_date", "invoice_ref")


def linked_expense(request: str):
	"""`{doctype, name, status}` of the Expense created from `request`, or None."""
	for doctype in EXPENSE_DOCTYPES:
		row = frappe.db.get_value(doctype, {"request_id": request}, ["name", "status"], as_dict=True)
		if row:
			return frappe._dict(doctype=doctype, name=row.name, status=row.status)
	return None


def invoice_refusal(req, expense, user: str | None = None) -> str | None:
	"""Why this caller may not add the request's invoice now, or None when they may.

	The one rule, read by the request page (`can_add_invoice`) and enforced by the call below.
	"""
	user = user or frappe.session.user
	if not (req.get("owner") == user or is_admin(user)):
		return "Only the person who raised this expense, or an Admin, can add its invoice."
	if req.get("status") == REJECTED:
		return "This expense was rejected, so it takes no invoice."
	if req.get("status") == PAID or (expense and expense.status == PAID_LEDGER_STATUS):
		return "This expense is already paid. Its invoice can no longer be added here."
	return None


@frappe.whitelist(methods=["POST"])
def add_request_invoice(name: str, invoice_attachment=None, invoice_date=None, invoice_ref=None):
	"""Set the invoice of request `name`, replacing any it had, on it and on its Expense."""
	req = frappe.get_doc("Expense Request", name)
	expense = linked_expense(name)
	refusal = invoice_refusal(req, expense)
	if refusal:
		is_theirs = req.owner == frappe.session.user or is_admin()
		frappe.throw(refusal, frappe.ValidationError if is_theirs else frappe.PermissionError,
		             title="Cannot add the invoice")

	invoice = {
		key: value.strip()
		for key, value in (("invoice_attachment", invoice_attachment),
		                   ("invoice_date", invoice_date), ("invoice_ref", invoice_ref))
		if isinstance(value, str) and value.strip()
	}
	if not invoice.get("invoice_attachment"):
		frappe.throw("Attach the invoice file.", title="Invoice file required")

	req.source_data = with_native_invoice(req.source_data, invoice)
	req.save(ignore_permissions=True)

	if expense:
		row = frappe.get_doc(expense.doctype, expense.name)
		row.update({key: invoice.get(key) for key in INVOICE_FIELDS})
		row.save(ignore_permissions=True)

	frappe.db.commit()
	return {
		"name": req.name,
		"invoice": native_invoice(req.source_data),
		"expense": expense.name if expense else None,
		"warnings": invoice_warnings(invoice),
	}
