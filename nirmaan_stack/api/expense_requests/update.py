# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Edit a request that has not been decided yet.

URL: /api/method/nirmaan_stack.api.expense_requests.update.update_expense_request

⚠️ THE REQUESTER EDITS, AND SO DOES AN ADMIN -- and the asymmetry that remains is the point.
`guard_reviewer` exists to stop someone approving their own ask; a REVIEWER who could rewrite
the amount and then approve it would have walked around that control by another door. So a
routed reviewer is still refused: seeing a request in your queue never grants a pencil.

⚠️ AMENDED (owner ruling): AN ADMIN MAY EDIT ANY PENDING REQUEST, including one they did not
raise. Admin was previously refused for exactly the reason above -- they are the fallback
reviewer for every unrouted category -- so this deliberately relaxes that control, and the
residual risk is worth stating plainly: an Admin can now correct a request and then approve
it themselves, because `guard_reviewer` lets an Admin past both of its gates. The mitigation
is evidence, not prevention -- `track_changes` records every edit with its author, and the
requester is not an Admin. If that becomes unacceptable, the fix is to bar an Admin from
REVIEWING a request they edited, not to take the pencil away again.

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

from nirmaan_stack.api.expense_requests.access import PENDING, guard_requestable, is_admin
from nirmaan_stack.api.expense_requests.create import _promote_mapped, guard_vendor_scope


def can_edit(req, user: str | None = None) -> bool:
	"""May this caller edit this request?

	Read by `get_my_expense_requests` so the row carries the answer, exactly as `can_review`
	does -- the table must never re-derive a permission the server owns.
	"""
	user = user or frappe.session.user
	if req.get("status") != PENDING:
		return False
	return req.get("owner") == user or is_admin(user)


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
	# An Admin edits anything pending; everyone else edits only what they raised. The two
	# answers live here and in `can_edit`, which the read surface hands to the table -- keep
	# them saying the same thing or the pencil appears on a row the save then refuses.
	if req.owner != frappe.session.user and not is_admin():
		frappe.throw(
			"Only the person who raised a request, or an admin, may edit it.",
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
