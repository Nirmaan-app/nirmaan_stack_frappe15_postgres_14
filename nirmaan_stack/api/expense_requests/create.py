# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Raise an expense request.

URL: /api/method/nirmaan_stack.api.expense_requests.create.create_expense_request
"""

import json

import frappe

from nirmaan_stack.api.expense_requests.access import guard_requestable, records_without_review
from nirmaan_stack.api.expense_requests.convert import approve_request
from nirmaan_stack.api.expense_requests.duplicates import find_stay_duplicates
from nirmaan_stack.api.expense_requests.flatten import (
	filled_against_a_form,
	flat_responses,
	invoice_warnings,
	mapped_fields,
	native_description,
	native_invoice,
)
from nirmaan_stack.api.expense_requests.form_snapshot import governing_form, stamp_live_form
from nirmaan_stack.api.expense_requests.pan_answers import clean_pan_answers
from nirmaan_stack.services.expense_statuses import REQUEST_PENDING
from nirmaan_stack.services.expense_tds import deductee_gaps, tds_rule_for
from nirmaan_stack.services.payees.pay_to import apply_picked_payee


@frappe.whitelist(methods=["POST"])
def create_expense_request(
	expense_type: str,
	amount,
	comment: str | None = None,
	projects: str | None = None,
	vendor: str | None = None,
	source_data=None,
	payee: str | None = None,
):
	"""Raise one `Expense Request`: at `Pending Approval` for a Reviewer, or approved on submit.

	A raiser who records without review (`access.records_without_review`: Admin, or a profile on
	Expense Settings) has the request approved at once: its Expense is created in the same
	transaction and the request is marked `approved_on_submit`. That skips the Reviewer, never
	the amount rule: the Expense's status comes from the ledger's own `validate`
	(`expense_decision.apply_starting_status`, the amount rule plus the Raiser's own step), so an
	HR raiser's Rs 40,000 Expense still waits at Requested for an Admin.

	Returns `{name, status, projects, created_expense, created_expense_doctype, expense_status,
	warnings, duplicates}`; the three expense fields are None when the request waits for review,
	`warnings` are the invoice warnings (#1502), and `duplicates` the other stays for the same
	person on overlapping days (`duplicates.find_stay_duplicates`, #1504). Neither ever refuses.

	`projects` is passed through as given and left to the doctype's `validate`, which
	checks it against the Expense Type's own project / non_project flags. There is no
	`expense_kind` — the PRESENCE of `projects` is what decides the target ledger.

	`vendor` is PROJECT-ONLY and refused otherwise. `Non Project Expenses` has no vendor
	column, so a vendor recorded on a non-project request could never reach its ledger row —
	it would be accepted, stored, and then silently vanish at approval. Refusing is the
	honest half of that: the requester is told, rather than discovering it downstream.

	It is the NATIVE field, not the format's. A format may still promote one through
	`maps_to` (see `promote_mapped`), which is how a type can ask for a vendor its own way;
	an explicit argument WINS over a promoted answer, because it is the one the requester
	chose on screen.

	`source_data` is the WHOLE of the request's detail and the only place it lives -- the
	type's format answers when it declares one, and the requester's typed description when
	it does not. There is deliberately NO `description` field on the doctype: one home means
	every later reader (the approval dialog, the ledger description, the flatten) looks in
	one place and none of them can disagree.

	`payee` is the Payee picked (or just added) in Who gets paid (ADR-0033, #1436): its account is
	COPIED into the request's pay-to fields, and the request keeps no reference to it. With a vendor
	named it is ignored: the save copies the vendor's Payee instead
	(`services/payees/pay_to.fill_from_vendor`), on every write path. Nothing is refused here: a
	*Required* type with no account is a screen rule.

	The invoice ("Do you have the invoice?", #1502) rides `source_data` under the native keys
	(`flatten.native_invoice`) for every type, form or not. What it lacks comes back as
	`warnings`; nothing about it is refused.
	"""
	guard_requestable(expense_type)

	vendor = guard_vendor_scope(vendor, projects)

	# The client may send the answers as an object or as a JSON string; store one shape.
	if source_data is not None and not isinstance(source_data, str):
		source_data = json.dumps(source_data)

	guard_request_form(expense_type, source_data)
	# The form these answers were filled against, frozen, so the request reads against it after
	# the type's form changes (#1503).
	source_data = stamp_live_form(expense_type, source_data)
	source_data = guard_pan_answers(expense_type, source_data)
	guard_deductee_answers(expense_type, source_data)

	# ⚠️ A DUPLICATE IS NEVER REFUSED HERE (owner ruling, 2026-08-20, REVERSING the 2026-08-19
	# submission block). A duplicate stay is RETURNED as `duplicates` (`duplicates.py`, #1504) and
	# shown to whoever approves; the review dialog also shows same-type, same-amount expenses
	# (`similar.get_similar`). A duplicate is genuinely hard to tell from a legitimate repeat, so
	# the judgement belongs to a human -- and a refusal the requester disagrees with has nowhere to go.

	# A format field carrying `maps_to` names a REAL column on the request -- the answer is
	# promoted rather than left only in `source_data`, so it is queryable, referentially
	# checked by the Link, and copied to the ledger as a plain field rather than parsed out of
	# prose. Which types ask for it is the FORMAT's decision, so nothing is named here.
	promoted = promote_mapped(expense_type, source_data)

	doc = frappe.new_doc("Expense Request")
	doc.update(
		{
			"type": expense_type,
			"projects": projects or None,
			"amount": amount,
			"comment": comment,
			"source_data": source_data or None,
			"status": REQUEST_PENDING,
			**promoted,
			# AFTER the promoted spread, deliberately: an explicit argument is the vendor the
			# requester picked on screen, so it outranks one a format inferred. `None` would
			# blank a promoted value, so it is only applied when actually given.
			**({"vendor": vendor} if vendor else {}),
		}
	)
	# After the promotion, so a vendor a format inferred is paid into its Payee just the same.
	apply_picked_payee(doc, payee)
	# Elevated, like every write the intake makes (spec #1494, #1506): who may raise is
	# `guard_requestable` above (the type's `allowed_roles`), not the request's DocPerm, so a
	# PMO or Procurement raiser needs no create right of their own.
	doc.insert(ignore_permissions=True)
	# One transaction: the request and its Expense land together or not at all.
	# Approved on submit, with no Reviewer (`approved_on_submit` says why): the same approve path a
	# Reviewer's approval takes, so the Expense's raiser is the request's owner for the Raiser's own step.
	expense = approve_request(doc) if records_without_review() else None
	frappe.db.commit()

	return {
		"name": doc.name,
		"status": doc.status,
		"projects": doc.projects,
		"created_expense": expense.name if expense else None,
		"created_expense_doctype": expense.doctype if expense else None,
		"expense_status": expense.status if expense else None,
		"warnings": invoice_warnings(native_invoice(doc.source_data)),
		"duplicates": find_stay_duplicates(doc.source_data, exclude=doc.name),
	}


def guard_vendor_scope(vendor, projects) -> str | None:
	"""Normalise the vendor and refuse one without a project.

	SHARED with `update`, because a rule enforced in one entry point and not the other is the
	same as no rule: a request could be raised clean and then edited into the refused shape.
	`Non Project Expenses` has no vendor column, so such a vendor would be stored and then
	vanish at approval -- refusing is the honest half.
	"""
	vendor = (vendor or "").strip() or None
	if vendor and not projects:
		frappe.throw(
			"A vendor can only be recorded on a project expense.",
			title="Vendor needs a project",
		)
	return vendor


def guard_request_form(expense_type: str, source_data) -> None:
	"""The answers must match the type's `source_format_enabled` switch -- when it is OFF.

	SHARED with `update`, like `guard_vendor_scope`. With the form OFF the request is a
	STANDARD one and must carry a description. Its invoice is checked by nobody: since #1502 a
	missing invoice date or number is a warning (`flatten.invoice_warnings`), never a refusal.

	⚠️ ONLY THE OFF SIDE IS ENFORCED. A form's own required answers have never been checked
	server-side (the dialog checks them), and nothing here changes that.
	"""
	row = frappe.db.get_value(
		"Expense Type", expense_type, ["source_format_enabled", "source_format"], as_dict=True
	)
	if row and row.source_format_enabled and (row.source_format or "").strip():
		return

	if filled_against_a_form(source_data):
		frappe.throw(
			f"The request form for '{expense_type}' is switched off. "
			"Reopen the dialog and fill in the standard fields.",
			title="Request form is off",
		)
	if not native_description(source_data):
		frappe.throw("A description is required.", title="Description required")


def guard_pan_answers(expense_type: str, source_data) -> str | None:
	"""`source_data` with its PAN answers uppercased; refuses one not shaped like a PAN (#1524).

	SHARED with `update`, like `guard_vendor_scope`. Run after `stamp_live_form`, so the form read
	is the one the request is filled against. The rule is `pan_answers.clean_pan_answers`.
	"""
	fmt = governing_form(frappe._dict({"type": expense_type, "source_data": source_data}))
	cleaned, problems = clean_pan_answers(source_data, fmt)
	if problems:
		frappe.throw("<br>".join(problems), title="PAN not valid")
	return cleaned


def guard_deductee_answers(expense_type: str, source_data) -> None:
	"""An Office Rent request must name the landlord and give a valid PAN (spec #1522 review, owner
	2026-10-21): the tax withheld at approval is filed against them, and an approval without them is
	refused (`services/expense_tds.refuse_without_deductee`), so the request is refused first.

	SHARED with `update`, like `guard_vendor_scope`. Run after `guard_pan_answers`. ⚠️ The ONE pair of
	form answers the server requires: every other required answer is still the dialog's to check
	(`guard_request_form`). Read under the keys the type's tax rule names (`ExpenseTdsRule`), whatever
	the form calls its fields; the rule is `expense_tds.deductee_gaps`.
	"""
	rule = tds_rule_for(expense_type)
	if rule is None:
		return
	answers = flat_responses(source_data)
	gaps = deductee_gaps(answers.get(rule.deductee_name_key), answers.get(rule.deductee_pan_key))
	if gaps:
		frappe.throw(
			f"{rule.expense_type} needs {' and '.join(gaps)}: its {rule.rate:g}% TDS is filed against the landlord.",
			title="Landlord missing",
		)


# The columns a format is allowed to write into. A CLOSED allowlist, deliberately: `maps_to`
# is read from data an admin edits, so an open one would let a format aim at any column on the
# doctype -- `status` and `amount` included.
PROMOTABLE = {"vendor"}


def promote_mapped(expense_type: str, source_data) -> dict:
	"""`{column: value}` for every format field declaring a promotable `maps_to`.

	Silently ignores a `maps_to` naming anything outside `PROMOTABLE`, and a blank answer --
	an unfilled optional field must not write an empty Link.
	"""
	fmt = governing_form(frappe._dict({"type": expense_type, "source_data": source_data}))
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
