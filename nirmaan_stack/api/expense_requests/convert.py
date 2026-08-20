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
from frappe.utils import flt

from nirmaan_stack.services.outflow_import.ledgers import (
	NON_PROJECT_EXPENSE_DOCTYPE,
	PROJECT_EXPENSE_DOCTYPE,
)
from nirmaan_stack.api.expense_requests.flatten import (
	SEP,
	first_mapped_attachment,
	flatten_pairs,
	flatten_source_data,
	render_description_template,
)
from nirmaan_stack.services.outflow_import.settle import format_amount_for


def target_doctype(req) -> str:
	"""Which ledger this request becomes.

	The PRESENCE of `projects` is the whole rule — there is no `expense_kind` field. The
	doctype's `validate` has already checked that against the Expense Type's flags, so by
	the time we get here the answer cannot contradict the master.
	"""
	return PROJECT_EXPENSE_DOCTYPE if req.projects else NON_PROJECT_EXPENSE_DOCTYPE


def _source_format_for(req) -> str | None:
	"""The type's format, used only to LABEL the flatten and locate the mapped attachment.

	Read live rather than from the snapshot deliberately: this is presentation, and a label
	corrected on the master should improve an approval made afterwards. The snapshot governs
	how the request RENDERS, which is a different question.
	"""
	return frappe.db.get_value("Expense Type", req.type, "source_format")


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
		body = prose
	elif source_format:
		body = flatten_source_data(req.source_data, source_format)
	else:
		body = SEP.join(value for _label, value in flatten_pairs(req.source_data))
	return " · ".join(p for p in (body, f"[{req.name}]") if p)


def target_status(req) -> str:
	"""What status the ledger row WILL be born at, without creating it.

	The reviewer is told the outcome before they commit to it, and since 2026-08-20 that
	outcome depends on the amount -- so the dialog can no longer say "Approved" and be right.

	⚠️ IT READS THE LEDGER'S OWN CONSTANT rather than repeating the number. Both doctypes
	declare an identical `AUTO_APPROVE_LIMIT`, so importing one keeps the THRESHOLD single-
	sourced; only the comparison shape is restated here, and it is three lines long. A
	hardcoded 5000 in this module -- or worse, in TypeScript -- is how the screen would come
	to promise one thing while `validate` did another.
	"""
	from nirmaan_stack.nirmaan_stack.doctype.project_expenses.project_expenses import (
		AUTO_APPROVE_LIMIT,
	)

	amount = flt(req.amount)
	return "Approved" if 0 < amount < AUTO_APPROVE_LIMIT else "Requested"


def create_ledger_row(req):
	"""Write the ledger row for an approved request.

	⚠️ `status` IS DELIBERATELY NOT SET (owner ruling, 2026-08-20, REVERSING the earlier
	explicit `Approved`). The row is born at the ledger's own default, `Requested`, and each
	doctype's `validate` then applies ITS OWN rule — identical on both:

	    0 < amount < ₹5,000   ->  auto-approved
	    ₹5,000 or more        ->  stays Requested, awaiting a second approval on the ledger
	    zero or negative      ->  stays Requested (a refund is never auto-approved)

	Setting the status here is precisely what USED to bypass that rule: `validate` returns
	early once the status is anything other than `Requested`. So the fix is a DELETION, not a
	new branch -- a request-born row is now governed by the same threshold as one keyed in
	directly, which is the point.

	⚠️ CONSEQUENCE, ACCEPTED: an expense of ₹5,000 or more is NOT payable on approval alone.
	It needs the ledger's own Approve, which is admin-only -- and that queue held 7 stranded
	rows when this shipped. If nobody works it, a large approved request never gets paid.
	"""
	doctype = target_doctype(req)
	source_format = _source_format_for(req)

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

	# Declared mapping, not convention: a format slot carrying
	# `"maps_to": "invoice_attachment"` puts its file on the ledger row. Absent => no file.
	bill = first_mapped_attachment(req.source_data, source_format)
	if bill:
		values["invoice_attachment"] = bill
	if doctype == PROJECT_EXPENSE_DOCTYPE:
		# `Non Project Expenses` has no `projects` field at all, so this is project-only.
		values["projects"] = req.projects

	row = frappe.new_doc(doctype)
	row.update(values)
	row.insert(ignore_permissions=True)
	return row
