# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Has this person's stay already been asked for?

A Project Manager is BLOCKED; everyone else is only WARNED (owner, 2026-09-30). Two
surfaces ask the SAME questions here, so they cannot disagree:
  * `ExpenseRequest.validate` -- the server refusal, PM only (`_block_duplicate_pm_request`);
  * `check_duplicate_stay` -- the create / edit dialog, WHILE the form is filled: a red note
    and a disabled submit for a PM, an amber note for everyone else.
Both run on create, and on an edit only when the STAY changed (`stay_key`). This reverses,
for PMs, the 2026-08-20 ruling that nothing here refuses anything.

WHAT MAKES A DUPLICATE: the same FORM, the same PERSON, and PERIODS THAT OVERLAP by at least
one day, against any request that was not Rejected -- a Paid one included, since paying the
same days twice is exactly what this stops.

  project  NOT compared: one person cannot live in two rented places on the same days, so a
           second site does not make a second stay legitimate
  amount   NOT compared: a same-month repeat is often typed with a different figure
  Hotel    NEVER a duplicate: a person living in a PG at one site stays in a hotel for two or
           three days while visiting another. A Hotel request is never checked, and an
           existing Hotel request never blocks anything.

KEYED ON THE FORM'S `templateId`, which every request's `source_data` carries -- NOT on the
Expense Type's name, so renaming a type cannot break it (the reason the name-keyed table was
removed 2026-09-19). A form absent from `RULES` is never checked. Only Staff Accommodation is
listed; Labour Accommodation is pending an owner decision on its project scope.
"""

import frappe
from frappe.utils import getdate

from nirmaan_stack.api.expense_requests.flatten import _as_dict, flat_responses

REJECTED = "Rejected"
HOTEL = "hotel"

RULES: dict[str, dict] = {
	"staff-accommodation": {
		"match_on": "person_name",
		"period": ("rent_period_from", "rent_period_to"),
	},
}


def template_of(source_data) -> str:
	return (_as_dict(source_data) or {}).get("templateId") or ""


def normalise(value) -> str:
	"""`'Bittu Kumar '` and `'bittu  kumar'` are one person."""
	return " ".join(str(value or "").split()).casefold()


def to_date(value):
	if not value:
		return None
	try:
		return getdate(value)
	except Exception:
		return None


def period_of(flat: dict, rule: dict) -> tuple:
	start_key, end_key = rule["period"]
	return to_date(flat.get(start_key)), to_date(flat.get(end_key))


def overlaps(a: tuple, b: tuple) -> bool:
	"""Share at least one day. An unknown date on either side is NOT an overlap.

	A REVERSED period (`To` before `From`, which old rows can hold) is read the right way
	round, so it neither hides a real overlap nor invents one.
	"""
	if not (all(a) and all(b)):
		return False
	(a1, a2), (b1, b2) = sorted(a), sorted(b)
	return a1 <= b2 and b1 <= a2


def is_hotel(flat: dict) -> bool:
	return normalise(flat.get("accommodation_type")) == HOTEL


def period_error(source_data) -> str:
	"""The message when `To` falls before `From`, else "". Answers only -- never throws."""
	rule = RULES.get(template_of(source_data))
	if not rule:
		return ""
	start, end = period_of(flat_responses(source_data), rule)
	if start and end and end < start:
		return (f"Rent Period To ({end.strftime('%d-%b-%Y')}) is before "
		        f"Rent Period From ({start.strftime('%d-%b-%Y')}).")
	return ""


def stay_key(source_data) -> tuple:
	"""What makes a request the stay it is: form, person, dates, Hotel-or-not.

	Compared on EDIT: only a change here can create a new overlap, so a PM correcting the
	comment or amount of a request that already overlaps is never blocked.
	"""
	template = template_of(source_data)
	rule = RULES.get(template)
	if not rule:
		return (template,)
	flat = flat_responses(source_data)
	return (template, normalise(flat.get(rule["match_on"])), period_of(flat, rule), is_hotel(flat))


def find_overlapping(expense_type: str, source_data, exclude: str | None = None) -> list:
	"""Not-rejected requests of this form: same person, overlapping period. Newest first.

	`exclude` is the request being EDITED -- it must never count as its own duplicate.
	"""
	template = template_of(source_data)
	rule = RULES.get(template)
	if not rule:
		return []

	flat = flat_responses(source_data)
	person = normalise(flat.get(rule["match_on"]))
	period = period_of(flat, rule)
	if not person or not all(period) or is_hotel(flat):
		return []

	hits = []
	for r in frappe.get_all(
		"Expense Request",
		filters={
			"type": expense_type, "status": ["!=", REJECTED],
			**({"name": ["!=", exclude]} if exclude else {}),
		},
		fields=["name", "status", "projects", "source_data"],
		order_by="creation desc", limit_page_length=0,
	):
		if template_of(r.source_data) != template:
			continue
		other = flat_responses(r.source_data)
		if is_hotel(other) or normalise(other.get(rule["match_on"])) != person:
			continue
		other_period = period_of(other, rule)
		if overlaps(period, other_period):
			hits.append({
				"name": r.name, "status": r.status, "projects": r.projects,
				"person": other.get(rule["match_on"]), "period": other_period,
			})
	return hits


# Left out of the hover details: the person hovering is often NOT the requester, and a
# stranger's account number has no business in a duplicate note. The approver still sees it
# in the review dialog.
HOVER_SKIP_SECTIONS = ("payee_bank",)


@frappe.whitelist()
def check_duplicate_stay(expense_type: str, source_data=None, exclude: str | None = None) -> dict:
	"""Read-only: what the create dialog shows WHILE the form is filled.

	URL: /api/method/nirmaan_stack.api.expense_requests.duplicates.check_duplicate_stay

	`blocks` is the ONE answer the dialog follows: true only for a Project Manager whose stay
	overlaps another (or has `To` before `From`) -- and, on an edit (`exclude` = the request
	being edited), only when the stay itself changed. Everyone else is only warned. Writes
	nothing -- the refusal itself is `ExpenseRequest.validate`, asking the same questions.

	Each match carries its answers LABELLED BY ITS OWN FORM (`detail`), through the same
	`applicable_format` + `flatten_pairs` walk as the approval dialog and the ledger line, so
	the hover card cannot describe a request differently from them.
	"""
	from nirmaan_stack.api.expense_requests.access import PM_PROFILE, caller_role_profile
	from nirmaan_stack.api.expense_requests.convert import applicable_format
	from nirmaan_stack.api.expense_requests.flatten import flatten_pairs

	# `get_all` below skips permissions, so the door is checked here: only someone who may
	# read expense requests learns anything about other people's.
	if not frappe.has_permission("Expense Request", "read"):
		frappe.throw("Not permitted.", frappe.PermissionError)

	is_pm = caller_role_profile() == PM_PROFILE
	# On EDIT, a PM is blocked only if the STAY changed (or the type did) -- the request as
	# stored is what they are allowed to keep correcting.
	changed = True
	if exclude:
		stored = frappe.db.get_value("Expense Request", exclude, ["type", "source_data"], as_dict=True)
		if stored:
			changed = stored.type != expense_type or stay_key(stored.source_data) != stay_key(source_data)

	bad_period = period_error(source_data)
	hits = find_overlapping(expense_type, source_data, exclude=exclude)
	blocks = is_pm and changed and bool(hits or bad_period)
	if not hits:
		return {"blocks": blocks, "matches": [], "period_error": bad_period}

	fmt = frappe.db.get_value(
		"Expense Type", expense_type, ["source_format", "source_format_enabled"], as_dict=True
	) or {}
	rows = {
		r.name: r for r in frappe.get_all(
			"Expense Request",
			filters={"name": ["in", [h["name"] for h in hits]]},
			fields=["name", "type", "amount", "owner", "creation", "source_data"],
		)
	}
	matches = []
	for h in hits:
		r = rows.get(h["name"]) or {}
		matches.append({
			"name": h["name"], "status": h["status"], "projects": h["projects"],
			"person": h["person"],
			"period_from": str(h["period"][0]), "period_to": str(h["period"][1]),
			"type": r.get("type"), "amount": r.get("amount"),
			"owner": r.get("owner"), "creation": str(r.get("creation") or ""),
			"owner_name": frappe.utils.get_fullname(r.get("owner")) if r.get("owner") else "",
			"detail": [
				{"label": label, "value": value}
				for label, value in flatten_pairs(
					r.get("source_data"),
					applicable_format(fmt.get("source_format"), fmt.get("source_format_enabled"),
					                  r.get("source_data")),
					skip_sections=HOVER_SKIP_SECTIONS,
				)
			],
		})
	return {"blocks": blocks, "matches": matches, "period_error": bad_period}
