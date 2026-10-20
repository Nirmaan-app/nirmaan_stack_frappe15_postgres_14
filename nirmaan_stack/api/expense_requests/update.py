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
residual risk is worth stating plainly: an Admin can now correct someone else's request and then
approve it themselves (`guard_reviewer` refuses an Admin only their own request). The mitigation
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
from frappe.utils import sbool

from nirmaan_stack.api.expense_requests.access import guard_requestable, is_raiser_or_admin
from nirmaan_stack.api.expense_requests.create import (
	guard_pan_answers,
	guard_request_form,
	guard_vendor_scope,
	promote_mapped,
)
from nirmaan_stack.api.expense_requests.duplicates import find_stay_duplicates, stay_changed
from nirmaan_stack.api.expense_requests.flatten import invoice_warnings, native_invoice
from nirmaan_stack.api.expense_requests.form_snapshot import stamp_live_form
from nirmaan_stack.services.expense_statuses import REQUEST_PENDING
from nirmaan_stack.services.payees.pay_to import apply_picked_payee


def can_edit(req, user: str | None = None) -> bool:
	"""May this caller edit this request?

	Read by `get_my_expense_requests` so the row carries the answer, exactly as `can_review`
	does -- the table must never re-derive a permission the server owns.
	"""
	if req.get("status") != REQUEST_PENDING:
		return False
	return is_raiser_or_admin(req, user)


@frappe.whitelist(methods=["POST"])
def update_expense_request(
	name: str,
	expense_type: str,
	amount,
	comment: str | None = None,
	projects: str | None = None,
	vendor: str | None = None,
	source_data=None,
	payee: str | None = None,
	keep_pay_to=False,
):
	"""Rewrite a pending request in place.

	Its pay-to account (#1436): `keep_pay_to` leaves it as it is (the raiser changed something else);
	otherwise `payee` is copied in as on `create`, and no `payee` clears it. With a vendor named
	neither applies: the save copies the vendor's Payee when the vendor changes.

	IN PLACE, not supersede-and-replace: the request has no downstream reader yet -- no ledger
	row, no notification -- so there is nothing for a new id to keep consistent, and a fresh
	one would burn a naming-series number per correction. `track_changes` records what moved.
	"""
	# Locked, so an edit and a review racing cannot both land (CODING_STANDARDS § Status transitions).
	req = frappe.get_doc("Expense Request", name, for_update=True)

	if req.status != REQUEST_PENDING:
		frappe.throw(
			f"This request is already {req.status.lower()} and can no longer be edited.",
			title="Already decided",
		)
	# An Admin edits anything pending; everyone else edits only what they raised: the one rule,
	# `access.is_raiser_or_admin`, which `can_edit` (the table's pencil) asks too.
	if not is_raiser_or_admin(req):
		frappe.throw(
			"Only the person who raised a request, or an admin, may edit it.",
			frappe.PermissionError,
			title="Not your request",
		)

	# Every guard `create` applies, re-applied. A second submission is not more trustworthy
	# than the first, and the type may have changed since.
	# Visibility is checked only when the TYPE CHANGES: narrowing a type's roles must not
	# strand a request its owner already raised under it.
	guard_requestable(expense_type, check_visibility=expense_type != req.type)
	vendor = guard_vendor_scope(vendor, projects)

	if source_data is not None and not isinstance(source_data, str):
		source_data = json.dumps(source_data)

	guard_request_form(expense_type, source_data)
	# An edit is filled against the type's form as it is now, so that is the form it keeps.
	source_data = stamp_live_form(expense_type, source_data)
	source_data = guard_pan_answers(expense_type, source_data)

	promoted = promote_mapped(expense_type, source_data)

	stored_source_data = req.source_data
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
	if not sbool(keep_pay_to):
		apply_picked_payee(req, payee)
	# Elevated, like `create`: who may edit is the owner-or-Admin check above, not the DocPerm.
	req.save(ignore_permissions=True)
	frappe.db.commit()

	# A duplicate stay is re-checked only when the stay itself changed (#1504), and never refused.
	duplicates = (find_stay_duplicates(req.source_data, exclude=req.name)
	              if stay_changed(stored_source_data, req.source_data) else [])
	return {"name": req.name, "status": req.status, "projects": req.projects,
	        "warnings": invoice_warnings(native_invoice(req.source_data)),
	        "duplicates": duplicates}
