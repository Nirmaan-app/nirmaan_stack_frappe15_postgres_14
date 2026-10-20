# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Carry a ledger row's LIFECYCLE back to the request it came from -- every status, and deleted.

⚠️ THE EXPENSE OWNS EVERY STATUS AFTER REVIEW, NOT THE REVIEWER (spec #1494, #1500). Once a request
has an Expense, `Expense Request.status` is a MIRROR of that Expense, set by this hook and NOWHERE
else:

    Expense status                                         request status
    Requested, CEO Pending, Approved, Reconciliation Pending  Approved
    Paid                                                   Paid
    Rejected (by L1 or the CEO)                            Rejected

So an L1 or CEO reject reads Rejected on the request, and an unreconcile (Paid -> Reconciliation
Pending) moves it back from Paid to Approved. The request keeps its own four statuses; the finer
step (waiting for Admin, CEO Pending, Reconciliation Pending) is the Expense's own and is READ live
by `api/expense_requests/standing`, never copied, so the two cannot disagree.

It hangs off the ledgers' `on_update`, so every door that saves an Expense moves the request: the
decision call (`services/expense_decision.decide`), the bank-line settle and unreconcile, and the
bank-line re-derive on any save. A raw SQL write would skip it; none writes an Expense's status.

SEPARATE FROM `expense_request_notify` DELIBERATELY, though both fire on the same save. This one
changes STATE and rides the ledger's own transaction -- the Expense and its request move together or
not at all. That one only TELLS the requester and is self-swallowing, because a bell message must
never roll back a payment.
"""

import frappe

from nirmaan_stack.api.expense_requests.access import APPROVED, PAID, REJECTED

# The request statuses an Expense can move. `Pending Approval` is the review's, never this hook's:
# the Expense is inserted while the request still waits, and the review sets Approved itself.
MIRRORED = (APPROVED, PAID, REJECTED)


def request_status_for(expense_status: str | None) -> str:
	"""The request status that mirrors an Expense at `expense_status`."""
	if expense_status == PAID:
		return PAID
	if expense_status == REJECTED:
		return REJECTED
	return APPROVED


def on_expense_status_changed(doc, method=None) -> None:
	"""Ledger `on_update`: bring the originating request to the status its Expense now mirrors.

	⚠️ NARROW ON PURPOSE. This fires on EVERY save of BOTH expense doctypes -- including the
	thousands of rows that never came from a request -- so it exits on the cheapest checks first.
	It fires on a status CHANGE only, so an edit that leaves the status alone (an Accounts amount
	fix) does no work; the amount is read live, not mirrored.

	NOT wrapped in a try/except. The write rides the ledger's own transaction: swallowing a
	failure would strand the request at a status its Expense has left.

	`set_value` rather than `doc.save`: this runs inside the ledger's save, and the request's own
	`validate` governs fields this does not touch. So this write leaves NO `Version` row; the audit
	lives on the Expense, which carries the approval and payment stamps.
	"""
	request = doc.get("request_id")
	if not request:
		return  # an ordinary expense, raised directly rather than through a request
	if not doc.has_value_changed("status"):
		return
	current = frappe.db.get_value("Expense Request", request, "status")
	target = request_status_for(doc.status)
	if current in MIRRORED and current != target:
		frappe.db.set_value("Expense Request", request, "status", target)


def on_expense_deleted(doc, method=None) -> None:
	"""Ledger `after_delete`: delete the request the row was created from.

	⚠️ MUST BE `after_delete`, NEVER `on_trash`. `on_trash` fires BEFORE the row leaves the
	database, so the expense still exists and its `request_id` still points at the request --
	and Frappe refuses to delete a document anything links to (`LinkExistsError`). By
	`after_delete` the pointer is gone and the delete goes through. The cashflow recompute on
	this same doctype moved to `after_delete` for the same class of reason.

	FRAMEWORK WILL NOT DO THIS FOR US. A `Link` is a REFERENCE, not ownership: the same field
	type also points this row at its Project, Vendor and Expense Type, none of which should
	die with it. Only child tables cascade, because those rows live inside their parent.

	NOT wrapped in a try/except. The expense is already gone by the time this runs, so a
	failure rolls the whole transaction back and NEITHER is deleted -- which is the honest
	outcome. Swallowing would leave exactly the orphan this exists to prevent.
	"""
	request = doc.get("request_id")
	if not request:
		return  # an ordinary expense, raised directly rather than through a request
	if not frappe.db.exists("Expense Request", request):
		return  # already gone -- idempotent, and the other ledger may have got there first

	delete_request_notifications(request)
	frappe.delete_doc("Expense Request", request, ignore_permissions=True)


def delete_request_notifications(request: str) -> None:
	"""Clear the bell messages pointing at a request, so the request itself can be deleted.

	⚠️ THIS IS NOT TIDINESS -- IT IS WHAT MAKES THE DELETE POSSIBLE. `Nirmaan Notifications`
	addresses its subject through `document` + `docname`, and `docname` is a **Dynamic Link**.
	Frappe's delete guard walks dynamic links as well as ordinary ones, so a request carrying
	any notification (every rejected or paid one does) would raise `LinkExistsError` and take
	the expense deletion down with it.

	`ignore_links=True` would also get past the guard and is the WRONG fix: it leaves bell
	entries pointing at a record that no longer exists, and the requester can still click them.

	Raw `frappe.db.delete` rather than per-row `delete_doc`: a notification is an ephemeral UI
	record, so N document loads to bank N `Deleted Document` rows buys nothing. Same reasoning
	as the version prune in `api/pricing/workbook.py`.
	"""
	frappe.db.delete("Nirmaan Notifications",
	                 {"document": "Expense Request", "docname": request})
