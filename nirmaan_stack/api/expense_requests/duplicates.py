# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Has this person's stay already been asked for? (spec #1494, #1504)

URL: /api/method/nirmaan_stack.api.expense_requests.duplicates.check_duplicate_stay

⚠️ NOTHING HERE REFUSES ANYTHING (owner ruling 2026-08-20, kept by ADR-0016's 2026-10-19
amendment). A second stay can be real, so this only ANSWERS the question, and three surfaces show
the answer:
  * the Reviewer, in bold, with every match (`similar.get_similar` -> `stays`);
  * a raiser on Records without review, in bold, with the matches, before submit (they act as their
    own reviewer), through `check_duplicate_stay`;
  * any other raiser, as a quiet note that the reviewer will see it (same call).
`create_expense_request` and `update_expense_request` also return the matches.

WHAT MAKES A DUPLICATE: the same FORM, the same PERSON (case and spacing ignored) and stays that
OVERLAP BY AT LEAST ONE DAY, on any project, against any request or Expense that is not Rejected.
A stay is the nights from its first date up to its last, so one that starts the day another ends
shares no night and is not a match; a stay whose two dates are the same day counts as that one
night. Amount and project are deliberately not compared: one person cannot live in two rented
places on the same days, and a repeat is often typed with a different figure.

KEYED ON THE FORM'S `templateId`, which every request's `source_data` carries, NEVER on the
Expense Type's name: renaming a type must not switch the check off (the name-keyed table this
replaces was removed for exactly that, 2026-09-19). A form absent from `STAY_FORMS` is never checked.

EXPENSES are reached through the request they came from: the person and dates live only in that
request's answers. An Expense's own status decides whether it counts, so a rejected Expense never
matches even where its request still reads Approved. An Expense with no request (an old Direct
Expense, an import) carries no person or dates and cannot be matched.

