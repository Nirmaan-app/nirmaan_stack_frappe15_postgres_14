# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Turn an approved request into a ledger row.

The mapping is a straight field-for-field copy, which is only possible because the request
deliberately reuses the ledgers' own field names (`comment`, `amount`,
`type`). There is no translation table to drift.

The structured answers reach the accountant two ways at once: flattened into `description`,
and left whole on the request (reachable through `created_expense`). The ledgers have no JSON
column and are deliberately not being changed.
"""

from decimal import Decimal

import frappe
from frappe.utils import flt, now_datetime

from nirmaan_stack.api.expense_requests.flatten import (
	NATIVE_INVOICE_SECTION,
	SEP,
	flatten_pairs,
	flatten_source_data,
	render_description_template,
	request_invoice,
	undeclared_pairs,
)
# `applicable_format` lives in `form_snapshot`; imported here too because the append-only patch
# `v3_0.freeze_expense_request_forms` reads it from this module.
from nirmaan_stack.api.expense_requests.form_snapshot import applicable_format, governing_form  # noqa: F401
from nirmaan_stack.services.expense_decision import starting_status
from nirmaan_stack.services.expense_statuses import REQUEST_APPROVED
from nirmaan_stack.services.outflow_import.ledgers import (
	NON_PROJECT_EXPENSE_DOCTYPE,
	PROJECT_EXPENSE_DOCTYPE,
)
from nirmaan_stack.services.outflow_import.settle import format_amount_for
from nirmaan_stack.services.payees.pay_to import copy_pay_to


def target_doctype(req) -> str:
	"""Which ledger this request becomes.

	The PRESENCE of `projects` is the whole rule — there is no `expense_kind` field. The
	doctype's `validate` has already checked that against the Expense Type's flags, so by
	the time we get here the answer cannot contradict the master.
	"""
	return PROJECT_EXPENSE_DOCTYPE if req.projects else NON_PROJECT_EXPENSE_DOCTYPE


def compose_description(req, source_format=None) -> str:
	"""What the accountant reads on the ledger row: the answers, then the id.

	THREE renderings, best first. A format may carry a `description_template` -- its own
	sentence with the answers filled in -- and that is what the accountant gets. Without one,
	or when a REQUIRED answer is missing (which abandons the render rather than shipping a
	half-written sentence), the labelled flatten is the fallback, unchanged.

	`source_data` is the ONLY source -- the doctype carries no `description` field, so there
	is nothing else to concatenate and nothing that can duplicate it.

	⚠️ A FORMAT-LESS REQUEST IS JOINED VALUES-ONLY, WITHOUT LABELS. Its detail is stored under
	a synthetic `detail.description` key that WE mint, not one the requester ever saw, so
	labelling it would print the word "Description:" onto the ledger as if they had written
	it. With a format the labels come from the format itself and are exactly what they filled
	in, so those ARE printed.

	The id is load-bearing -- `Non Project Expenses` carries NO link back (no vendor column,
	no request column), so without it the row loses every trace of who asked and why;
	`created_expense` only points forwards.
	"""
	prose = render_description_template(req.source_data, source_format)
	if prose:
		# An answer to a field since taken off the form (#1430's bank fields) is not in the
		# sentence, so it follows it: a request raised before keeps what was typed.
		body = SEP.join([prose] + [
			f"{label}: {value}" for label, value in undeclared_pairs(req.source_data, source_format)
		])
	elif source_format:
		# The invoice answers land in their own ledger columns, never in the prose.
		body = flatten_source_data(req.source_data, source_format,
		                           skip_sections=(NATIVE_INVOICE_SECTION,))
	else:
		body = SEP.join(
			value for _label, value
			in flatten_pairs(req.source_data, skip_sections=(NATIVE_INVOICE_SECTION,))
		)
	return " · ".join(p for p in (body, f"[{req.name}]") if p)


def target_status(req, reviewer: str | None = None) -> str:
	"""What status the ledger row WILL be born at if `reviewer` approves it, without creating it.

	The reviewer is told the outcome before they commit to it, and since 2026-08-20 that
	outcome depends on the amount -- so the dialog can no longer say "Approved" and be right.

	⚠️ IT MAKES THE LEDGER'S OWN CALL: `expense_decision.starting_status` is exactly what both
	ledgers' `validate` apply to the row this request becomes. Restating the comparison here -- or
	hardcoding a number in this module, or worse in TypeScript -- is how the screen would come to
	promise one thing while `validate` did another.

	The raiser is the REQUEST's owner -- never the reviewer calling this. The reviewer matters too:
	an Admin's review is the L1 step (#1499), so an Admin and an Accountant are told different things.
	"""
	return starting_status(req.amount, req.get("owner"), reviewer).status


def create_ledger_row(req):
	"""Write the ledger row for an approved request.

	⚠️ `status` IS DELIBERATELY NOT SET (owner ruling, 2026-08-20, REVERSING the earlier
	explicit `Approved`). The row is born at the ledger's own default, `Requested`, and each
	doctype's `validate` then applies ITS OWN rule — identical on both, and owned by
	`services/approval_tiers.py` (bands as of 16 Sep 2026):

	    0 < amount < ₹15,000    ->  auto-approved outright
	    ₹15,000 – ₹50,000       ->  stays Requested; ONE L1 signature on the ledger finishes it
	    above ₹50,000           ->  stays Requested; L1 forwards to CEO Pending, then the CEO
	    zero or negative        ->  never auto-approved; banded by SIZE like any other amount

	Setting the status here is precisely what USED to bypass that rule: `validate` returns
	early once the status is anything other than `Requested`. So the fix is a DELETION, not a
	new branch -- a request-born row is now governed by the same threshold as one keyed in
	directly, which is the point. `target_status` above previews the same call, so the review
	dialog and `validate` cannot disagree.

	⚠️ CONSEQUENCE, ACCEPTED: an expense of ₹15,000 or more is NOT payable on approval alone.
	It needs the ledger's own Approve -- and that queue held 7 stranded rows when this shipped.
	If nobody works it, a large approved request never gets paid. The old text said ₹5,000 and
	"admin-only"; the threshold moved (10,000 -> 15,000) and L1 is the Admin profile (`expense_decision.is_l1`, #1497).
	"""
	doctype = target_doctype(req)
	source_format = governing_form(req)

	values = {
		"type": req.type,
		# The ONE link between a request and its expense, and it points BACKWARDS on
		# purpose: `Non Project Expenses` rows are also raised directly, so the ledger is
		# the side that may or may not have a request -- not the other way round. It also
		# puts the Paid hook one field access away from the request it must update.
		"request_id": req.name,
		# `Project Expenses.amount` is a Data column of bare numeric strings;
		# `Non Project Expenses.amount` is a real Currency. ONE shared formatter owns that
		# split -- never cast inline.
		"amount": format_amount_for(doctype, Decimal(str(flt(req.amount)))),
		"description": compose_description(req, source_format),
		"comment": req.comment or None,
	}

	# The invoice (#1502): asked once for every type, form or not, by "Do you have the
	# invoice?", and carried under the native keys onto the Expense's own invoice columns.
	# A request raised before that, against a form slot declaring
	# `"maps_to": "invoice_attachment"`, still has its file carried from that slot.
	values.update(request_invoice(req.source_data, source_format))
	if doctype == PROJECT_EXPENSE_DOCTYPE:
		# `Non Project Expenses` has NEITHER of these columns, so both are project-only.
		# ⚠️ The vendor is copied as a plain field, exactly like the project -- it reached the
		# request as a real column (promoted from the format's `maps_to`), so nothing here has
		# to parse it back out of the answers.
		values["projects"] = req.projects
		if req.get("vendor"):
			values["vendor"] = req.vendor

	row = frappe.new_doc(doctype)
	row.update(values)
	# Who gets paid (ADR-0033, #1436), on BOTH ledgers: the request's pay-to account, exactly as the
	# reviewer saw it. The vendor's Payee is NOT read again; the save copies it only when the request
	# carried none (`services/payees/pay_to.fill_from_vendor`).
	copy_pay_to(req, row)
	row.insert(ignore_permissions=True)
	return row


def approve_request(req, reviewer: str | None = None):
	"""Approve `req` and create its Expense; return the Expense. The ONE approve path, for a
	Reviewer's approval (`review.approve_expense_request`, `reviewer` = the caller) and for approval
	on submit (`create`, Records without review: no `reviewer`, `approved_on_submit` says why).

	The request is saved FIRST, then the Expense inserted: the ledger's `validate` reads the
	request's `reviewed_by` (`approval_raiser.expense_reviewer`), because an L1 review is the L1
	step (`expense_decision.starting_status`, #1499). Never commits: the caller owns the
	transaction, and a failure in the insert must take the request's approval back with it.
	"""
	req.status = REQUEST_APPROVED
	if reviewer:
		req.reviewed_by = reviewer
		req.reviewed_on = now_datetime()
	else:
		req.approved_on_submit = 1
	req.save(ignore_permissions=True)
	return create_ledger_row(req)
