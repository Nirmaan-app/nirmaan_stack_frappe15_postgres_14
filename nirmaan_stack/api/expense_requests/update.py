# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Edit a request that has not been decided yet.

URL: /api/method/nirmaan_stack.api.expense_requests.update.update_expense_request

⚠️ THE REQUESTER EDITS, THE REVIEWER DOES NOT -- and that asymmetry is the whole point.
`guard_reviewer` exists to stop someone approving their own ask; a reviewer who could rewrite
the amount and then approve it would have walked around that control by another door. So this
is OWNER-ONLY, deliberately, and an Admin is refused too: Admin is the fallback reviewer for
every unrouted category, so they are exactly the person the rule is about.

⚠️ PENDING ONLY. Once approved a ledger row exists and editing the request would leave the two
describing different money; once rejected the decision is terminal and its comment is the only
thing the requester got back. Either way the answer is to raise a new request, not to rewrite
a decided one.

Everything the create dialog collects can be changed, INCLUDING the type: the dialog already
clears the answers when the type changes, and every guard `create` applies is re-applied here
rather than trusted from the first submission.
"""

import json

import frappe

from nirmaan_stack.api.expense_requests.access import PENDING, guard_requestable
from nirmaan_stack.api.expense_requests.create import _promote_mapped, guard_vendor_scope


def can_edit(req, user: str | None = None) -> bool:
	"""May this caller edit this request?

	Read by `get_my_expense_requests` so the row carries the answer, exactly as `can_review`
	does -- the table must never re-derive a permission the server owns.
	"""
	user = user or frappe.session.user
	return req.get("status") == PENDING and req.get("owner") == user


@frappe.whitelist(methods=["POST"])
def update_expense_request(
	name: str,
	expense_type: str,
	amount,
	comment: str | None = None,
	projects: str | None = None,
	vendor: str | None = None,
	source_data=None,
):
	"""Rewrite a pending request in place.

	IN PLACE, not supersede-and-replace: the request has no downstream reader yet -- no ledger
	row, no notification -- so there is nothing for a new id to keep consistent, and a fresh
	one would burn a naming-series number per correction. `track_changes` records what moved.
	"""
	req = frappe.get_doc("Expense Request", name)

	if req.status != PENDING:
		frappe.throw(
			f"This request is already {req.status.lower()} and can no longer be edited.",
			title="Already decided",
		)
	if req.owner != frappe.session.user:
		frappe.throw(
			"Only the person who raised a request may edit it.",
			frappe.PermissionError,
			title="Not your request",
		)

	# Every guard `create` applies, re-applied. A second submission is not more trustworthy
	# than the first, and the type may have changed since.
	guard_requestable(expense_type)
	vendor = guard_vendor_scope(vendor, projects)

	if source_data is not None and not isinstance(source_data, str):
		source_data = json.dumps(source_data)

	promoted = _promote_mapped(expense_type, source_data)

	req.update(
		{
			"type": expense_type,
			"projects": projects or None,
			"amount": amount,
			"comment": comment,
			"source_data": source_data or None,
			# Cleared FIRST so a stale promotion cannot survive a type change -- the new type's
			# format may declare no `maps_to` at all, and `update` merges rather than replaces.
			"vendor": None,
			**promoted,
			**({"vendor": vendor} if vendor else {}),
		}
	)
	req.save()
	frappe.db.commit()

	return {"name": req.name, "status": req.status, "projects": req.projects}
