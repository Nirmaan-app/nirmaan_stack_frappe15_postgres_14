# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Raise an expense request.

URL: /api/method/nirmaan_stack.api.expense_requests.create.create_expense_request
"""

import json

import frappe

from nirmaan_stack.api.expense_requests.access import PENDING, guard_requestable
from nirmaan_stack.api.expense_requests.flatten import flat_responses, mapped_fields


@frappe.whitelist(methods=["POST"])
def create_expense_request(
	expense_type: str,
	amount,
	comment: str | None = None,
	projects: str | None = None,
	vendor: str | None = None,
	source_data=None,
):
	"""Create one `Expense Request` at `Pending Approval`.

	`projects` is passed through as given and left to the doctype's `validate`, which
	checks it against the Expense Type's own project / non_project flags. There is no
	`expense_kind` — the PRESENCE of `projects` is what decides the target ledger.

	`vendor` is PROJECT-ONLY and refused otherwise. `Non Project Expenses` has no vendor
	column, so a vendor recorded on a non-project request could never reach its ledger row —
	it would be accepted, stored, and then silently vanish at approval. Refusing is the
	honest half of that: the requester is told, rather than discovering it downstream.

	It is the NATIVE field, not the format's. A format may still promote one through
	`maps_to` (see `_promote_mapped`), which is how a type can ask for a vendor its own way;
	an explicit argument WINS over a promoted answer, because it is the one the requester
	chose on screen.

	`source_data` is the WHOLE of the request's detail and the only place it lives -- the
	type's format answers when it declares one, and the requester's typed description when
	it does not. There is deliberately NO `description` field on the doctype: one home means
	every later reader (the approval dialog, the ledger description, the flatten) looks in
	one place and none of them can disagree.
	"""
	guard_requestable(expense_type)

	vendor = (vendor or "").strip() or None
	if vendor and not projects:
		frappe.throw(
			"A vendor can only be recorded on a project expense.",
			title="Vendor needs a project",
		)

	# The client may send the answers as an object or as a JSON string; store one shape.
	if source_data is not None and not isinstance(source_data, str):
		source_data = json.dumps(source_data)

	# ⚠️ A DUPLICATE IS NEVER REFUSED HERE (owner ruling, 2026-08-20, REVERSING the 2026-08-19
	# submission block). Both surfaces WARN and neither stops anyone: the create dialog calls
	# `similar.check_new_request` while the form is being filled, and the review dialog shows
	# the same finding to the approver. A duplicate is genuinely hard to tell from a legitimate
	# repeat, so the judgement belongs to a human at both ends -- and a refusal the requester
	# disagrees with has nowhere to go.

	# A format field carrying `maps_to` names a REAL column on the request -- the answer is
	# promoted rather than left only in `source_data`, so it is queryable, referentially
	# checked by the Link, and copied to the ledger as a plain field rather than parsed out of
	# prose. Which types ask for it is the FORMAT's decision, so nothing is named here.
	promoted = _promote_mapped(expense_type, source_data)

	doc = frappe.new_doc("Expense Request")
	doc.update(
		{
			"type": expense_type,
			"projects": projects or None,
			"amount": amount,
			"comment": comment,
			"source_data": source_data or None,
			"status": PENDING,
			**promoted,
			# AFTER the promoted spread, deliberately: an explicit argument is the vendor the
			# requester picked on screen, so it outranks one a format inferred. `None` would
			# blank a promoted value, so it is only applied when actually given.
			**({"vendor": vendor} if vendor else {}),
		}
	)
	doc.insert()
	frappe.db.commit()

	return {"name": doc.name, "status": doc.status, "projects": doc.projects}


# The columns a format is allowed to write into. A CLOSED allowlist, deliberately: `maps_to`
# is read from data an admin edits, so an open one would let a format aim at any column on the
# doctype -- `status` and `amount` included.
PROMOTABLE = {"vendor"}


def _promote_mapped(expense_type: str, source_data) -> dict:
	"""`{column: value}` for every format field declaring a promotable `maps_to`.

	Silently ignores a `maps_to` naming anything outside `PROMOTABLE`, and a blank answer --
	an unfilled optional field must not write an empty Link.
	"""
	from nirmaan_stack.api.expense_requests.convert import _source_format_for

	fmt = _source_format_for(frappe._dict({"type": expense_type}))
	mapping = mapped_fields(fmt)
	if not mapping:
		return {}
	flat = flat_responses(source_data)
	out = {}
	for key, column in mapping.items():
		if column not in PROMOTABLE:
			continue
		value = (flat.get(key) or "").strip() if isinstance(flat.get(key), str) else flat.get(key)
		if value:
			out[column] = value
	return out
