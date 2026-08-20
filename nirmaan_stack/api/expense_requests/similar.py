# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What is already on record that resembles this request.

URL: /api/method/nirmaan_stack.api.expense_requests.similar.get_similar

READ-ONLY, AND NOTHING HERE REFUSES ANYTHING (owner ruling, 2026-08-20). Two entry points ask
the same question at the two moments a human can act on it:

  check_new_request   the CREATE dialog, while the form is being filled -- no request exists
                      yet, which is why `get_similar` cannot serve it
  get_similar         the REVIEW dialog, for the approver

⚠️ ONE DEFINITION OF THE RULE. Every judgement -- what the subject is, what the period is,
whether two periods overlap -- comes from `duplicates`. This module only queries and shapes
for the screen. A second copy of the matching logic here is exactly how the two surfaces
would come to disagree about the same request.

TWO TIERS, kept apart deliberately:

  OVERLAPPING (strong)  same type, same subject, periods overlap -- a real duplicate claim.
  NEARBY (weak)         same type + amount + project inside a window, over BOTH expense
                        doctypes. All a directly-entered ledger row can support -- it cannot
                        tell August rent from September -- so it is phrased as a prompt.

Merging them would make the strong signal as ignorable as the weak one.
"""

import frappe
from frappe.utils import add_days, flt, nowdate

from nirmaan_stack.api.expense_requests.access import REJECTED
from nirmaan_stack.api.expense_requests.duplicates import (
	describe,
	find_overlapping,
	flat_responses as _flat,
	overlaps,
	period_of,
	rule_for,
	subject_of,
)
from nirmaan_stack.api.expense_requests.flatten import flat_responses
from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES

# How far back the WEAK tier looks. A month plus slack, so a monthly expense shows its
# neighbours without dragging in a year of history.
NEARBY_DAYS = 60

# How many past entries the history strip shows. A COUNT, not a window: a monthly series is
# read by its shape, and six rows is half a year of it.
HISTORY_LIMIT = 6


@frappe.whitelist()
def check_new_request(expense_type: str, source_data=None) -> dict:
	"""Warn about duplicates for a request that does not exist yet.

	The create dialog calls this while the form is being filled, so it CANNOT take a request
	name -- which is why `get_similar` could not serve it. Read-only, and it refuses nothing:
	the requester sees the finding and decides.

	Returns an EMPTY list for a type with no rule, an unanswered form, or a blank subject --
	the same three silences the finder already applies, so a half-filled form never nags.
	"""
	hits = find_overlapping(expense_type, source_data)
	rule = rule_for(expense_type)
	flat = _flat(source_data)
	return {
		"subject": " · ".join(v for v in (flat.get(k) for k in (rule.get("match_on") or [])) if v),
		"overlapping": hits,
	}


@frappe.whitelist()
def get_similar(name: str) -> dict:
	"""Everything already on record that resembles this request. Writes nothing."""
	req = frappe.get_doc("Expense Request", name)
	rule = rule_for(req.type)

	flat = flat_responses(req.source_data)
	subject = subject_of(flat, rule)
	period = period_of(flat, rule)

	overlapping, history = ([], [])
	if subject and period[0]:
		overlapping, history = _scan_requests(req, rule, subject, period)

	return {
		"subject": " · ".join(
			v for v in (flat.get(k) for k in (rule.get("match_on") or [])) if v
		),
		"has_period_check": bool(subject and period[0]),
		"overlapping": overlapping,
		"history": history[:HISTORY_LIMIT],
		"nearby": _scan_ledgers(req),
	}


def _scan_requests(req, rule, subject, period) -> tuple[list, list]:
	"""Other requests of this type with the same subject.

	Scoped to the TYPE first, so this reads a handful of rows rather than the table. A
	REJECTED request is excluded: it never became money, so it cannot be double-paid.

	⚠️ The subject is the person NAMED IN THE ANSWERS, never the request's `owner`.
	`person_name` merely DEFAULTS to the logged-in user through `bind`, so an admin raising a
	request on someone else's behalf would defeat an owner-scoped check at exactly the moment
	it matters.
	"""
	rows = frappe.get_all(
		"Expense Request",
		filters={"type": req.type, "name": ["!=", req.name], "status": ["!=", REJECTED]},
		fields=["name", "amount", "status", "source_data", "owner", "creation"],
		order_by="creation desc",
		limit_page_length=0,
	)

	overlapping, history = [], []
	for r in rows:
		other = flat_responses(r["source_data"])
		if subject_of(other, rule) != subject:
			continue
		other_period = period_of(other, rule)
		entry = {
			"name": r["name"],
			"amount": flt(r["amount"]),
			"status": r["status"],
			"period_from": str(other_period[0]) if other_period[0] else None,
			"period_to": str(other_period[1]) if other_period[1] else None,
			"context": describe(other, rule),
			"overlaps": overlaps(period, other_period),
		}
		history.append(entry)
		if entry["overlaps"]:
			overlapping.append(entry)
	return overlapping, history


def _scan_ledgers(req) -> list:
	"""The weak tier, over BOTH expense doctypes.

	⚠️ BOTH, even though a type's scope flags say only one is reachable. That is true of the
	REQUEST path and false of the data: `Travel Expenses (Bus)` and `(Train)` are flagged
	non-project-only and rows for them sit in `Project Expenses`, because direct entry never
	enforced the flags. Searching one ledger would miss exactly those.

	`Project Payments` is deliberately NOT searched -- it is born from a PO or SR, and an
	expense request can never create one.

	`amount` is compared through `flt` because the two doctypes store it differently: a Data
	column of numeric strings on one side, a real Currency on the other.
	"""
	since = add_days(nowdate(), -NEARBY_DAYS)
	target = flt(req.amount)
	out = []
	for doctype in EXPENSE_DOCTYPES:
		filters = {"type": req.type, "creation": [">", since]}
		if doctype == "Project Expenses" and req.projects:
			filters["projects"] = req.projects
		for row in frappe.get_all(
			doctype,
			filters=filters,
			fields=["name", "amount", "status", "description", "creation", "request_id"],
			order_by="creation desc",
			limit_page_length=0,
		):
			if row.get("request_id") == req.name:
				continue  # this request's own ledger row is not a duplicate of itself
			if flt(row["amount"]) != target:
				continue
			out.append({
				"doctype": doctype,
				"name": row["name"],
				"amount": flt(row["amount"]),
				"status": row["status"],
				"description": (row["description"] or "")[:120],
				"on": str(row["creation"])[:10],
				"from_request": row.get("request_id") or None,
			})
	return out
