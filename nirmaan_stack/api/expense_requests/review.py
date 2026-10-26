# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Approve or reject an expense request.

URLs:
  /api/method/nirmaan_stack.api.expense_requests.review.approve_expense_request
  /api/method/nirmaan_stack.api.expense_requests.review.reject_expense_request
"""

import frappe
from frappe.utils import now_datetime

from nirmaan_stack.api.expense_requests.access import guard_reviewer
from nirmaan_stack.api.expense_requests.convert import approve_request
from nirmaan_stack.api.expense_requests.create import guard_deductee_answers
from nirmaan_stack.integrations.controllers.expense_request_notify import notify_decided
from nirmaan_stack.services.expense_statuses import REQUEST_PENDING, REQUEST_REJECTED


def _load_pending(name: str):
	"""Fetch the request and refuse anything already decided.

	A second approval would mint a SECOND ledger row for one ask, so this is a money guard,
	not tidiness. Read inside a row lock, so two reviewers racing cannot both pass it
	(CODING_STANDARDS § Status transitions).
	"""
	req = frappe.get_doc("Expense Request", name, for_update=True)
	if req.status != REQUEST_PENDING:
		frappe.throw(f"This request is already {req.status.lower()}.", title="Already decided")
	return req


@frappe.whitelist(methods=["POST"])
def approve_expense_request(name: str):
	"""Approve a request and create its ledger row.

	Atomic: the row and the request's own state land together or not at all. Without the
	savepoint, a failure between the two writes leaves an approved expense with nothing
	pointing at it — money in the ledger that nothing explains.
	"""
	req = _load_pending(name)
	guard_reviewer(req)
	# An Office Rent request without the landlord's name and PAN is refused here, at any amount, before
	# anything is written (spec #1522 review batch 2): approved, it would become an Expense that no later
	# step could approve (`expense_tds.refuse_without_deductee`). It stays Pending Approval, and its
	# raiser can edit it; the edit requires both (`create.guard_deductee_answers`).
	guard_deductee_answers(req.type, req.source_data)

	savepoint = f"exr_approve_{frappe.generate_hash(length=10)}"
	frappe.db.savepoint(savepoint)
	try:
		# The one approve path (`convert.approve_request`), shared with approval on submit.
		row = approve_request(req, reviewer=frappe.session.user)
	except Exception:
		frappe.db.rollback(save_point=savepoint)
		raise

	frappe.db.commit()
	# NO NOTIFICATION HERE, deliberately: the requester hears about a rejection and about the
	# payment, never about the approval in between. See `expense_request_notify`.

	return {
		"name": req.name,
		"status": req.status,
		"created_expense": row.name,
		"created_expense_doctype": row.doctype,
	}


@frappe.whitelist(methods=["POST"])
def reject_expense_request(name: str, comment: str):
	"""Reject a request. Terminal, and the reason is mandatory.

	The comment is the only thing the requester gets back, so a blank one makes the decision
	unappealable. Enforced here AND in the doctype's `validate`, because this endpoint is not
	the only way a row can reach `Rejected`.
	"""
	if not (comment or "").strip():
		frappe.throw("A rejection needs a reason.", title="Comment required")

	req = _load_pending(name)
	guard_reviewer(req)

	req.status = REQUEST_REJECTED
	req.review_comment = comment.strip()
	req.reviewed_by = frappe.session.user
	req.reviewed_on = now_datetime()
	req.save(ignore_permissions=True)
	frappe.db.commit()
	notify_decided(req, REQUEST_REJECTED)

	return {"name": req.name, "status": req.status}
