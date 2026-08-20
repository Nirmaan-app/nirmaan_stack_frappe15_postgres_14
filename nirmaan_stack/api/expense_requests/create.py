# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Raise an expense request.

URL: /api/method/nirmaan_stack.api.expense_requests.create.create_expense_request
"""

import json

import frappe

from nirmaan_stack.api.expense_requests.access import PENDING, guard_requestable


@frappe.whitelist(methods=["POST"])
def create_expense_request(
	expense_type: str,
	amount,
	comment: str | None = None,
	projects: str | None = None,
	source_data=None,
):
	"""Create one `Expense Request` at `Pending Approval`.

	`projects` is passed through as given and left to the doctype's `validate`, which
	checks it against the Expense Type's own project / non_project flags. There is no
	`expense_kind` — the PRESENCE of `projects` is what decides the target ledger.

	`source_data` is the WHOLE of the request's detail and the only place it lives -- the
	type's format answers when it declares one, and the requester's typed description when
	it does not. There is deliberately NO `description` field on the doctype: one home means
	every later reader (the approval dialog, the ledger description, the flatten) looks in
	one place and none of them can disagree.
	"""
	guard_requestable(expense_type)

	# The client may send the answers as an object or as a JSON string; store one shape.
	if source_data is not None and not isinstance(source_data, str):
		source_data = json.dumps(source_data)

	# ⚠️ A DUPLICATE IS NEVER REFUSED HERE (owner ruling, 2026-08-20, REVERSING the 2026-08-19
	# submission block). Both surfaces WARN and neither stops anyone: the create dialog calls
	# `similar.check_new_request` while the form is being filled, and the review dialog shows
	# the same finding to the approver. A duplicate is genuinely hard to tell from a legitimate
	# repeat, so the judgement belongs to a human at both ends -- and a refusal the requester
	# disagrees with has nowhere to go.

	doc = frappe.new_doc("Expense Request")
	doc.update(
		{
			"type": expense_type,
			"projects": projects or None,
			"amount": amount,
			"comment": comment,
			"source_data": source_data or None,
			"status": PENDING,
		}
	)
	doc.insert()
	frappe.db.commit()

	return {"name": doc.name, "status": doc.status, "projects": doc.projects}
