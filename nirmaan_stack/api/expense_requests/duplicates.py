# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Has this exact expense already been asked for?

⚠️ THE RULE LIVES HERE, NOT IN `Expense Type.source_format` (owner ruling, 2026-08-19). The
format describes the FORM SHAPE and nothing else; which answers make two requests the same
ask is engineering policy, not something a requester-facing editor should be able to change.
Changing it is a deploy, deliberately.

⚠️ NOTHING HERE REFUSES ANYTHING (owner ruling, 2026-08-20). This module ANSWERS the
question; both surfaces that ask it -- the create dialog while the form is filled, and the
review dialog at approval -- render the answer as a warning and let the human decide. The
earlier submission-time block was removed: a duplicate cannot be told from a legitimate repeat
with certainty, and a refusal the requester disagrees with has nowhere to go.

WHAT MAKES A DUPLICATE: the same expense TYPE, the same SUBJECT, and PERIODS THAT OVERLAP.
Nothing else -- and the three fields it does NOT use are the point:

  amount   the two live August rents for one person are 4,500 and 8,000
  property one says `Sri Sai Annapoorana PG`, the other `Sri Sai` -- one building, two spellings
  category one says `PG`, the other `Hotel`

Every one of those would have MISSED the real duplicate. Person plus overlapping period caught
it. Free text drifts the moment two people type it, so it is shown as context and never matched.
"""

import json

import frappe
from frappe.utils import getdate

from nirmaan_stack.api.expense_requests.flatten import flat_responses

REJECTED = "Rejected"


# ⚠️ A type ABSENT from this table has NO duplicate rule and is never blocked. That is the
# safe direction: 34 of 40 types have no form at all, so there are no answers to compare and
# a guess would refuse real work.
#
# `match_on` names the SUBJECT. `period` names the dates -- `from` alone is a point date (a
# travel departure), which is a period of one day, so one overlap test serves both shapes.
# `show` is CONTEXT for the message and is never compared.
RULES: dict[str, dict] = {
	"Staff Accommodation Rent": {
		"match_on": ["person_name"],
		"period": {"from": "rent_period_from", "to": "rent_period_to"},
		"show": ["building_name", "accommodation_type"],
	},
	# NO person field on this one -- it is a BUILDING-level cost, so the building IS the
	# subject. Free text and therefore driftable; a miss means a duplicate slips through,
	# which is the direction to fail in when the alternative is refusing a real request.
	"Labour Accommodation Rent": {
		"match_on": ["building_name"],
		"period": {"from": "rent_period_from", "to": "rent_period_to"},
		"show": ["city", "no_of_occupants"],
	},
	"Hotel Expenses": {
		"match_on": ["guest_name"],
		"period": {"from": "check_in", "to": "check_out"},
		"show": ["hotel_name", "location"],
	},
	"Travel Expenses (Bus)": {
		"match_on": ["traveller_name"],
		"period": {"from": "depart_date"},
		"show": ["from_location", "to_location"],
	},
	"Travel Expenses (Flight)": {
		"match_on": ["traveller_name"],
		"period": {"from": "depart_date"},
		"show": ["from_location", "to_location"],
	},
	"Travel Expenses (Train)": {
		"match_on": ["traveller_name"],
		"period": {"from": "depart_date"},
		"show": ["from_location", "to_location"],
	},
}


def rule_for(expense_type: str) -> dict:
	return RULES.get(expense_type) or {}


# --- pure helpers ---------------------------------------------------------------------


def normalise(value) -> str:
	"""Compare names the way a human reads them, not the way they were typed.

	Live data carries `'Sri Sai Annapoorana Gents PG '` with a trailing space. Casefold plus
	collapsed whitespace is as far as this goes -- deciding that `Sri Sai` and
	`Sri Sai Annapoorana PG` are one building is a judgement, not a normalisation.
	"""
	return " ".join(str(value or "").split()).casefold()


def to_date(value):
	"""A stored answer as a date, or None. Never raises -- a malformed answer is just absent."""
	if not value:
		return None
	try:
		return getdate(value)
	except Exception:
		return None


def subject_of(flat: dict, rule: dict):
	"""The values that make two requests the same ask, or None.

	None when any is blank: two requests that both left the name empty are not thereby the
	same person, and blocking on that would refuse every unfilled form against every other.
	"""
	keys = rule.get("match_on") or []
	if not keys:
		return None
	values = tuple(normalise(flat.get(k)) for k in keys)
	return values if all(values) else None


def period_of(flat: dict, rule: dict) -> tuple:
	spec = rule.get("period") or {}
	start = to_date(flat.get(spec.get("from")))
	end = to_date(flat.get(spec.get("to"))) if spec.get("to") else start
	return (start, end or start)


def overlaps(a: tuple, b: tuple) -> bool:
	"""Do two periods share a day?

	OVERLAP, not equality: 1--31 Aug against 15 Aug--14 Sep is still a double payment for the
	shared fortnight. An unknown period on either side is NOT an overlap -- absence is not
	evidence, and this decides a refusal.
	"""
	(a1, a2), (b1, b2) = a, b
	if not (a1 and a2 and b1 and b2):
		return False
	return a1 <= b2 and b1 <= a2


def describe(flat: dict, rule: dict) -> str:
	"""The context line for a message -- the fields we deliberately do NOT match on."""
	return " · ".join(v for v in (flat.get(k) for k in (rule.get("show") or [])) if v)


# --- the finder -----------------------------------------------------------------------


def find_overlapping(expense_type: str, source_data, exclude: str | None = None) -> list:
	"""Requests of this type, same subject, period overlapping. Newest first.

	⚠️ SCOPED TO THE EXPENSE TYPE. An `Accommodation Deposit` and a `Staff Accommodation
	Rent` for the same August are two different asks about one stay, and blocking the second
	would refuse a real request.

	A REJECTED request is skipped: it never became money, so it cannot be double-paid.

	⚠️ SEARCHES REQUESTS ONLY. The period lives in `source_data`, which a directly-entered
	ledger row does not have -- only 5 of 3,302 rows carry a `request_id` today. So an expense
	keyed in by an accountant is invisible here, and that gap closes only as requests become
	the way expenses arrive.
	"""
	rule = rule_for(expense_type)
	if not rule:
		return []

	flat = flat_responses(source_data)
	subject = subject_of(flat, rule)
	period = period_of(flat, rule)
	if not subject or not period[0]:
		return []  # nothing to compare -- never block on an unanswered form

	filters = {"type": expense_type, "status": ["!=", REJECTED]}
	if exclude:
		filters["name"] = ["!=", exclude]

	hits = []
	for r in frappe.get_all(
		"Expense Request", filters=filters,
		fields=["name", "amount", "status", "source_data", "owner", "creation"],
		order_by="creation desc", limit_page_length=0,
	):
		other = flat_responses(r["source_data"])
		if subject_of(other, rule) != subject:
			continue
		other_period = period_of(other, rule)
		if not overlaps(period, other_period):
			continue
		hits.append({
			"name": r["name"],
			"amount": r["amount"],
			"status": r["status"],
			"period_from": str(other_period[0]),
			"period_to": str(other_period[1]),
			"context": describe(other, rule),
		})
	return hits
