# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Delete a REJECTED expense request.

URL: /api/method/nirmaan_stack.api.expense_requests.delete.delete_expense_request

REJECTED ONLY (owner, 2026-09-30). A rejected request never became money, so removing it
loses nothing the ledgers depend on. Pending, Approved and Paid can never be deleted here --
an approved or paid request is removed only through its ledger row (`on_expense_deleted`).

WHO: the requester, or an Admin. Frappe keeps a `Deleted Document` copy, so the record is
still recoverable after the delete.
"""

import frappe

from nirmaan_stack.api.expense_requests.access import REJECTED, is_admin
from nirmaan_stack.integrations.controllers.expense_request_status import (
	_delete_request_notifications,
)
from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES


def can_delete(req, user: str, admin: bool | None = None) -> bool:
	"""Server-owned, like `can_edit` / `can_review` -- the table must never re-derive it.

	`admin` lets a list caller pass the answer it already has, instead of one lookup per row.
	"""
	if req["status"] != REJECTED:
		return False
	return req["owner"] == user or (is_admin(user) if admin is None else admin)


@frappe.whitelist(methods=["POST"])
def delete_expense_request(name: str):
	req = frappe.get_doc("Expense Request", name)
	user = frappe.session.user

	if req.status != REJECTED:
		frappe.throw(
			f"Only a rejected request can be deleted. This one is {req.status}.",
			title="Cannot delete",
		)
	if not can_delete(req.as_dict(), user):
		frappe.throw(
			"Only the person who raised this request, or an Admin, can delete it.",
			frappe.PermissionError,
			title="Not allowed",
		)
	# A rejected request never gets a ledger row; if one points here, something upstream is
	# wrong, and deleting would orphan real money.
	for doctype in EXPENSE_DOCTYPES:
		if frappe.db.exists(doctype, {"request_id": name}):
			frappe.throw(
				f"{name} is linked to an expense in {doctype}, so it cannot be deleted.",
				title="Cannot delete",
			)

	# Bell notifications point at the request through a Dynamic Link, which Frappe's delete
	# guard refuses (`LinkExistsError`) -- they have to go first. Same step the ledger path takes.
	_delete_request_notifications(name)
	frappe.delete_doc("Expense Request", name, ignore_permissions=True)
	frappe.db.commit()

	return {"name": name, "deleted": True}
