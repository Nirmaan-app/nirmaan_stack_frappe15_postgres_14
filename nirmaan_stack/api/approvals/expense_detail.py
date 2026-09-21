"""
What the approver is being asked to approve, for ONE expense in the approval queue.

URL: /api/method/nirmaan_stack.api.approvals.expense_detail.get_expense_approval_detail

READ-ONLY. The queue row carries only what a table column needs (type, amount, a trimmed
description), so the Approve / Reject dialog showed an amount and nothing else (owner,
2026-09-21). This hands it the rest: the row's own fields, who really raised it, the Expense
Request behind it (labelled answers + attachments, and who approved that request), and the
same-type-and-amount expenses of the last 60 days.

⚠️ THE RAISER IS THE REQUEST'S OWNER, NOT THE ROW'S. A request-born row is inserted by the
reviewer who approved the request, so `owner` names the wrong person. One answer for that,
`approval_raiser.expense_raiser`, which is also what decides the row's approval path.

The request is read WITHOUT its own permission check on purpose: anyone who may read the
ledger row already reads the same answers flattened into its `description`.
"""

import frappe
from frappe import _
from frappe.utils import flt

from nirmaan_stack.api.expense_requests.convert import applicable_format
from nirmaan_stack.api.expense_requests.flatten import NATIVE_INVOICE_SECTION, flatten_pairs
from nirmaan_stack.api.expense_requests.similar import _scan_ledgers
from nirmaan_stack.services.approval_raiser import expense_raiser
from nirmaan_stack.services.outflow_import.ledgers import (
    EXPENSE_DOCTYPES,
    PROJECT_EXPENSE_DOCTYPE,
)


@frappe.whitelist()
def get_expense_approval_detail(doctype: str, name: str) -> dict:
	if doctype not in EXPENSE_DOCTYPES:
		frappe.throw(_("Not an expense ledger: {0}").format(doctype))
	if not frappe.has_permission(doctype, "read", name):
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	doc = frappe.get_doc(doctype, name)
	is_project = doctype == PROJECT_EXPENSE_DOCTYPE
	project = doc.get("projects") if is_project else None
	vendor = doc.get("vendor") if is_project else None

	request = _request_detail(doc.get("request_id"))
	raised_by = expense_raiser(doc)

	similar = [
		s for s in _scan_ledgers(frappe._dict(
			type=doc.type, amount=doc.amount, projects=project, name=doc.get("request_id"),
		))
		if not (s["doctype"] == doctype and s["name"] == name)
	]

	return {
		"doctype": doctype,
		"name": name,
		"status": doc.status,
		"type": doc.type,
		"amount": flt(doc.amount),
		"project": project,
		"project_name": project and frappe.db.get_value("Projects", project, "project_name"),
		"vendor": vendor,
		"vendor_name": vendor and frappe.db.get_value("Vendors", vendor, "vendor_name"),
		"description": doc.description or "",
		"comment": doc.comment or "",
		"invoice_ref": doc.get("invoice_ref") or "",
		"invoice_date": doc.get("invoice_date"),
		"invoice_attachment": doc.get("invoice_attachment") or "",
		"payment_by": doc.get("payment_by") or "",
		"raised_by": raised_by,
		"raised_on": (request or {}).get("creation") or doc.creation,
		"approval_date": doc.get("approval_date"),
		"request": request,
		"similar": similar,
		"user_names": _names([raised_by, (request or {}).get("reviewed_by")]),
	}


def _request_detail(request_id: str | None) -> dict | None:
	if not request_id or not frappe.db.exists("Expense Request", request_id):
		return None
	req = frappe.get_doc("Expense Request", request_id)
	fmt = frappe.db.get_value(
		"Expense Type", req.type, ["source_format", "source_format_enabled"], as_dict=True
	) or {}
	source_format = applicable_format(
		fmt.get("source_format"), fmt.get("source_format_enabled"), req.source_data
	)
	return {
		"name": req.name,
		"creation": req.creation,
		"reviewed_by": req.reviewed_by,
		"reviewed_on": req.reviewed_on,
		"source_data": req.source_data,
		# A standard request's invoice answers landed in the row's own invoice columns, which
		# the dialog already shows -- left out here exactly as `compose_description` leaves them.
		"detail": [
			{"label": label, "value": value}
			for label, value in flatten_pairs(
				req.source_data, source_format,
				skip_sections=() if source_format else (NATIVE_INVOICE_SECTION,),
			)
		],
	}


def _names(users: list) -> dict:
	users = [u for u in set(users) if u]
	if not users:
		return {}
	return dict(frappe.get_all(
		"Nirmaan Users", filters={"name": ["in", users]}, fields=["name", "full_name"], as_list=True,
	))
