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
	NATIVE_INVOICE_SECTION,
	SEP,
	filled_against_a_form,
	first_mapped_attachment,
	flatten_pairs,
	flatten_source_data,
	native_invoice,
	render_description_template,
)
from nirmaan_stack.services.outflow_import.settle import format_amount_for
from nirmaan_stack.services.approval_raiser import raiser_level
from nirmaan_stack.services.approval_tiers import TIER_L2_ABOVE_EXPENSES, initial_status_for_raiser


def target_doctype(req) -> str:
	"""Which ledger this request becomes.

	The PRESENCE of `projects` is the whole rule — there is no `expense_kind` field. The
	doctype's `validate` has already checked that against the Expense Type's flags, so by
	the time we get here the answer cannot contradict the master.
	"""
	return PROJECT_EXPENSE_DOCTYPE if req.projects else NON_PROJECT_EXPENSE_DOCTYPE


def applicable_format(source_format, form_enabled, source_data) -> str | None:
	"""The format that governs a request, or None when it is a STANDARD request.

	The type's `source_format_enabled` switch decides -- EXCEPT for a request already filled
	against the form (`templateId` in its answers): that one keeps its form even if the switch
	was turned off after it was raised, or its answers would convert unlabelled.

	ONE rule, shared by the conversion, the promotion at create and the reviewer's detail
	list, so the approval screen and the ledger row cannot disagree about which form applies.
	"""
	if not (source_format or "").strip():
		return None
	if form_enabled or filled_against_a_form(source_data):
		return source_format
	return None


def _source_format_for(req) -> str | None:
	"""The type's format, used only to LABEL the flatten and locate the mapped attachment.

	Read live rather than from the snapshot deliberately: this is presentation, and a label
	corrected on the master should improve an approval made afterwards. The snapshot governs
	how the request RENDERS, which is a different question.
	"""
	row = frappe.db.get_value(
		"Expense Type", req.type, ["source_format", "source_format_enabled"], as_dict=True
	)
	if not row:
		return None
	return applicable_format(row.source_format, row.source_format_enabled, req.get("source_data"))


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
		# The invoice answers of a standard request land in their own ledger columns.
		body = SEP.join(
			value for _label, value
			in flatten_pairs(req.source_data, skip_sections=(NATIVE_INVOICE_SECTION,))
		)
	return " · ".join(p for p in (body, f"[{req.name}]") if p)


def target_status(req) -> str:
	"""What status the ledger row WILL be born at, without creating it.

	The reviewer is told the outcome before they commit to it, and since 2026-08-20 that
	outcome depends on the amount -- so the dialog can no longer say "Approved" and be right.

	⚠️ IT MAKES THE LEDGER'S OWN CALL, byte for byte: `initial_status_for_raiser(amount,
	TIER_L2_ABOVE_EXPENSES, level)` is exactly the line `ProjectExpenses.validate` and
	`NonProjectExpenses.validate` run on the row this request becomes. Restating the
	comparison here -- or hardcoding a number in this module, or worse in TypeScript -- is how
	the screen would come to promise one thing while `validate` did another.

	⚠️ THIS USED TO IMPORT `AUTO_APPROVE_LIMIT` FROM `project_expenses`, AND THAT NAME IS
	GONE (16 Sep 2026): the rule moved into `services/approval_tiers.py` and the per-doctype
	constants went with it. The dead import did not fail quietly -- it raised `ImportError`
	inside `get_my_expense_requests`, which is the ONLY source of `can_review`, so the whole
	scoped read 500'd and every row's Approve/Reject collapsed to "--" for everyone, Admin
	included. Keep this pointed at the shared module.

	⚠️ AND IT FOLLOWS THE REQUEST'S RAISER (owner, 2026-09-21), exactly as `validate` does via
	`approval_raiser.expense_raiser`: an L1 approver's request is born past L1, the CEO's past
	both. The raiser is the REQUEST's owner -- never the reviewer calling this.
	"""
	return initial_status_for_raiser(flt(req.amount), TIER_L2_ABOVE_EXPENSES, raiser_level(req.get("owner")))


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
	"admin-only"; the threshold moved (10,000 -> 15,000) and L1 is now Admin OR Accountant Lead.
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
	if not source_format:
		# A standard request carries its invoice details as answers, not a declared slot.
		values.update(native_invoice(req.source_data))
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
	row.insert(ignore_permissions=True)
	return row
