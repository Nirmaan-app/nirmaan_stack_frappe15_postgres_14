"""
What the approver is being asked to approve, for ONE expense in the approval queue.

URL: /api/method/nirmaan_stack.api.approvals.expense_detail.get_expense_approval_detail

READ-ONLY. The queue row carries only what a table column needs (type, amount, a trimmed
description), so the Approve / Reject dialog showed an amount and nothing else (owner,
2026-09-21). This hands it the rest: the row's own fields, who really raised it, the Expense
Request behind it (labelled answers + attachments, and who approved that request), the
same-type-and-amount expenses of the last 60 days, and every other stay for the same person on
overlapping days (`duplicates.find_stay_duplicates`, #1504): the spec flags a duplicate stay to
WHOEVER approves, so the Admin or CEO approving the Expense sees what the Reviewer saw.

⚠️ THE RAISER IS THE REQUEST'S OWNER. A request-born row is inserted by the reviewer who approved
the request, and rows made before 2026-10-20 still name that reviewer as `owner`. One answer for
that, `approval_raiser.expense_raiser`, which is also what decides the row's approval path.
⚠️ THE RAISER IS THE REQUEST'S OWNER, NOT THE ROW'S. A request-born row is inserted by the
reviewer who approved the request, so `owner` names the wrong person. One answer for that,
`approval_raiser.expense_raiser`. The approval path is decided by `approval_raiser.routing_raiser`,
which is the same answer except for a row created from an approved Reimbursement (its approver).

The request is read WITHOUT its own permission check on purpose: anyone who may read the
ledger row already reads the same answers flattened into its `description`.
"""

import frappe
from frappe import _
from frappe.utils import flt

from nirmaan_stack.api.expense_requests.duplicates import find_stay_duplicates
from nirmaan_stack.api.expense_requests.flatten import NATIVE_INVOICE_SECTION, detail_rows, flat_responses
from nirmaan_stack.api.expense_requests.form_snapshot import governing_form
from nirmaan_stack.api.expense_requests.similar import _scan_ledgers
from nirmaan_stack.services.approval_raiser import expense_raiser
from nirmaan_stack.services.expense_statuses import EXPENSE_CEO_PENDING, EXPENSE_REQUESTED
from nirmaan_stack.services.expense_tds import deductee_gaps, tds_rule_for, tds_split, withheld_tds_by_expense
from nirmaan_stack.services.outflow_import.ledgers import (
    EXPENSE_DOCTYPES,
    NON_PROJECT_EXPENSE_DOCTYPE,
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
	withheld = withheld_tds_by_expense([(doctype, name)]).get((doctype, name))

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
		# Set on a Porter Expense: the dialog then shows its read-only Porter section (#1450).
		"porter_order": doc.get("porter_order") or "",
		"raised_by": raised_by,
		"raised_on": (request or {}).get("creation") or doc.creation,
		"approval_date": doc.get("approval_date"),
		# The tax withheld from an Office Rent expense, read past the record's own permission (#1527,
		# `expense_tds.withheld_tds_by_expense`); None before approval, when the dialog forecasts from `amount`.
		"withheld_tds": withheld,
		# An Office Rent expense its approval would refuse for want of the landlord's name or PAN: the
		# dialog warns and offers only Reject (spec #1522 review batch 2).
		"deductee_missing": _deductee_missing(doc, request, withheld),
		"request": request,
		"similar": similar,
		# The request itself is never its own match. Like `similar`, it names other people's
		# expenses: an approver weighs exactly those.
		"stays": find_stay_duplicates(request["source_data"], exclude=request["name"]) if request else [],
		"user_names": _names([raised_by, (request or {}).get("reviewed_by")]),
	}


def _request_detail(request_id: str | None) -> dict | None:
	if not request_id or not frappe.db.exists("Expense Request", request_id):
		return None
	req = frappe.get_doc("Expense Request", request_id)
	source_format = governing_form(req)
	return {
		"name": req.name,
		"creation": req.creation,
		"reviewed_by": req.reviewed_by,
		"reviewed_on": req.reviewed_on,
		"source_data": req.source_data,
		# A standard request's invoice answers landed in the row's own invoice columns, which
		# the dialog already shows -- left out here exactly as `compose_description` leaves them.
		"detail": detail_rows(req.source_data, source_format,
		                      skip_sections=() if source_format else (NATIVE_INVOICE_SECTION,)),
	}


def _deductee_missing(doc, request: dict | None, withheld: dict | None) -> bool:
	"""Would approving this expense meet `expense_tds.refuse_without_deductee`? True for an Office Rent
	Non-Project Expense not yet approved, with no tax record and a rent to withhold from, whose request
	(or the lack of one) does not name the landlord with a valid PAN. The same reading as the hook
	(`controllers/expense_tds._deductee`), so the warning and the refusal agree.

	At CEO Pending and at Requested alike: an L1 step that would only forward it to the CEO is not
	refused, but it moves an expense no one can finish.
	"""
	rule = tds_rule_for(doc.get("type"))
	if (rule is None or withheld or doc.doctype != NON_PROJECT_EXPENSE_DOCTYPE
	        or doc.get("status") not in (EXPENSE_REQUESTED, EXPENSE_CEO_PENDING)
	        or tds_split(doc.get("type"), doc.get("amount")) is None):
		return False
	answers = flat_responses(request["source_data"]) if request else {}
	return bool(deductee_gaps(*rule.deductee_in(answers)))


def _names(users: list) -> dict:
	users = [u for u in set(users) if u]
	if not users:
		return {}
	return dict(frappe.get_all(
		"Nirmaan Users", filters={"name": ["in", users]}, fields=["name", "full_name"], as_list=True,
	))
