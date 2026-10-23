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

from nirmaan_stack.services.expense_statuses import (
	EXPENSE_PAID,
	EXPENSE_REJECTED,
	REQUEST_APPROVED,
	REQUEST_PAID,
	REQUEST_REJECTED,
)
from nirmaan_stack.api.expense_requests.access import APPROVED, PAID, REJECTED
from nirmaan_stack.api.approvals.expense_actions import FALLBACK_REJECTION_REASON, REJECTION_REASON_FLAG
from nirmaan_stack.api.payments.bulk_actions import REJECTED_STATUS as REJECTED_LEDGER_STATUS
from nirmaan_stack.services.notification_links import delete_notifications_for

# The request statuses an Expense can move. `Pending Approval` is the review's, never this hook's:
# the Expense is inserted while the request still waits, and the review sets Approved itself.
MIRRORED = (REQUEST_APPROVED, REQUEST_PAID, REQUEST_REJECTED)


def request_status_for(expense_status: str | None) -> str:
	"""The request status that mirrors an Expense at `expense_status`."""
	if expense_status == EXPENSE_PAID:
		return REQUEST_PAID
	if expense_status == EXPENSE_REJECTED:
		return REQUEST_REJECTED
	return REQUEST_APPROVED


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


def on_expense_rejected(doc, method=None) -> None:
	"""Ledger `on_update`: a request whose expense is REJECTED in Payments becomes Rejected too, with the reason
	typed there (the engine puts it on `doc.flags[REJECTION_REASON_FLAG]`). An expense put back OUT of Rejected
	(a request-born expense is not frozen, unlike a reimbursement's) puts its request back to Approved, so a
	later Paid still reaches it through `on_expense_paid` (code review, 2026-10-23).

	Before this (code review, 2026-10-23) only Paid and delete reached the request, so a request whose expense
	L1 or the CEO rejected stayed Approved for good and its requester never learned why. Same narrowing as
	`on_expense_paid`: the transition into Rejected only, from an Approved request only.

	`set_value`, as `_mark_request_paid` does, for the same reason: the request is only mirroring the ledger.
	`review_comment` is written with the status, which is what the request's `validate` requires of a Rejected
	request.
	"""
	if not doc.has_value_changed("status"):
		return
	request = doc.get("request_id")
	if not request:
		return  # an ordinary expense, raised directly rather than through a request
	before = doc.get_doc_before_save()
	previous = before.status if before else None
	request_status = frappe.db.get_value("Expense Request", request, "status")
	if doc.status == REJECTED_LEDGER_STATUS:
		if request_status != APPROVED:
			return
		reason = (doc.flags.get(REJECTION_REASON_FLAG) or "").strip() or FALLBACK_REJECTION_REASON
		frappe.db.set_value("Expense Request", request, {"status": REJECTED, "review_comment": reason})
	elif previous == REJECTED_LEDGER_STATUS and request_status == REJECTED:
		# Only a rejection that came from the ledger can be undone here: a request rejected by its reviewer
		# never had an expense. The review comment stays, as the record of the rejection that was undone.
		frappe.db.set_value("Expense Request", request, "status", APPROVED)


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
	The rule and its reasons live in `services/notification_links`."""
	delete_notifications_for("Expense Request", request)
