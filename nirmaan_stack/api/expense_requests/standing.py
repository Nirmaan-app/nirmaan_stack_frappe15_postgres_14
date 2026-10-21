# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Where an Expense Request stands: its Expense's LIVE status and amount (spec #1494, #1500).

URL:
  /api/method/nirmaan_stack.api.expense_requests.standing.get_request_standing

The request's own `status` mirrors its Expense coarsely (`expense_request_status`). The finer step
-- waiting for Admin, CEO Pending, Reconciliation Pending -- and the amount Accounts may since have
corrected are the Expense's, so they are READ here from the Expense on every call and never copied
onto the request. The Expenses list's status and amount columns and the request page both read this.
"""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import flt

from nirmaan_stack.services.expense_decision import approval_level
from nirmaan_stack.services.expense_standing import live_status, where_it_stands
from nirmaan_stack.services.expense_tds import withheld_tds_by_expense
from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES

# One page of the Expenses list is at most a few hundred rows.
MAX_NAMES = 500

REQUEST_FIELDS = ["name", "status", "amount", "owner", "creation", "reviewed_by", "reviewed_on", "review_comment",
                  "approved_on_submit"]
EXPENSE_FIELDS = ["name", "request_id", "status", "amount", "auto_approved", "approval_date", "ceo_approval_date",
                  "payment_date"]


def expenses_of(requests) -> dict[str, frappe._dict]:
	"""request name -> its Expense (`doctype` plus `EXPENSE_FIELDS`), from either ledger.

	THE ONE ANSWER to "which Expense points at this request" (the ledger carries `request_id`): the
	list, the request page, the delete and Add invoice rules and the duplicate-stay check all read it.
	A request with no Expense is absent.

	Read without the ledger's own permission: the caller may read the request, and its Expense's
	status and amount are the request's live state, not a separate record they are browsing.
	"""
	found: dict[str, frappe._dict] = {}
	requests = [r for r in requests if r]
	if not requests:
		return found
	for doctype in EXPENSE_DOCTYPES:
		for row in frappe.get_all(doctype, filters={"request_id": ["in", requests]}, fields=EXPENSE_FIELDS):
			expense = frappe._dict({"doctype": doctype, **row, "amount": flt(row.amount)})
			found[expense.pop("request_id")] = expense
	return found


def parse_names(names, noun: str = "requests") -> list[str]:
	"""A list endpoint's `names` (a JSON list, or one bare name) as a list, refusing more than
	`MAX_NAMES`, one page of a list. Also `api/approvals/expense_tds.get_withheld_tds`'s, for `expenses`."""
	if isinstance(names, str):
		names = json.loads(names) if names.strip().startswith("[") else [names]
	names = [n for n in (names or []) if isinstance(n, str) and n]
	if len(names) > MAX_NAMES:
		frappe.throw(_("At most {0} {1} at a time.").format(MAX_NAMES, noun))
	return names


@frappe.whitelist()
def get_request_standing(names) -> dict[str, dict]:
	"""For each named request the caller may read: `{status, amount, expense, steps}`.

	`status` is the live label (`services/expense_standing.live_status`), `amount` the Expense's
	amount once one exists, `expense` its doctype, name, status, amount and stamps (or None), and
	`steps` the request page's "Where it stands" (`services/expense_standing.where_it_stands`).
	"""
	wanted = parse_names(names)
	if not wanted:
		return {}
	requests = frappe.get_list("Expense Request", filters={"name": ["in", wanted]}, fields=REQUEST_FIELDS,
	                           limit_page_length=len(wanted))
	expenses = expenses_of([r.name for r in requests])
	levels = {key: approval_level(*key) for key in {(r.owner, r.reviewed_by) for r in requests}}
	withheld = withheld_tds_of_expenses(expenses.values())
	return {
		r.name: {**standing_of(r, expenses.get(r.name), levels[(r.owner, r.reviewed_by)], withheld),
		         "expense": expenses.get(r.name)}
		for r in requests
	}


def withheld_tds_of_expenses(expenses) -> dict[tuple[str, str], dict]:
	"""The tax withheld from these Expenses (`expenses_of` rows, or None), keyed `(doctype, name)`:
	`expense_tds.withheld_tds_by_expense`, read past the record's own permission as the Expense is (#1527)."""
	return withheld_tds_by_expense((e["doctype"], e["name"]) for e in expenses if e)


def standing_of(request, expense: dict | None, level: str | None, withheld: dict[tuple[str, str], dict]) -> dict:
	"""`{status, amount, steps, withheld_tds}` of one request (`REQUEST_FIELDS`), given its Expense from
	`expenses_of`, the level it is born under (`expense_decision.approval_level`) and the tax withheld
	from the page's Expenses (`withheld_tds_of_expenses`). The request page's `read.get_expense_request`
	serves the same through this.

	`withheld_tds` is the Expense's tax record's figures once an Office Rent expense is approved (#1527),
	else None: before approval `amount` is still the full rent, and the screen forecasts from it."""
	return {
		"status": live_status(request["status"], expense and expense["status"]),
		"amount": expense["amount"] if expense else flt(request["amount"]),
		"steps": where_it_stands(request, expense, level),
		"withheld_tds": withheld.get((expense["doctype"], expense["name"])) if expense else None,
	}
