# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Delete a rejected expense request.

URL: /api/method/nirmaan_stack.api.expense_requests.delete.delete_expense_request

REJECTED ONLY, and only with no Expense linked (spec #1494). A rejected request that never
became an Expense is not money, so removing it loses nothing a ledger depends on. A request
whose Expense exists is removed only through that Expense (`on_expense_deleted`), and that
includes a request that reads Rejected because its Expense was rejected.

WHO: the raiser, or an Admin (`access.is_raiser_or_admin`). Frappe keeps a `Deleted Document` copy.
"""

import frappe

from nirmaan_stack.api.expense_requests.access import is_raiser_or_admin
from nirmaan_stack.api.expense_requests.standing import expenses_of
from nirmaan_stack.integrations.controllers.expense_request_status import (
	delete_request_notifications,
)
from nirmaan_stack.services.expense_statuses import REQUEST_REJECTED


def can_delete(req, user: str | None = None, *, admin: bool | None = None,
               has_expense: bool | None = None) -> bool:
	"""May this caller delete this request?

	Read by `get_my_expense_requests` so the row carries the answer, like `can_edit`: the
	table never re-derives it. A list caller passes `admin` and `has_expense` it already
	looked up for the whole page, instead of one lookup per row.
	"""
	if req.get("status") != REQUEST_REJECTED:
		return False
	if not is_raiser_or_admin(req, user, admin=admin):
		return False
	if has_expense is None:
		has_expense = req.get("name") in expenses_of([req.get("name")])
	return not has_expense


@frappe.whitelist(methods=["POST"])
def delete_expense_request(name: str):
	req = frappe.get_doc("Expense Request", name)

	if req.status != REQUEST_REJECTED:
		frappe.throw(
			f"Only a rejected request can be deleted. This one is {req.status}.",
			title="Cannot delete",
		)
	if not is_raiser_or_admin(req):
		frappe.throw(
			"Only the person who raised this request, or an Admin, can delete it.",
			frappe.PermissionError,
			title="Not allowed",
		)
	if expenses_of([name]):
		frappe.throw(
			f"{name} has an Expense. Delete the Expense instead; its request goes with it.",
			title="Cannot delete",
		)

	# Bell notifications point at the request through a Dynamic Link, which Frappe's delete
	# guard refuses (`LinkExistsError`), so they go first. The ledger path does the same.
	delete_request_notifications(name)
	frappe.delete_doc("Expense Request", name, ignore_permissions=True)
	frappe.db.commit()

	return {"name": name, "deleted": True}
