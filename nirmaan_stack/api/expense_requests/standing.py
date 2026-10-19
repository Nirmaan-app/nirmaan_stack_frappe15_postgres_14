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

from nirmaan_stack.services.approval_raiser import raiser_level
from nirmaan_stack.services.expense_decision import is_l1
from nirmaan_stack.services.expense_standing import live_status, where_it_stands
from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES

# One page of the Expenses list is at most a few hundred rows.
MAX_NAMES = 500

REQUEST_FIELDS = ["name", "status", "amount", "owner", "creation", "reviewed_by", "reviewed_on", "review_comment",
                  "approved_on_submit"]
EXPENSE_FIELDS = ["name", "request_id", "status", "amount", "auto_approved", "approval_date", "ceo_approval_date",
                  "payment_date"]


def expenses_of(requests: list[str]) -> dict[str, dict]:
	"""request name -> its Expense (`doctype` plus `EXPENSE_FIELDS`), from either ledger.

	Read without the ledger's own permission: the caller may read the request, and its Expense's
	status and amount are the request's live state, not a separate record they are browsing.
	"""
	found: dict[str, dict] = {}
	if not requests:
		return found
	for doctype in EXPENSE_DOCTYPES:
		for row in frappe.get_all(doctype, filters={"request_id": ["in", requests]}, fields=EXPENSE_FIELDS):
			expense = {"doctype": doctype, **row, "amount": flt(row.amount)}
			found[expense.pop("request_id")] = expense
	return found


def _parse_names(names) -> list[str]:
	if isinstance(names, str):
		names = json.loads(names) if names.strip().startswith("[") else [names]
	names = [n for n in (names or []) if isinstance(n, str) and n]
	if len(names) > MAX_NAMES:
		frappe.throw(_("At most {0} requests at a time.").format(MAX_NAMES))
	return names


@frappe.whitelist()
def get_request_standing(names) -> dict[str, dict]:
	"""For each named request the caller may read: `{status, amount, expense, steps}`.

	`status` is the live label (`services/expense_standing.live_status`), `amount` the Expense's
	amount once one exists, `expense` its doctype, name, status, amount and stamps (or None), and
	`steps` the request page's "Where it stands" (`services/expense_standing.where_it_stands`).
	"""
	wanted = _parse_names(names)
	if not wanted:
		return {}
	requests = frappe.get_list("Expense Request", filters={"name": ["in", wanted]}, fields=REQUEST_FIELDS,
	                           limit_page_length=len(wanted))
	expenses = expenses_of([r.name for r in requests])
	levels = {owner: raiser_level(owner) for owner in {r.owner for r in requests}}
	return {
		r.name: {**standing_of(r, expenses.get(r.name), levels[r.owner]), "expense": expenses.get(r.name)}
		for r in requests
	}


def standing_of(request, expense: dict | None, level: str | None) -> dict:
	"""`{status, amount, steps}` of one request (`REQUEST_FIELDS`), given its Expense from
	`expenses_of` and its raiser's level (`approval_raiser.raiser_level`). The request page's
	`read.get_expense_request` serves the same through this."""
	return {
		"status": live_status(request["status"], expense and expense["status"]),
		"amount": expense["amount"] if expense else flt(request["amount"]),
		"steps": where_it_stands(request, expense, level, reviewer_is_l1=is_l1(request.get("reviewed_by"))),
	}