RE-CHECKED ONLY WHEN THE STAY CHANGES (`stay_of`): an edit that keeps the person and dates is not
flagged again.
"""

from __future__ import annotations

import datetime

import frappe
from frappe.utils import getdate

from nirmaan_stack.api.expense_requests.access import REJECTED
from nirmaan_stack.api.expense_requests.flatten import (
	NATIVE_INVOICE_SECTION,
	_as_dict,
	flat_responses,
	flatten_pairs,
)

# templateId -> which answer names the person, and which two name the stay's first and last day.
STAY_FORMS: dict[str, dict] = {
	"staff-accommodation": {
		"person": "person_name",
		"period": ("rent_period_from", "rent_period_to"),
	},
}

ONE_DAY = datetime.timedelta(days=1)


# --- pure -----------------------------------------------------------------------------------


def template_of(source_data) -> str:
	return (_as_dict(source_data) or {}).get("templateId") or ""


def normalise(value) -> str:
	"""`'Bittu Kumar '` and `'bittu  kumar'` are one person."""
	return " ".join(str(value or "").split()).casefold()


def _to_date(value):
	if not value:
		return None
	try:
		return getdate(value)
	except Exception:
		return None


def stay_of(source_data) -> tuple | None:
	"""`(template, person, first_day, last_day)`, or None when the form has no stay rule or the
	person or a date is missing (an unfinished form is never a match). Reversed dates, which old
	rows can hold, are read the right way round."""
	template = template_of(source_data)
	rule = STAY_FORMS.get(template)
	if not rule:
		return None
	answers = flat_responses(source_data)
	person = normalise(answers.get(rule["person"]))
	start, end = (_to_date(answers.get(k)) for k in rule["period"])
	if not (person and start and end):
		return None
	start, end = sorted((start, end))
	return (template, person, start, end)


def overlaps(a: tuple, b: tuple) -> bool:
	"""Do two stays (`stay_of`) share at least one night?"""
	_, _, a1, a2 = a
	_, _, b1, b2 = b
	return a1 < max(b2, b1 + ONE_DAY) and b1 < max(a2, a1 + ONE_DAY)


# --- the finder -----------------------------------------------------------------------------


def find_stay_duplicates(source_data, exclude: str | None = None) -> list[dict]:
	"""Every other request, or the Expense it became, for this stay's person on overlapping days.

	Newest first, one per request. `exclude` is the request itself. Each match:
	`{request, status, expense, type, projects, project_name, amount, person, period_from,
	period_to, owner_name, creation, detail}`; `status` is the live label (the Expense's once there
	is one), `expense` is `{doctype, name, status}` or None, and `detail` is that request's answers,
	labelled by its own form, for the hover card.
	"""
	from nirmaan_stack.api.expense_requests.convert import applicable_format
	from nirmaan_stack.api.expense_requests.standing import expenses_of
	from nirmaan_stack.services.expense_standing import live_status

	stay = stay_of(source_data)
	if not stay:
		return []
	template, person = stay[0], stay[1]

	filters = {
		"status": ["!=", REJECTED],
		# A coarse pre-filter on the stored JSON; the template is compared exactly below.
		"source_data": ["like", f"%{template}%"],
	}
	if exclude:
		filters["name"] = ["!=", exclude]
	candidates = []
	for r in frappe.get_all(
		"Expense Request", filters=filters,
		fields=["name", "type", "projects", "amount", "status", "source_data", "owner", "creation"],
		order_by="creation desc", limit_page_length=0,
	):
		other = stay_of(r.source_data)
		if other and other[0] == template and other[1] == person and overlaps(stay, other):
			candidates.append((r, other))
	if not candidates:
		return []

	expenses = expenses_of([r.name for r, _ in candidates])
	formats = {
		f.name: f for f in frappe.get_all(
			"Expense Type", filters={"name": ["in", list({r.type for r, _ in candidates})]},
			fields=["name", "source_format", "source_format_enabled"],
		)
	}
	project_names = dict(frappe.get_all(
		"Projects", filters={"name": ["in", list({r.projects for r, _ in candidates if r.projects})]},
		fields=["name", "project_name"], as_list=True,
	)) if any(r.projects for r, _ in candidates) else {}

	matches = []
	for r, other in candidates:
		expense = expenses.get(r.name)
		if expense and expense["status"] == REJECTED:
			continue
		fmt = formats.get(r.type) or {}
		matches.append({
			"request": r.name,
			"status": live_status(r.status, expense and expense["status"]),
			"expense": ({"doctype": expense["doctype"], "name": expense["name"], "status": expense["status"]}
			            if expense else None),
			"type": r.type,
			"projects": r.projects,
			"project_name": project_names.get(r.projects),
			"amount": expense["amount"] if expense else r.amount,
			"person": flat_responses(r.source_data).get(STAY_FORMS[template]["person"]),
			"period_from": str(other[2]),
			"period_to": str(other[3]),
			"owner_name": frappe.utils.get_fullname(r.owner),
			"creation": str(r.creation),
			"detail": [
				{"label": label, "value": value}
				for label, value in flatten_pairs(
					r.source_data,
					applicable_format(fmt.get("source_format"), fmt.get("source_format_enabled"),
					                  r.source_data),
					skip_sections=(NATIVE_INVOICE_SECTION,),
				)
			],
		})
	return matches


def stay_changed(before_source_data, after_source_data) -> bool:
	"""Did an edit change the stay itself (its form, person or dates)?"""
	return stay_of(before_source_data) != stay_of(after_source_data)


@frappe.whitelist()
def check_duplicate_stay(source_data=None, exclude: str | None = None) -> dict:
	"""Read-only: the matches for the stay on the New Expense form, while it is filled.

	`exclude` is the request being EDITED: it is never its own match, and while its stay is
	unchanged nothing is returned (it was checked when that stay was set). Which way the dialog
	shows the matches is the caller's Records without review answer (`get_request_catalog`).
	"""
	# `get_all` reads past permissions, so the door is checked here: only someone who may read
	# expense requests learns anything about other people's.
	if not frappe.has_permission("Expense Request", "read"):
		frappe.throw("Not permitted.", frappe.PermissionError)
	if exclude:
		stored = frappe.db.get_value("Expense Request", exclude, "source_data")
		if not stay_changed(stored, source_data):
			return {"matches": []}
	return {"matches": find_stay_duplicates(source_data, exclude=exclude)}
