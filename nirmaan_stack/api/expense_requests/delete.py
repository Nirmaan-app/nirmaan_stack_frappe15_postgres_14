# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Delete a rejected expense request.

URL: /api/method/nirmaan_stack.api.expense_requests.delete.delete_expense_request

REJECTED ONLY, and only with no Expense linked (spec #1494). A rejected request that never
became an Expense is not money, so removing it loses nothing a ledger depends on. A request
whose Expense exists is removed only through that Expense (`on_expense_deleted`), and that
includes a request that reads Rejected because its Expense was rejected.

WHO: the raiser, or an Admin. Frappe keeps a `Deleted Document` copy.
"""

import frappe

from nirmaan_stack.api.expense_requests.access import REJECTED, is_admin
from nirmaan_stack.integrations.controllers.expense_request_status import (
	_delete_request_notifications,
)
from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES


def requests_with_an_expense(names) -> set[str]:
	"""The requests among `names` that an Expense row points back at."""
	names = list(names)
	if not names:
		return set()
	linked = set()
	for doctype in EXPENSE_DOCTYPES:
		linked.update(frappe.get_all(doctype, filters={"request_id": ["in", names]},
		                             pluck="request_id"))
	return linked


def can_delete(req, user: str | None = None, *, admin: bool | None = None,
               has_expense: bool | None = None) -> bool:
	"""May this caller delete this request?

	Read by `get_my_expense_requests` so the row carries the answer, like `can_edit`: the
	table never re-derives it. A list caller passes `admin` and `has_expense` it already
	looked up for the whole page, instead of one lookup per row.
	"""
	user = user or frappe.session.user
	if req.get("status") != REJECTED:
		return False
	if not (req.get("owner") == user or (is_admin(user) if admin is None else admin)):
		return False
	if has_expense is None:
		has_expense = bool(requests_with_an_expense([req.get("name")]))
	return not has_expense


@frappe.whitelist(methods=["POST"])
def delete_expense_request(name: str):
	req = frappe.get_doc("Expense Request", name)
	user = frappe.session.user

	if req.status != REJECTED:
		frappe.throw(
			f"Only a rejected request can be deleted. This one is {req.status}.",
			title="Cannot delete",
		)
	if not (req.owner == user or is_admin(user)):
		frappe.throw(
			"Only the person who raised this request, or an Admin, can delete it.",
			frappe.PermissionError,
			title="Not allowed",
		)
	if requests_with_an_expense([name]):
		frappe.throw(
			f"{name} has an Expense. Delete the Expense instead; its request goes with it.",
			title="Cannot delete",
		)

	# Bell notifications point at the request through a Dynamic Link, which Frappe's delete
	# guard refuses (`LinkExistsError`), so they go first. The ledger path does the same.
	_delete_request_notifications(name)
	frappe.delete_doc("Expense Request", name, ignore_permissions=True)

	return {"name": name, "deleted": True}
